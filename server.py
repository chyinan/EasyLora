"""
server.py

EasyLora 后端服务 - FastAPI + WebSocket
提供图片上传、标签管理、训练控制等 API

模块化重构版本：
- 统一的错误处理机制
- 清晰的路由组织
- 类型安全的请求/响应模型
"""

from __future__ import annotations

import asyncio
import hashlib
import shutil
import threading
import urllib.parse
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from PIL import Image

from EasyLora.config import (
    ensure_dirs, resolve_sd_webui_lora_dir, get_settings, save_settings,
    DEFAULT_PROCESSED_DIR, DEFAULT_CAPTIONS_DIR
)
from EasyLora.data_utils import list_images, compute_avg_long_side, process_and_save
from EasyLora.train import train_lora, TrainCallbacks


# ============== 配置常量 ==============
RAW_DIR = Path("workspace/raw_uploads")
THUMBNAIL_DIR = Path("workspace/thumbnails")
DATASET_DIR = Path("workspace/processed/dataset")
SUPPORTED_EXTENSIONS = ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp")

# 全局停止事件
_STOP_EVENT = threading.Event()


# ============== Pydantic 模型 ==============
class CaptionUpdateRequest(BaseModel):
    filename: str
    caption: str = ""
    isProcessed: bool = False
    autoAddPrefix: bool = False
    modelName: str = ""


class DeleteImageRequest(BaseModel):
    filename: str


class ApiResponse(BaseModel):
    ok: bool
    message: str = ""
    error: str = ""


# ============== 异常处理器 ==============
class AppError(Exception):
    """应用层异常基类"""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class FileNotFoundError_(AppError):
    def __init__(self, filename: str):
        super().__init__(f"文件不存在: {filename}", 404)


class ValidationError_(AppError):
    def __init__(self, message: str):
        super().__init__(message, 400)


# ============== 生命周期管理 ==============
@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化
    ensure_dirs()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)
    yield
    # 关闭时清理
    _STOP_EVENT.set()


# ============== 创建 FastAPI 应用 ==============
app = FastAPI(
    title="EasyLora API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件服务
workspace_dir = Path("workspace")
if workspace_dir.exists():
    app.mount("/workspace", StaticFiles(directory="workspace"), name="workspace")


# ============== 全局异常处理 ==============
@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"ok": False, "error": exc.message}
    )


@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": f"服务器内部错误: {str(exc)}"}
    )


# ============== 工具函数 ==============
def get_image_files(directory: Path) -> List[Path]:
    """获取目录中的所有图片文件"""
    images = []
    for ext in SUPPORTED_EXTENSIONS:
        images.extend(sorted(directory.glob(ext)))
    return images


def is_valid_caption(caption: str) -> bool:
    """检查标签是否有效（非空且非默认占位符）"""
    if not caption or not caption.strip():
        return False
    caption = caption.strip()
    # 有真正的标签内容
    return ("," in caption and len(caption) > 20) or \
           (not caption.startswith("img_") and len(caption) > 10)


def resolve_image_path(path: str) -> Optional[Path]:
    """解析并验证图片路径"""
    clean_path = urllib.parse.unquote(path).lstrip("/")
    
    # 尝试多种路径组合
    candidates = [
        Path(clean_path),
        Path("workspace") / clean_path,
        Path(".") / clean_path,
    ]
    
    for candidate in candidates:
        if candidate.exists():
            return candidate
        # 尝试在父目录中查找（处理编码问题）
        if candidate.parent.exists():
            for item in candidate.parent.iterdir():
                if item.name == candidate.name:
                    return item
    
    return None


def generate_thumbnail_cache_key(path: Path, width: int, height: int, quality: int) -> str:
    """生成缩略图缓存键"""
    stat = path.stat()
    key_string = f"{path}_{stat.st_mtime}_{width}_{height}_{quality}"
    return hashlib.md5(key_string.encode('utf-8', errors='ignore')).hexdigest()


def apply_caption_prefix(caption: str, auto_add_prefix: bool, model_name: str) -> str:
    """应用标签前缀"""
    if auto_add_prefix and model_name and model_name.strip():
        prefix = model_name.strip()
        if caption.strip() and not caption.strip().startswith(prefix):
            return f"{prefix}, {caption.strip()}"
        elif not caption.strip():
            return prefix
    else:
        # 使用配置的默认前缀
        settings = get_settings()
        prefix = settings.get("CAPTION_PREFIX", "")
        if prefix and caption.strip() and not caption.strip().startswith(prefix):
            return f"{prefix}, {caption.strip()}"
    return caption


# ============== API 路由 ==============

@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    """上传图片到 raw_uploads 目录"""
    ensure_dirs()
    count = 0
    for f in files:
        if f.filename:
            data = await f.read()
            out = RAW_DIR / f.filename
            out.write_bytes(data)
            count += 1
    return {"ok": True, "count": count}


