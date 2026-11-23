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
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from uuid import uuid4
from PIL import Image

from EasyLora.config import (
    ensure_dirs, resolve_sd_webui_lora_dir, get_settings, save_settings,
    DEFAULT_WORKSPACE_DIR, DEFAULT_PROCESSED_DIR, DEFAULT_CAPTIONS_DIR
)
from EasyLora.data_utils import SUPPORTED_EXTS, list_images


# ============== 配置常量 ==============
RAW_DIR = DEFAULT_WORKSPACE_DIR / "raw_uploads"
THUMBNAIL_DIR = DEFAULT_WORKSPACE_DIR / "thumbnails"
DATASET_DIR = DEFAULT_PROCESSED_DIR / "dataset"



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
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    app.state.job = None
    try:
        yield
    finally:
        job = app.state.job
        if job and job.active:
            job.stop()
            await job.task


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
# Register the gallery routes even on first boot; lifespan creates the directories.
for url, directory in (("/workspace/raw_uploads", RAW_DIR), ("/workspace/processed/dataset", DATASET_DIR)):
    app.mount(url, StaticFiles(directory=directory, check_dir=False), name=directory.name)


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
def resolve_image_path(path: str) -> Optional[Path]:
    # The frontend passes one of the virtual gallery URLs even when the
    # configured workspace is outside the checkout.
    parts = Path(urllib.parse.unquote(path).lstrip("/")).parts
    if parts[:1] == ("workspace",):
        parts = parts[1:]
    for prefix, gallery in ((("raw_uploads",), RAW_DIR), (("processed", "dataset"), DATASET_DIR)):
        if len(parts) == len(prefix) + 1 and parts[:-1] == prefix:
            candidate = gallery / parts[-1]
            if candidate.suffix.lower() in SUPPORTED_EXTS and candidate.is_file():
                return candidate
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
    names = []
    stems = {p.stem.casefold() for directory in (RAW_DIR, DATASET_DIR) for p in list_images(directory)}
    for f in files:
        name = f.filename or ""
        if not name or Path(name).name != name or Path(name).suffix.lower() not in SUPPORTED_EXTS:
            raise ValidationError_(f"不支持的图片文件名: {name}")
        if Path(name).stem.casefold() in stems:
            raise AppError(f"图库中已有同名图片: {name}，请重命名后上传", 409)
        try:
            with Image.open(f.file) as image:
                image.verify()
            f.file.seek(0)
        except (OSError, ValueError, SyntaxError) as exc:
            raise ValidationError_(f"无法读取图片: {name}") from exc
        stems.add(Path(name).stem.casefold())
        names.append(name)
    for name, f in zip(names, files):
        with (RAW_DIR / name).open("wb") as target:
            shutil.copyfileobj(f.file, target)
    return {"ok": True, "count": len(names)}


@app.post("/api/stop")
async def stop_training():
    job = app.state.job
    if not job or not job.active:
        raise HTTPException(409, "没有正在运行的训练")
    job.stop()
    return {"ok": True, "message": "停止指令已发送"}


@app.get("/api/training-status")
async def training_status():
    job = app.state.job
    if job:
        return job.snapshot()
    return {"status": "idle", "progress": None, "path": None, "error": None, "download_url": None}


@app.get("/api/training-result/{job_id}")
async def training_result(job_id: str):
    job = app.state.job
    if not job or job.id != job_id or job.status != "completed" or not job.path.is_file():
        raise HTTPException(404, "结果不可用，请前往输出目录查看已保存的模型")
    return FileResponse(job.path, filename=job.path.name, media_type="application/octet-stream")


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
    """已保存的图片即使标签为空也必须可见，以便修改标签。"""
    images = []
    for img_file in list_images(DATASET_DIR):
        txt_file = img_file.with_suffix(".txt")
        caption = txt_file.read_text(encoding="utf-8-sig").strip() if txt_file.is_file() else ""
        images.append({
            "filename": img_file.name,
            "path": f"/workspace/processed/dataset/{urllib.parse.quote(img_file.name)}",
            "caption": caption,
        })
    return {"images": images}


