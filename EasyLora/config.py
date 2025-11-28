"""
config.py

此文件包含项目的可配置参数与自动参数推导逻辑。

设计目标：
- 提供尽可能简单的默认配置，适配小白用户
- 根据输入图片尺寸与数量，自动选择训练尺寸、学习率、训练步数等
- 统一存放路径、文件名等常量

注意：
- 训练后输出的 LoRA 文件固定命名为 custom_lora.safetensors
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple, Any, Dict
import json
import datetime
import re


USER_SETTINGS_PATH = Path("user_settings.json")

_DEFAULT_SETTINGS: Dict[str, Any] = {
    # 路径/导出
    "DEFAULT_OUTPUT_DIR": "outputs",
    "OUTPUT_LORA_FILENAME": "{name}_{steps}.safetensors",  # 可为模式，如 custom_lora_{date}_{steps}.safetensors
    "DEFAULT_SD_WEBUI_LORA_DIR": r"D:\Software\sd-webui-aki-v4.9\models\Lora",
    "COPY_TO_SD_WEBUI_ON_FINISH": True,
    "DEFAULT_MODEL_512": r"D:\Software\sd-webui-aki-v4.9\models\Stable-diffusion\waiNSFWIllustrious_v140.safetensors",
    "DEFAULT_MODEL_768": r"D:\Software\sd-webui-aki-v4.9\models\Stable-diffusion\waiNSFWIllustrious_v140.safetensors",
    "DEFAULT_MODEL_SDXL": r"D:\Program\EasyLora\.hf\sdxl-base",
    "DEFAULT_WORKSPACE_DIR": "workspace",
    "DEFAULT_KOHYA_SCRIPTS_DIR": r"D:\Software\sd-scripts-0.9.1",
    "DEFAULT_VAE_PATH": "",

    # 训练默认值
    "LR_SLIDER_MIN": 1e-5,
    "LR_SLIDER_MAX": 1e-4,
    "DEFAULT_RANK_512": 8,
    "DEFAULT_RANK_768": 16,
    "DEFAULT_RANK_1024": 32,
    "DEFAULT_STEPS_512": 1500,
    "DEFAULT_STEPS_768": 1200,
    "DEFAULT_STEPS_1024": 800,
    "DEFAULT_BATCH_SIZE": 1,
    "DEFAULT_GRAD_ACCUM": 1,
    "RES_THRESHOLD_768": 700,
    "RES_THRESHOLD_SDXL": 900,
    "DEFAULT_SAVE_EVERY": 0,
    "DEFAULT_AUTO_RESUME": False,
    "LOW_VRAM_ENABLE": True,
    "LOW_VRAM_THRESHOLD_GB": 12,
    "KEEP_ONLY_LATEST_ON_INTERVAL": False,
    "MAX_MODELS_BEFORE_CLEAN": 0,

    # 下载与网络
    "HF_ENDPOINT": "",
    "HF_HOME": str((Path(".") / ".hf").resolve()),
    "TRANSFORMERS_CACHE": str((Path(".") / ".hf" / "hub").resolve()),
    "HTTP_PROXY": "",
    "HTTPS_PROXY": "",
    "ONLY_DOWNLOAD_ESSENTIAL": True,
    "MAX_DOWNLOAD_WORKERS": 1,

    # 高级
    "MIXED_PRECISION": "fp16",  # fp16/bf16
    "USE_XFORMERS": False,
    "USE_SDPA": True,
    "GRADIENT_CHECKPOINTING": False,
    "ENABLE_BUCKET": True,
    "BUCKET_RESO_STEPS": 64,
    "MIN_BUCKET_RESO": 64,
    "MAX_BUCKET_RESO": 2048,
    "AUGMENT_FACTOR": 1,
    "CAPTION_PREFIX": "",
    "CAPTION_SUFFIX": "",
    "SAVE_LAST_N_STEPS": 3,
    "SAVE_LAST_N_EPOCHS": 0,
    "EXTRA_ARGS": "",
}

_settings_cache: Dict[str, Any] | None = None


def _load_user_settings() -> Dict[str, Any]:
    try:
        if USER_SETTINGS_PATH.exists():
            return json.loads(USER_SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def get_settings() -> Dict[str, Any]:
    global _settings_cache
    if _settings_cache is None:
        user = _load_user_settings()
        merged = {**_DEFAULT_SETTINGS, **user}
        _settings_cache = merged
    return dict(_settings_cache)


def save_settings(new_settings: Dict[str, Any]) -> None:
    global _settings_cache
    merged = {**_DEFAULT_SETTINGS, **(new_settings or {})}
    try:
        USER_SETTINGS_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        # 尝试降级写入
        try:
            USER_SETTINGS_PATH.write_text(json.dumps(merged), encoding="utf-8")
        except Exception:
            pass
    _settings_cache = merged


# 以下常量均通过设置派生（保持原有导出名称，避免影响现有代码）
_S = get_settings()

DEFAULT_OUTPUT_DIR = Path(_S["DEFAULT_OUTPUT_DIR"]).expanduser()
DEFAULT_WORKSPACE_DIR = Path(_S["DEFAULT_WORKSPACE_DIR"]).expanduser()
DEFAULT_PROCESSED_DIR = DEFAULT_WORKSPACE_DIR / "processed"
DEFAULT_CAPTIONS_DIR = DEFAULT_WORKSPACE_DIR / "captions"

DEFAULT_MODEL_512 = _S["DEFAULT_MODEL_512"]
DEFAULT_MODEL_768 = _S["DEFAULT_MODEL_768"]
DEFAULT_MODEL_SDXL = _S["DEFAULT_MODEL_SDXL"]
DEFAULT_SD_WEBUI_LORA_DIR = Path(_S["DEFAULT_SD_WEBUI_LORA_DIR"]).expanduser()
DEFAULT_KOHYA_SCRIPTS_DIR: Optional[Path] = Path(_S["DEFAULT_KOHYA_SCRIPTS_DIR"]).expanduser() if _S.get("DEFAULT_KOHYA_SCRIPTS_DIR") else None
OUTPUT_LORA_FILENAME = _S["OUTPUT_LORA_FILENAME"]


@dataclass
class AutoTrainParams:
    image_size: int
    model_id: str
    train_steps: int
    learning_rate: float
    lora_rank: int
    train_batch_size: int
    gradient_accumulation_steps: int


def auto_params_sdxl(num_images: int) -> AutoTrainParams:
    """为 SDXL 选择默认参数（显存友好）。"""
    s = get_settings()
    image_size = 1024
    model_id = str(s.get("DEFAULT_MODEL_SDXL", DEFAULT_MODEL_SDXL))
    # 检查模型路径是否存在，若不存在则回退到 HF ID
    if not Path(model_id).exists():
        # 尝试去掉 D: 前缀等（虽然 Path 应该能处理），或者只是简单检查
        # 如果配置的是本地路径但找不到，则使用在线 ID
        model_id = "stabilityai/stable-diffusion-xl-base-1.0"

    learning_rate = float(s.get("LR_SLIDER_MIN", 1e-5) + (s.get("LR_SLIDER_MAX", 1e-4) - s.get("LR_SLIDER_MIN", 1e-5)) * 0.5)
    lora_rank = int(s.get("DEFAULT_RANK_1024", 32))
    train_batch_size = int(s.get("DEFAULT_BATCH_SIZE", 1))
    gradient_accumulation_steps = int(s.get("DEFAULT_GRAD_ACCUM", 1))
    steps = int(s.get("DEFAULT_STEPS_1024", max(300, min(80 * max(1, num_images), 1500))))
    return AutoTrainParams(
        image_size=image_size,
        model_id=model_id,
        train_steps=steps,
        learning_rate=learning_rate,
        lora_rank=lora_rank,
        train_batch_size=train_batch_size,
        gradient_accumulation_steps=gradient_accumulation_steps,
    )


def auto_select_image_size(avg_long_side: int) -> int:
    """根据图片长边平均值选择训练尺寸。

    - < 阈值 -> 512
    - >= 阈值 -> 768
    """
    s = get_settings()
    th = int(s.get("RES_THRESHOLD_768", 700))
    return 768 if avg_long_side >= th else 512


def auto_params_by_dataset(num_images: int, image_size: int) -> AutoTrainParams:
    """根据数据集规模与目标尺寸选择训练超参数（简单启发式）。

    规则（MVP 版本）：
    - 学习率：512 -> 1e-4, 768 -> 5e-5
    - LoRA rank：512 -> 8, 768 -> 16
    - batch size：默认 1（节省显存）
    - 累积步数：根据显存压力默认 1（可后续拓展）
    - 训练步数：min(100 * 张数, 2000)，下限 300
    - 模型：512 -> SD1.5, 768 -> SD2.1（注意 768 对显存要求更高）
    """
    s = get_settings()
    lr_min = float(s.get("LR_SLIDER_MIN", 1e-5))
    lr_max = float(s.get("LR_SLIDER_MAX", 1e-4))
    # 简单按尺寸选上限/中值，仍可被前端覆盖
    learning_rate = lr_max if image_size == 512 else (lr_min + lr_max) / 2
    lora_rank = int(s.get("DEFAULT_RANK_512", 8) if image_size == 512 else s.get("DEFAULT_RANK_768", 16))
    train_batch_size = int(s.get("DEFAULT_BATCH_SIZE", 1))
    gradient_accumulation_steps = int(s.get("DEFAULT_GRAD_ACCUM", 1))

    steps_default = int(s.get("DEFAULT_STEPS_512", 1500) if image_size == 512 else s.get("DEFAULT_STEPS_768", 1200))
    steps = max(300, min(100 * max(1, num_images), 2000)) if steps_default <= 0 else steps_default
    model_id = str(DEFAULT_MODEL_512 if image_size == 512 else DEFAULT_MODEL_768)
    # 同样检查 SD1.5/SD2.1 模型是否存在
    if not Path(model_id).exists():
        if image_size == 512:
            model_id = "runwayml/stable-diffusion-v1-5"
        else:
            model_id = "stabilityai/stable-diffusion-2-1"

    return AutoTrainParams(
        image_size=image_size,
        model_id=model_id,
        train_steps=steps,
        learning_rate=learning_rate,
        lora_rank=lora_rank,
        train_batch_size=train_batch_size,
        gradient_accumulation_steps=gradient_accumulation_steps,
    )


def ensure_dirs() -> None:
    """创建默认输出/缓存目录。"""
    for p in [DEFAULT_OUTPUT_DIR, DEFAULT_WORKSPACE_DIR, DEFAULT_PROCESSED_DIR, DEFAULT_CAPTIONS_DIR]:
        p.mkdir(parents=True, exist_ok=True)


def resolve_sd_webui_lora_dir(custom_path: Optional[str | Path]) -> Path:
    """解析 SD WebUI 的 LoRA 目录，允许用户覆盖默认路径。"""
    if custom_path is None or str(custom_path).strip() == "":
        return DEFAULT_SD_WEBUI_LORA_DIR
    return Path(custom_path).expanduser().resolve()


def get_output_lora_path(output_dir: Optional[str | Path] = None) -> Path:
    base = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR
    base.mkdir(parents=True, exist_ok=True)
    filename = OUTPUT_LORA_FILENAME
    # 若包含模板变量，保持到后续格式化函数生成
    return base / filename


def format_output_filename(steps: Optional[int] = None, name: Optional[str] = None) -> str:
    """根据设置生成输出文件名，支持 {date}、{steps}、{name} 模板。"""
    pattern = str(get_settings().get("OUTPUT_LORA_FILENAME", OUTPUT_LORA_FILENAME))
    now = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    try:
        out = pattern.replace("{date}", now)
        if steps is not None:
            out = out.replace("{steps}", str(int(steps)))
        if name is not None:
            safe = str(name).strip()
            if safe == "":
                safe = "model"
            # 清洗为安全文件名：仅字母数字-_，空格转下划线
            safe = re.sub(r"\s+", "_", safe)
            safe = re.sub(r"[^A-Za-z0-9_\-]", "", safe)
            out = out.replace("{name}", safe)
        return out
    except Exception:
        return pattern