@app.post("/api/stop")
async def stop_training():
    """停止当前训练"""
    _STOP_EVENT.set()
    return {"ok": True, "message": "停止指令已发送"}


@app.get("/api/settings")
async def get_settings_api():
    """获取设置"""
    settings = get_settings()
    # 转换 Path 对象为字符串
    return {k: str(v) if isinstance(v, Path) else v for k, v in settings.items()}


@app.post("/api/settings")
async def update_settings_api(payload: dict):
    """更新设置"""
    save_settings(payload or {})
    return {"ok": True, "settings": get_settings(), "need_restart": True}


@app.get("/api/processed-images")
async def get_processed_images():
    """获取已处理的图片列表（仅返回有有效标签的图片）"""
    if not DATASET_DIR.exists():
        return {"images": []}
    
    images = []
    for img_file in get_image_files(DATASET_DIR):
        txt_file = img_file.with_suffix(".txt")
        if txt_file.exists():
            try:
                caption = txt_file.read_text(encoding="utf-8").strip()
                if is_valid_caption(caption):
                    images.append({
                        "filename": img_file.name,
                        "path": f"/workspace/processed/dataset/{img_file.name}",
                        "caption": caption
                    })
            except Exception:
                continue
    
    return {"images": images}


@app.get("/api/raw-uploads")
async def get_raw_uploads():
    """获取未处理的原始上传图片"""
    if not RAW_DIR.exists():
        return {"images": []}
    
    images = []
    for img_file in get_image_files(RAW_DIR):
        # 排除已处理的
        if not (DATASET_DIR / img_file.name).exists():
            images.append({
                "filename": img_file.name,
                "path": f"/workspace/raw_uploads/{img_file.name}",
                "isRaw": True
            })
    
    return {"images": images}