@app.get("/api/raw-uploads")
async def get_raw_uploads():
    """获取未处理的原始上传图片"""
    if not RAW_DIR.exists():
        return {"images": []}
    
    images = []
    for img_file in list_images(RAW_DIR):
        # 排除已处理的
        if not (DATASET_DIR / img_file.name).exists():
            images.append({
                "filename": img_file.name,
                "path": f"/workspace/raw_uploads/{urllib.parse.quote(img_file.name)}",
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
def system_stats():
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

class TrainingJob:
    """One server-owned run. The launching websocket is only a subscriber."""

    def __init__(self):
        self.id = uuid4().hex
        self.status = "running"
        self.progress = self.path = self.error = None
        self.stop_event = threading.Event()
        self.events = asyncio.Queue()
        self.task = None

    @property
    def active(self):
        return self.status in ("running", "stopping")

    def stop(self):
        self.status = "stopping"
        self.stop_event.set()

    def publish(self, event):
        if event["type"] == "progress":
            self.progress = {k: v for k, v in event.items() if k != "type"}
        if self.events is not None:
            self.events.put_nowait(event)

    def snapshot(self):
        return {"status": self.status, "progress": self.progress, "error": self.error,
                "path": str(self.path) if self.path else None,
                "download_url": f"/api/training-result/{self.id}" if self.status == "completed" else None}

    async def run(self, params):
        loop = asyncio.get_running_loop()
        def notify(event):
            loop.call_soon_threadsafe(self.publish, event)

        try:
            output = await asyncio.to_thread(_run_training, params, self.stop_event, notify)
            if self.stop_event.is_set():
                self.status = "cancelled"
                self.publish({"type": "cancelled"})
            else:
                self.path = Path(output)
                if not self.path.is_file():
                    raise FileNotFoundError(f"训练未生成输出文件: {self.path}")
                self.status = "completed"
                self.publish({"type": "done", **self.snapshot()})
        except Exception as exc:
            self.path = None
            if self.stop_event.is_set():
                self.status = "cancelled"
                self.publish({"type": "cancelled"})
            else:
                self.error = str(exc)
                self.status = "failed"
                self.publish({"type": "error", "error": self.error})


def _run_training(params, stop_event, notify):
    # Keep upload, settings and status available even before GPU dependencies are installed.
    from EasyLora.data_utils import training_dataset
    from EasyLora.train import train_lora, TrainCallbacks

    def log(message):
        notify({"type": "log", "data": message})

    def progress(p, eta=None, cur=None, total=None, elapsed=None):
        notify({"type": "progress", "p": p, "eta": eta, "cur": cur, "total": total, "elapsed": elapsed})

    settings = get_settings()
    options = dict(
        override_steps=int(params.get("steps", 0)) or None,
        override_lr=float(params.get("lr", 0)) or None,
        override_save_every=int(params.get("save_every", settings.get("DEFAULT_SAVE_EVERY", 0))),
        override_auto_resume=(params["auto_resume"] == "1" if "auto_resume" in params
                              else settings.get("DEFAULT_AUTO_RESUME", False)),
        optimizer_type=params.get("optimizer_type"),
        unet_lr=float(params.get("unet_lr", 0)) or None,
        text_encoder_lr=float(params.get("text_encoder_lr", 0)) or None,
        base_model=params.get("base_model"),
        model_name=params.get("name"),
    )
    if stop_event.is_set():
        raise RuntimeError("训练已取消")
    with training_dataset(RAW_DIR, DATASET_DIR, model_family=options["base_model"]) as (processed, captions, images, avg):
        if stop_event.is_set():
            raise RuntimeError("训练已取消")
        return train_lora(processed_dir=processed, captions_dir=captions, image_paths=images,
                          avg_long_side=avg, sd_webui_lora_dir=resolve_sd_webui_lora_dir(None),
                          callbacks=TrainCallbacks(log=log, update_progress=progress),
                          stop_event=stop_event, **options)


@app.websocket("/ws/train")
async def ws_train(ws: WebSocket):
    await ws.accept()
    if app.state.job and app.state.job.active:
        await ws.send_json({"type": "error", "error": "已有训练正在运行，请等待其结束"})
        await ws.close()
        return

    job = app.state.job = TrainingJob()
    job.task = asyncio.create_task(job.run(dict(ws.query_params)))

    async def send_events():
        while True:
            event = await job.events.get()
            await ws.send_json(event)
            if event["type"] in ("done", "cancelled", "error"):
                return

    async def wait_for_disconnect():
        while True:
            if (await ws.receive())["type"] == "websocket.disconnect":
                return

    sender = asyncio.create_task(send_events())
    receiver = asyncio.create_task(wait_for_disconnect())
    try:
        await asyncio.wait((sender, receiver), return_when=asyncio.FIRST_COMPLETED)
    finally:
        # Dropping the browser must neither orphan an unbounded log queue nor stop training.
        job.events = None
        for task in (sender, receiver):
            task.cancel()
        await asyncio.gather(sender, receiver, return_exceptions=True)
        try:
            await ws.close()
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass


# ============== 入口 ==============

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
