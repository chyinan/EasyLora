"""
server.py

轻量后端：FastAPI + WebSocket
- /api/upload: 接收前端上传的图片，保存到 workspace/raw_uploads
- /ws/train: 启动训练流程，实时推送日志与进度

说明：
- 为配合现有 EasyLora 训练脚本，这里在收到训练指令后，调用 data_utils.process_and_save 与 train.train_lora。
- 简化起见，参数从 config 自动推导；如需前端可配，后续扩展 query/body 即可。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import threading as _th
import json as _json
import os as _os

from EasyLora.config import ensure_dirs, resolve_sd_webui_lora_dir, get_settings, save_settings
from EasyLora.data_utils import list_images, compute_avg_long_side, process_and_save
from EasyLora.train import train_lora, TrainCallbacks

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RAW_DIR = Path("workspace/raw_uploads")
RAW_DIR.mkdir(parents=True, exist_ok=True)

# 添加静态文件服务，让前端可以访问处理后的图片
workspace_dir = Path("workspace")
if workspace_dir.exists():
    app.mount("/workspace", StaticFiles(directory="workspace"), name="workspace")

# 全局停止事件（用于停止当前训练）
_STOP_EVENT = _th.Event()


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)):
    ensure_dirs()
    count = 0
    for f in files:
        data = await f.read()
        out = RAW_DIR / f.filename
        out.write_bytes(data)
        count += 1
    return {"ok": True, "count": count}


@app.post("/api/stop")
async def stop_training():
    """请求停止当前训练（若存在）。"""
    try:
        _STOP_EVENT.set()
        return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.get("/api/settings")
async def get_settings_api():
    """获取合并后的设置（默认值+用户覆盖）。"""
    try:
        from pathlib import Path as _P
        s = get_settings()
        cleaned = {k: (str(v) if isinstance(v, _P) else v) for k, v in s.items()}
        return cleaned
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.post("/api/settings")
async def update_settings_api(payload: dict):
    """保存用户设置到 user_settings.json，并返回合并后的设置。
    某些更改（镜像/缓存/代理）需要重启后端才生效。
    """
    try:
        save_settings(payload or {})
        return {"ok": True, "settings": get_settings(), "need_restart": True}
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})


@app.get("/api/processed-images")
async def get_processed_images():
    """获取已处理的图片列表和对应的标签"""
    try:
        dataset_dir = Path("workspace/processed/dataset")
        if not dataset_dir.exists():
            return {"images": []}
        
        images = []
        # 支持多种图片格式
        for ext in ["*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp"]:
            for img_file in sorted(dataset_dir.glob(ext)):
                txt_file = img_file.with_suffix(".txt")
                caption = ""
                if txt_file.exists():
                    try:
                        caption = txt_file.read_text(encoding="utf-8").strip()
                    except:
                        pass
                
                images.append({
                    "filename": img_file.name,
                    "path": f"/workspace/processed/dataset/{img_file.name}",
                    "caption": caption
                })
        
        return {"images": images}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.get("/api/raw-uploads")
async def get_raw_uploads():
    """获取raw_uploads目录中未处理的图片列表"""
    try:
        raw_dir = Path("workspace/raw_uploads")
        if not raw_dir.exists():
            return {"images": []}
        
        images = []
        # 支持多种图片格式
        for ext in ["*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp"]:
            for img_file in sorted(raw_dir.glob(ext)):
                # 检查是否已经在processed目录中
                processed_file = Path("workspace/processed/dataset") / img_file.name
                if not processed_file.exists():
                    images.append({
                        "filename": img_file.name,
                        "path": f"/workspace/raw_uploads/{img_file.name}",
                        "isRaw": True
                    })
        
        return {"images": images}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.get("/api/system-stats")
async def system_stats():
    """返回 GPU 名称、CPU 名称以及 RAM 使用比例（百分比，取整）。
    - GPU: 优先尝试 torch.cuda 的设备名称；若不可用，则返回 "CPU"。
    - RAM: 使用 psutil 读取内存占用百分比。
    - CPU: 使用 py-cpuinfo 读取 CPU 名称；若失败则返回 platform.machine。
    """
    try:
        import psutil  # type: ignore
    except Exception:
        psutil = None  # type: ignore
    try:
        import torch  # type: ignore
    except Exception:
        torch = None  # type: ignore
    try:
        from cpuinfo import get_cpu_info  # type: ignore
    except Exception:
        get_cpu_info = None  # type: ignore
    try:
        import platform as _platform
    except Exception:
        _platform = None  # type: ignore

    # GPU 名称
    gpu_name = "CPU"
    try:
        if torch is not None and hasattr(torch, 'cuda') and torch.cuda.is_available():
            idx = 0
            try:
                idx = torch.cuda.current_device()
            except Exception:
                idx = 0
            try:
                gpu_name = torch.cuda.get_device_name(idx)
            except Exception:
                gpu_name = "NVIDIA GPU"
    except Exception:
        pass

    # RAM 百分比
    ram_percent = None
    try:
        if psutil is not None:
            ram_percent = int(psutil.virtual_memory().percent)
    except Exception:
        pass

    # VRAM 百分比（若可用）
    vram_percent = None
    try:
        if torch is not None and hasattr(torch, 'cuda') and torch.cuda.is_available():
            try:
                free_bytes, total_bytes = torch.cuda.mem_get_info()  # type: ignore[attr-defined]
                used = max(0, int(total_bytes - free_bytes))
                vram_percent = int((used / max(1, int(total_bytes))) * 100)
            except Exception:
                try:
                    total_bytes = int(torch.cuda.get_device_properties(0).total_memory)
                    used = int(torch.cuda.memory_reserved(0))
                    vram_percent = int((used / max(1, total_bytes)) * 100)
                except Exception:
                    vram_percent = None
    except Exception:
        pass

    # CPU 名称
    cpu_name = None
    try:
        if get_cpu_info is not None:
            info = get_cpu_info()
            cpu_name = info.get('brand_raw') or info.get('brand')
    except Exception:
        cpu_name = None
    if not cpu_name:
        try:
            if _platform is not None:
                cpu_name = _platform.processor() or _platform.machine()
        except Exception:
            cpu_name = "Unknown CPU"

    return {
        "gpu": gpu_name,
        "ram_percent": ram_percent,
        "vram_percent": vram_percent,
        "cpu": cpu_name,
    }


@app.post("/api/update-caption")
async def update_caption(payload: dict):
    """更新图片的标签并移动图片到处理目录"""
    try:
        filename = payload.get("filename")
        caption = payload.get("caption", "")
        is_processed = payload.get("isProcessed", False)
        auto_add_prefix = payload.get("autoAddPrefix", False)
        user_model_name = payload.get("modelName", "")
        
        if not filename:
            return JSONResponse(status_code=400, content={"ok": False, "error": "缺少文件名"})
        
        # 根据设置决定是否自动添加模型名称前缀
        if auto_add_prefix and user_model_name and user_model_name.strip():
            # 如果开启了自动添加前缀，且用户输入的标签不以模型名称开头，则自动添加
            model_name_trimmed = user_model_name.strip()
            if caption.strip() and not caption.strip().startswith(model_name_trimmed):
                caption = f"{model_name_trimmed}, {caption.strip()}"
            elif not caption.strip():
                caption = model_name_trimmed
        else:
            # 使用传统的CAPTION_PREFIX设置
            settings = get_settings()
            model_prefix = settings.get("CAPTION_PREFIX", "shinkai_style")
            
            if caption.strip():
                # 如果用户输入的标签不以模型前缀开头，则自动添加
                if not caption.strip().startswith(model_prefix):
                    caption = f"{model_prefix}, {caption.strip()}"
            else:
                caption = model_prefix
        
        if is_processed:
            # 对于已处理的图片，直接更新标签文件，不移动文件
            dataset_dir = Path("workspace/processed/dataset")
            img_file = dataset_dir / filename
            
            if not img_file.exists():
                return JSONResponse(status_code=404, content={"ok": False, "error": f"已处理的图片 {filename} 不存在"})
            
            # 保存标签文件
            txt_file = img_file.with_suffix(".txt")
            txt_file.write_text(caption, encoding="utf-8")
            
            return {"ok": True, "caption": caption, "message": f"已处理图片的标签已更新"}
        else:
            # 对于新上传的图片，移动文件并保存标签
            # 源文件路径（原始上传目录）
            raw_dir = Path("workspace/raw_uploads")
            source_file = raw_dir / filename
            
            # 目标目录（处理后的数据集目录）
            dataset_dir = Path("workspace/processed/dataset")
            dataset_dir.mkdir(parents=True, exist_ok=True)
            
            # 目标文件路径
            target_file = dataset_dir / filename
            
            # 检查源文件是否存在
            if not source_file.exists():
                return JSONResponse(status_code=404, content={"ok": False, "error": f"源文件 {filename} 不存在"})
            
            # 移动图片文件到处理目录
            import shutil
            shutil.move(str(source_file), str(target_file))
            
            # 保存标签文件
            txt_file = target_file.with_suffix(".txt")
            txt_file.write_text(caption, encoding="utf-8")
            
            return {"ok": True, "caption": caption, "message": f"图片已移动到处理目录并保存标签"}
            
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.delete("/api/delete-image")
async def delete_image(payload: dict):
    """删除图片及其对应的标签文件"""
    try:
        filename = payload.get("filename")
        
        if not filename:
            return JSONResponse(status_code=400, content={"ok": False, "error": "缺少文件名"})
        
        dataset_dir = Path("workspace/processed/dataset")
        img_file = dataset_dir / filename
        
        # 检查文件是否存在
        if not img_file.exists():
            return JSONResponse(status_code=404, content={"ok": False, "error": "文件不存在"})
        
        # 删除图片文件
        img_file.unlink()
        
        # 删除对应的标签文件（如果存在）
        txt_file = img_file.with_suffix(".txt")
        if txt_file.exists():
            txt_file.unlink()
        
        return {"ok": True, "message": f"已删除 {filename}"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.delete("/api/delete-raw-image")
async def delete_raw_image(payload: dict):
    """删除raw_uploads目录中的图片文件"""
    try:
        filename = payload.get("filename")
        
        if not filename:
            return JSONResponse(status_code=400, content={"ok": False, "error": "缺少文件名"})
        
        raw_dir = Path("workspace/raw_uploads")
        img_file = raw_dir / filename
        
        # 检查文件是否存在
        if not img_file.exists():
            return JSONResponse(status_code=404, content={"ok": False, "error": "文件不存在"})
        
        # 删除图片文件
        img_file.unlink()
        
        return {"ok": True, "message": f"已删除raw_uploads中的 {filename}"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.websocket("/ws/train")
async def ws_train(ws: WebSocket):
    await ws.accept()

    # 不阻塞事件循环：将训练放到线程池，回调通过主事件循环安全发送
    loop = asyncio.get_running_loop()

    def log(msg: str):
        asyncio.run_coroutine_threadsafe(ws.send_json({"type": "log", "data": msg}), loop)

    def progress(p: float, eta: Optional[str], cur: Optional[int] = None, total: Optional[int] = None, elapsed: Optional[str] = None):
        asyncio.run_coroutine_threadsafe(
            ws.send_json({
                "type": "progress",
                "p": float(p),
                "eta": eta,
                "cur": cur,
                "total": total,
                "elapsed": elapsed,
            }),
            loop,
        )

    try:
        ensure_dirs()
        images = list_images(RAW_DIR)
        if not images:
            await ws.send_json({"type": "error", "error": "没有已上传的图片"})
            await ws.close()
            return

        s = get_settings()
        avg_long = compute_avg_long_side(images)
        th = int(s.get("RES_THRESHOLD_768", 700))
        processed_dir, captions_dir, saved_images = process_and_save(images, target_size=512 if avg_long < th else 768, augment_factor=int(s.get("AUGMENT_FACTOR", 1)))

        # 从查询串读取可选参数（steps, lr, name）
        try:
            query = ws.scope.get("query_string", b"").decode("utf-8")
            import urllib.parse as _up
            q = dict(_up.parse_qsl(query)) if query else {}
            ov_steps = int(q.get("steps", "0")) if q.get("steps") else None
            ov_lr = float(q.get("lr", "0")) if q.get("lr") else None
            save_every = int(q.get("save_every", str(int(s.get("DEFAULT_SAVE_EVERY", 0)))))
            auto_resume = (q.get("auto_resume") == '1') if q.get("auto_resume") is not None else bool(s.get("DEFAULT_AUTO_RESUME", False))
            model_name = q.get("name") or None
        except Exception:
            ov_steps, ov_lr, save_every, auto_resume, model_name = None, None, int(get_settings().get("DEFAULT_SAVE_EVERY", 0)), bool(get_settings().get("DEFAULT_AUTO_RESUME", False)), None

        # 在线程池运行阻塞训练，保持 WebSocket 心跳与消息发送
        # 在子进程环境中注入模型名称，以便命名 {name}_{steps}
        if model_name:
            import os as _os
            _os.environ['EASYLORA_MODEL_NAME'] = model_name

        # 清除上次 stop 标记
        _STOP_EVENT.clear()

        out = await loop.run_in_executor(
            None,
            lambda: train_lora(
                processed_dir=processed_dir,
                captions_dir=captions_dir,
                image_paths=saved_images,
                avg_long_side=avg_long,
                sd_webui_lora_dir=resolve_sd_webui_lora_dir(None),
                callbacks=TrainCallbacks(log=log, update_progress=progress),
                override_steps=ov_steps,
                override_lr=ov_lr,
                override_save_every=save_every,
                override_auto_resume=auto_resume,
                stop_event=_STOP_EVENT,
            ),
        )

        await ws.send_json({"type": "done", "path": str(out)})
        await ws.close()
    except WebSocketDisconnect:
        return
    except Exception as e:
        await ws.send_json({"type": "error", "error": str(e)})
        await ws.close()


if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)