@app.get("/api/thumbnail")
async def get_thumbnail(path: str, width: int = 200, height: int = 200, quality: int = 80):
    """获取图片缩略图（带缓存）"""
    real_path = resolve_image_path(path)
    if not real_path:
        raise FileNotFoundError_(path)
    
    # 检查缓存
    cache_key = generate_thumbnail_cache_key(real_path, width, height, quality)
    cache_file = THUMBNAIL_DIR / f"{cache_key}.webp"
    
    if cache_file.exists():
        return FileResponse(cache_file, media_type="image/webp")
    
    # 生成缩略图
    try:
        with Image.open(real_path) as img:
            # 转换色彩模式
            if img.mode in ('RGBA', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            img.thumbnail((width, height))
            img.save(cache_file, "WEBP", quality=quality)
        
        return FileResponse(cache_file, media_type="image/webp")
    except Exception as e:
        raise AppError(f"生成缩略图失败: {e}", 500)


@app.get("/api/system-stats")
async def system_stats():
    """获取系统状态（GPU/CPU/内存）"""
    result = {
        "gpu": "CPU",
        "ram_percent": None,
        "vram_percent": None,
        "cpu": "Unknown",
    }
    
    # GPU 信息
    try:
        import torch
        if torch.cuda.is_available():
            result["gpu"] = torch.cuda.get_device_name(0)
            try:
                free, total = torch.cuda.mem_get_info()
                result["vram_percent"] = int((total - free) / total * 100)
            except Exception:
                pass
    except ImportError:
        pass
    
    # RAM 信息
    try:
        import psutil
        result["ram_percent"] = int(psutil.virtual_memory().percent)
    except ImportError:
        pass
    
    # CPU 信息
    try:
        from cpuinfo import get_cpu_info
        info = get_cpu_info()
        result["cpu"] = info.get('brand_raw') or info.get('brand', 'Unknown')
    except Exception:
        import platform
        result["cpu"] = platform.processor() or platform.machine()
    
    return result


@app.post("/api/update-caption")
async def update_caption(payload: CaptionUpdateRequest):
    """更新图片标签"""
    if not payload.filename:
        raise ValidationError_("缺少文件名")
    
    caption = apply_caption_prefix(
        payload.caption,
        payload.autoAddPrefix,
        payload.modelName
    )
    
    if payload.isProcessed:
        # 已处理的图片，直接更新标签
        img_file = DATASET_DIR / payload.filename
        if not img_file.exists():
            raise FileNotFoundError_(payload.filename)
        
        txt_file = img_file.with_suffix(".txt")
        txt_file.write_text(caption, encoding="utf-8")
        return {"ok": True, "caption": caption, "message": "标签已更新"}
    else:
        # 新图片，移动到处理目录
        source_file = RAW_DIR / payload.filename
        if not source_file.exists():
            raise FileNotFoundError_(payload.filename)
        
        DATASET_DIR.mkdir(parents=True, exist_ok=True)
        target_file = DATASET_DIR / payload.filename
        
        shutil.move(str(source_file), str(target_file))
        
        txt_file = target_file.with_suffix(".txt")
        txt_file.write_text(caption, encoding="utf-8")
        
        return {"ok": True, "caption": caption, "message": "图片已处理并保存标签"}


@app.delete("/api/delete-image")
async def delete_image(payload: DeleteImageRequest):
    """删除已处理的图片"""
    if not payload.filename:
        raise ValidationError_("缺少文件名")
    
    img_file = DATASET_DIR / payload.filename
    if not img_file.exists():
        raise FileNotFoundError_(payload.filename)
    
    img_file.unlink()
    
    txt_file = img_file.with_suffix(".txt")
    if txt_file.exists():
        txt_file.unlink()
    
    return {"ok": True, "message": f"已删除 {payload.filename}"}


@app.delete("/api/delete-raw-image")
async def delete_raw_image(payload: DeleteImageRequest):
    """删除原始上传的图片"""
    if not payload.filename:
        raise ValidationError_("缺少文件名")
    
    img_file = RAW_DIR / payload.filename
    if not img_file.exists():
        raise FileNotFoundError_(payload.filename)
    
    img_file.unlink()
    return {"ok": True, "message": f"已删除 {payload.filename}"}


# ============== WebSocket 训练接口 ==============

@app.websocket("/ws/train")
async def ws_train(ws: WebSocket):
    """训练 WebSocket 接口"""
    await ws.accept()
    loop = asyncio.get_running_loop()
    
    def log(msg: str):
        asyncio.run_coroutine_threadsafe(
            ws.send_json({"type": "log", "data": msg}), loop
        )
    
    def progress(p: float, eta: Optional[str], cur: Optional[int] = None,
                 total: Optional[int] = None, elapsed: Optional[str] = None):
        asyncio.run_coroutine_threadsafe(
            ws.send_json({
                "type": "progress",
                "p": float(p),
                "eta": eta,
                "cur": cur,
                "total": total,
                "elapsed": elapsed,
            }), loop
        )
    
    try:
        ensure_dirs()
        
        # 查找可用图片
        images = list_images(RAW_DIR)
        using_processed = False
        
        if not images:
            processed_dataset_dir = DEFAULT_PROCESSED_DIR / "dataset"
            processed_images = list_images(processed_dataset_dir)
            
            if processed_images:
                await ws.send_json({
                    "type": "log",
                    "data": f"使用现有 {len(processed_images)} 张处理后图片..."
                })
                images = processed_images
                using_processed = True
            else:
                await ws.send_json({
                    "type": "error",
                    "error": "没有找到可用的图片"
                })
                await ws.close()
                return
        
        settings = get_settings()
        avg_long = compute_avg_long_side(images)
        threshold = int(settings.get("RES_THRESHOLD_768", 700))
        
        if using_processed:
            processed_dir = DEFAULT_PROCESSED_DIR
            captions_dir = DEFAULT_CAPTIONS_DIR
            saved_images = images
        else:
            processed_dir, captions_dir, saved_images = process_and_save(
                images,
                target_size=512 if avg_long < threshold else 768,
                augment_factor=int(settings.get("AUGMENT_FACTOR", 1))
            )
        
        # 解析查询参数
        query = ws.scope.get("query_string", b"").decode("utf-8")
        params = dict(urllib.parse.parse_qsl(query)) if query else {}
        
        override_steps = int(params.get("steps", 0)) or None
        override_lr = float(params.get("lr", 0)) or None
        save_every = int(params.get("save_every", settings.get("DEFAULT_SAVE_EVERY", 0)))
        auto_resume = params.get("auto_resume") == "1" if "auto_resume" in params else settings.get("DEFAULT_AUTO_RESUME", False)
        model_name = params.get("name")
        optimizer_type = params.get("optimizer_type")
        unet_lr = float(params.get("unet_lr", 0)) or None
        text_encoder_lr = float(params.get("text_encoder_lr", 0)) or None
        
        if model_name:
            import os
            os.environ['EASYLORA_MODEL_NAME'] = model_name
        
        _STOP_EVENT.clear()
        
        # 执行训练
        output = await loop.run_in_executor(
            None,
            lambda: train_lora(
                processed_dir=processed_dir,
                captions_dir=captions_dir,
                image_paths=saved_images,
                avg_long_side=avg_long,
                sd_webui_lora_dir=resolve_sd_webui_lora_dir(None),
                callbacks=TrainCallbacks(log=log, update_progress=progress),
                override_steps=override_steps,
                override_lr=override_lr,
                override_save_every=save_every,
                override_auto_resume=auto_resume,
                optimizer_type=optimizer_type,
                unet_lr=unet_lr,
                text_encoder_lr=text_encoder_lr,
                stop_event=_STOP_EVENT,
            )
        )
        
        await ws.send_json({"type": "done", "path": str(output)})
        
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await ws.send_json({"type": "error", "error": str(e)})
    finally:
        try:
            await ws.close()
        except Exception:
            pass


# ============== 入口 ==============

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
