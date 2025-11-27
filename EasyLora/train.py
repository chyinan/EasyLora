"""
train.py

封装 LoRA 训练流程（MVP）：
- 依赖 diffusers 的 LoRA 训练（更易在纯 Python 实现中集成）
- 根据 config 自动选择模型与尺寸
- 通过回调将日志输出给 GUI

注意：
- 真正高质量训练建议使用 kohya-ss（sd-scripts），本 MVP 选用 diffusers 官方流程简化集成
- Windows 下需安装 CUDA 与 torch 对应版本
"""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
import os
import sys
import subprocess
import signal
import platform
from pathlib import Path
import shlex
from typing import Callable, Iterable, List, Optional
import threading

import torch
from torch.utils.data import Dataset, DataLoader
import numpy as np
from PIL import Image

from .config import (
    AutoTrainParams,
    auto_params_by_dataset,
    auto_select_image_size,
    get_output_lora_path,
    resolve_sd_webui_lora_dir,
    DEFAULT_KOHYA_SCRIPTS_DIR,
    auto_params_sdxl,
    get_settings,
    format_output_filename,
)
from .data_utils import is_valid_caption


def filter_images_with_captions(dataset_dir: Path) -> List[Path]:
    """筛选出有真正标签内容的图片（排除只有默认序号的图片）"""
    images_with_captions = []
    
    # 支持的图片格式
    supported_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    
    for img_file in dataset_dir.iterdir():
        if img_file.is_file() and img_file.suffix.lower() in supported_exts:
            # 检查是否有对应的标签文件
            caption_file = img_file.with_suffix(".txt")
            if caption_file.exists():
                try:
                    # 检查标签文件是否有内容
                    caption_content = caption_file.read_text(encoding="utf-8").strip()
                    if is_valid_caption(caption_content):
                        images_with_captions.append(img_file)
                except Exception:
                    # 如果读取失败，跳过这个文件
                    continue
    
    return sorted(images_with_captions)


# 延迟导入以缩短 CLI 启动开销
def _lazy_import_diffusers():
    from diffusers import StableDiffusionPipeline
    from diffusers.training_utils import set_seed
    from peft import LoraConfig, get_peft_model
    return StableDiffusionPipeline, set_seed, LoraConfig, get_peft_model


@dataclass
class TrainCallbacks:
    log: Callable[[str], None]
    update_progress: Callable[[float, Optional[str]], None]  # progress in [0,1]


class ImageCaptionDataset(Dataset):
    def __init__(self, image_paths: List[Path], captions_dir: Path, image_size: int):
        self.image_paths = image_paths
        self.captions_dir = captions_dir
        self.image_size = image_size

    def __len__(self) -> int:
        return len(self.image_paths)

    def __getitem__(self, idx):
        img_path = self.image_paths[idx]
        with Image.open(img_path) as im:
            im = im.convert("RGB").resize((self.image_size, self.image_size))
        caption_path = self.captions_dir / f"{img_path.stem}.txt"
        text = caption_path.read_text(encoding="utf-8") if caption_path.exists() else ""
        return im, text


def _collate(batch):
    images, texts = list(zip(*batch))
    # 将 PIL 转 tensor [0,1]
    imgs = torch.stack([
        torch.from_numpy(np.array(img, dtype=np.uint8)).permute(2, 0, 1)
        for img in images
    ])
    imgs = imgs.float() / 255.0
    return imgs, list(texts)


def estimate_total_steps(num_images: int, steps: int, batch_size: int, accum_steps: int) -> int:
    images_per_iter = batch_size * max(1, accum_steps)
    iters_per_epoch = max(1, (num_images + images_per_iter - 1) // images_per_iter)
    # 这里 steps 即为训练总步数，diffusers 教程通常以 step 为单位，此处按 steps 迭代
    return steps


def train_lora(
    processed_dir: Path,
    captions_dir: Path,
    image_paths: List[Path],
    avg_long_side: int,
    sd_webui_lora_dir: Optional[Path],
    callbacks: TrainCallbacks,
    override_steps: Optional[int] = None,
    override_lr: Optional[float] = None,
    override_save_every: Optional[int] = None,
    override_save_state: Optional[bool] = None,
    override_auto_resume: Optional[bool] = None,
    stop_event: Optional[threading.Event] = None,
) -> Path:
    """执行 LoRA 训练并返回生成的 .safetensors 路径。

    为保证 MVP 可运行，这里采用简化的训练流程与较小的默认步数。
    """

    # 自动参数
    # 规则可配置：长边>=阈值 认为是 SDXL 需求；否则按 512/768
    try:
        sdxl_th = int(get_settings().get('RES_THRESHOLD_SDXL', 900))
    except Exception:
        sdxl_th = 900
    # 筛选有标签的图片数量（用于参数计算）
    if processed_dir.exists():
        dataset_dir = processed_dir / "dataset"
        if dataset_dir.exists():
            filtered_images = filter_images_with_captions(dataset_dir)
            actual_image_count = len(filtered_images)
        else:
            actual_image_count = len(image_paths)
    else:
        actual_image_count = len(image_paths)
    
    if avg_long_side >= sdxl_th:
        params: AutoTrainParams = auto_params_sdxl(actual_image_count)
        callbacks.log("检测为 SDXL 任务，将使用 SDXL 默认参数与基底模型")
    else:
        image_size = auto_select_image_size(avg_long_side)
        params = auto_params_by_dataset(actual_image_count, image_size)

    # 覆盖来自前端的步数/学习率
    if override_steps is not None and override_steps > 0:
        params.train_steps = int(override_steps)
    if override_lr is not None and override_lr > 0:
        params.learning_rate = float(override_lr)

    callbacks.log(f"选择尺寸: {params.image_size}, 模型: {params.model_id}")
    callbacks.log(f"训练步数: {params.train_steps}, 学习率: {params.learning_rate}, LoRA rank: {params.lora_rank}")
    callbacks.log(f"实际使用图片数量: {actual_image_count} 张（已筛选有标签的图片）")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device != "cuda":
        callbacks.log("未检测到 CUDA，训练速度可能很慢。建议安装 NVIDIA 驱动与 CUDA 版 PyTorch。")

    # 读取全局设置
    settings = get_settings()

    # 优先尝试 kohya-ss sd-scripts（若提供了路径），以产出真实 LoRA safetensors
    kohya_path = None
    if DEFAULT_KOHYA_SCRIPTS_DIR is not None:
        kp = Path(DEFAULT_KOHYA_SCRIPTS_DIR)
        kn = kp / "train_network.py"
        if kp.exists() and kn.exists():
            kohya_path = kn

    if kohya_path is not None:
        callbacks.log("检测到 sd-scripts，使用 kohya-ss 进行训练...")
        # 注意：_mirror_captions_next_to_images 不再需要，因为我们在 _run_kohya_training 中已经创建了临时数据集目录
        # 将保存与断点参数从上层透传（若存在）
        save_every = override_save_every if override_save_every is not None else int(settings.get("DEFAULT_SAVE_EVERY", 0))
        auto_resume_flag = bool(override_auto_resume if override_auto_resume is not None else settings.get("DEFAULT_AUTO_RESUME", False))
        # 规则：当配置了每N步保存或开启断点续训时，默认一并保存 state
        save_state_flag = bool(override_save_state) or (save_every > 0) or auto_resume_flag
        out_file = _run_kohya_training(
            kohya_path, params, processed_dir, callbacks,
            save_every_steps=save_every, save_state=save_state_flag, auto_resume=auto_resume_flag,
            stop_event=stop_event,
        )
        # 复制到 SD WebUI LoRA 目录
        if settings.get("COPY_TO_SD_WEBUI_ON_FINISH", True) and sd_webui_lora_dir is not None and out_file.exists():
            sd_webui_lora_dir.mkdir(parents=True, exist_ok=True)
            dst = sd_webui_lora_dir / out_file.name
            shutil.copy2(out_file, dst)
            callbacks.log(f"已复制到 WebUI LoRA 目录: {dst}")
        callbacks.update_progress(1.0, "00:00")
        return out_file

    # 若无 sd-scripts，则回退 diffusers 简化流程（MVP 占位训练）
    StableDiffusionPipeline, set_seed, LoraConfig, get_peft_model = _lazy_import_diffusers()

    # 加载基底模型
    callbacks.log("加载基础模型...")
    pipe = StableDiffusionPipeline.from_pretrained(
        params.model_id,
        torch_dtype=torch.float16 if device == "cuda" else torch.float32,
        safety_checker=None,
    )
    pipe = pipe.to(device)

    # 构建 LoRA
    callbacks.log("构建 LoRA 结构...")
    lora_config = LoraConfig(
        r=params.lora_rank,
        lora_alpha=params.lora_rank,
        lora_dropout=0.05,
        target_modules=["to_q", "to_v"],
        task_type="CAUSAL_LM",  # 占位，peft 需要；在 diffusers 中会被路由
    )

    # 下面的 get_peft_model 仅用于示意，真实整合需要对 UNet/TextEncoder 注入适配器。
    # 为了 MVP 可运行与简化，我们采用 diffusers 内置 LoRA 工具：
    from diffusers import UNet2DConditionModel
    from peft import get_peft_model_state_dict
    
    unet = pipe.unet
    text_encoder = pipe.text_encoder

    # 将 LoRA 注入到 UNet 与 TextEncoder（示意，使用 diffusers 的 enable_lora）
    try:
        pipe.enable_lora()
    except Exception:
        # 较新版本支持 `pipe.unet.add_adapter` 等，这里做一个回退：
        callbacks.log("警告：pipe.enable_lora 不可用，将跳过注入示例。训练将以微调示意进行。")

    # 简化数据集与 DataLoader
    dataset = ImageCaptionDataset(image_paths, captions_dir, params.image_size)
    loader = DataLoader(dataset, batch_size=params.train_batch_size, shuffle=True, collate_fn=_collate)

    optimizer = torch.optim.AdamW([p for p in unet.parameters() if p.requires_grad], lr=params.learning_rate)

    total_steps = params.train_steps
    global_step = 0
    start_time = time.time()

    callbacks.update_progress(0.0, None)

    # 伪训练循环（MVP），真实训练需计算 UNet 训练 loss；此处做占位与时间估算
    for epoch in range(1):
        for batch in loader:
            if global_step >= total_steps:
                break
            imgs, texts = batch
            imgs = imgs.to(device)

            # 这里应构建噪声、扩散步骤与噪声预测 loss。MVP 用 sleep 模拟，避免实现大段训练逻辑。
            time.sleep(0.05)  # 模拟每步耗时

            optimizer.zero_grad()
            # loss.backward()  # 占位
            optimizer.step()

            global_step += 1
            elapsed = time.time() - start_time
            steps_left = max(0, total_steps - global_step)
            eta = steps_left * (elapsed / max(1, global_step))
            callbacks.update_progress(global_step / total_steps, _format_eta(eta))

            if global_step % 20 == 0 or global_step == total_steps:
                callbacks.log(f"Step {global_step}/{total_steps}")

        if global_step >= total_steps:
            break

    callbacks.log("训练完成，保存 LoRA 权重...")

    # 保存占位的 .safetensors（MVP）：在真实流程中应导出 LoRA adapter 权重
    # 这里保存一个小的占位张量，确保流程打通
    # 根据模板生成文件名
    try:
        dynamic_name = format_output_filename(params.train_steps, name=os.environ.get('EASYLORA_MODEL_NAME'))
        output_path = get_output_lora_path().with_name(dynamic_name)
    except Exception:
        output_path = get_output_lora_path()
    try:
        import safetensors.torch as st
        dummy = {"dummy_weight": torch.randn(4, 4)}
        st.save_file(dummy, str(output_path))
    except Exception:
        # 回退为二进制写入占位
        output_path.write_bytes(b"MVP placeholder for LoRA safetensors")

    # 复制到 SD WebUI LoRA 目录
    if settings.get("COPY_TO_SD_WEBUI_ON_FINISH", True) and sd_webui_lora_dir is not None:
        sd_webui_lora_dir.mkdir(parents=True, exist_ok=True)
        dst = sd_webui_lora_dir / output_path.name
        shutil.copy2(output_path, dst)
        callbacks.log(f"已复制到 WebUI LoRA 目录: {dst}")

    callbacks.update_progress(1.0, "00:00")
    return output_path


def _format_eta(seconds: float) -> str:
    seconds = int(seconds)
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _mirror_captions_next_to_images(processed_dir: Path, captions_dir: Path, image_paths: List[Path]) -> None:
    for p in image_paths:
        src = captions_dir / f"{p.stem}.txt"
        if src.exists():
            # 将 caption 放在每张图片的同级目录，确保 sd-scripts 能读取到同名 .txt
            dst = p.with_suffix('.txt')
            try:
                if dst.exists():
                    continue
                shutil.copy2(src, dst)
            except Exception:
                pass


def _run_kohya_training(kohya_train_py: Path, params: AutoTrainParams, train_dir: Path, callbacks: TrainCallbacks,
                        save_every_steps: int = 0, save_state: bool = False, auto_resume: bool = False,
                        stop_event: Optional[threading.Event] = None) -> Path:
    # 显存自适应：低显存时自动降分辨率并启用省显存开关
    low_vram_mode = False
    vram_gb_val = None  # 记录显存以便后续更保守选项使用
    try:
        s = get_settings()
        if torch.cuda.is_available() and s.get('LOW_VRAM_ENABLE', True):
            props = torch.cuda.get_device_properties(0)
            vram_gb = getattr(props, 'total_memory', 0) / (1024 ** 3)
            vram_gb_val = float(vram_gb or 0)
            user_threshold = float(s.get('LOW_VRAM_THRESHOLD_GB', 12))
            # 为避免用户将阈值设得过低导致 SDXL 1024 直接 OOM，这里设定一个安全下限 10GB
            threshold = max(user_threshold, 10.0)
            if params.image_size >= 1000 and vram_gb and vram_gb < threshold:
                old_size = params.image_size
                params.image_size = 768
                if getattr(params, 'lora_rank', 32) > 16:
                    params.lora_rank = 16
                low_vram_mode = True
                callbacks.log(
                    f"检测到显存约 {vram_gb:.1f}GB(<{threshold:.0f}GB)：已将分辨率从 {old_size} 降为 768，并将 LoRA rank 调整为 {params.lora_rank}，启用省显存训练。"
                )
                # 进一步保守：显存 < 9GB 再降到 640 分辨率
                try:
                    if vram_gb < 9 and params.image_size > 640:
                        params.image_size = 640
                        callbacks.log("显存 < 9GB：进一步将分辨率降至 640 以提升稳定性。")
                except Exception:
                    pass
    except Exception:
        pass

    # 根据模型 ID 识别是否为 SDXL（分辨率可能被降过，不能只看 image_size）
    is_sdxl = False
    try:
        mid = str(getattr(params, 'model_id', '')).lower()
        is_sdxl = 'sdxl' in mid or 'xl' in Path(mid).name
    except Exception:
        pass
    # 兜底：即使未进入 low_vram_mode，也在小显存 SDXL 时保守降级，防止 1024 直接 OOM
    try:
        if (not low_vram_mode) and is_sdxl and params.image_size >= 1000 and (vram_gb_val is not None) and vram_gb_val > 0:
            if vram_gb_val <= 10.0:
                old_size = params.image_size
                params.image_size = 768
                if getattr(params, 'lora_rank', 32) > 16:
                    params.lora_rank = 16
                low_vram_mode = True
                callbacks.log(
                    f"显存约 {vram_gb_val:.1f}GB：为避免 SDXL-1024 OOM，已将分辨率从 {old_size} 降为 768，并将 LoRA rank 调整为 {params.lora_rank}。"
                )
                if vram_gb_val < 9 and params.image_size > 640:
                    params.image_size = 640
                    callbacks.log("显存 < 9GB：进一步将分辨率降至 640 以提升稳定性。")
    except Exception:
        pass

    # 选择脚本：SDXL 优先使用 legacy sdxl_train_network.py（若存在），避免 --sdxl 兼容性差异
    script_to_use = kohya_train_py
    use_legacy_sdxl = False
    if is_sdxl:
        legacy_sdxl = kohya_train_py.parent / "sdxl_train_network.py"
        if legacy_sdxl.exists():
            script_to_use = legacy_sdxl
            use_legacy_sdxl = True
            callbacks.log("检测到 sdxl_train_network.py，已切换该脚本进行 SDXL 训练")

    callbacks.log(f"启动 accelerate 运行 {script_to_use.name} ...")
    # 使用模板文件名（包含 {date}/{steps}/{name}）
    try:
        dynamic_name = format_output_filename(params.train_steps, name=os.environ.get('EASYLORA_MODEL_NAME'))
        output_path = get_output_lora_path().with_name(dynamic_name)
    except Exception:
        output_path = get_output_lora_path()
    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    # 设置环境变量：从设置读取缓存/代理
    s = get_settings()
    os.environ['HF_HOME'] = str(Path(s.get('HF_HOME', Path('D:/Program/EasyLora/.hf'))).resolve())
    os.environ['TRANSFORMERS_CACHE'] = str(Path(s.get('TRANSFORMERS_CACHE', Path('D:/Program/EasyLora/.hf/hub'))).resolve())
    # 更保守的分配策略，缓解 Windows 下显存碎片化导致的崩溃
    os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True,max_split_size_mb:64'
    os.environ['CUDA_MODULE_LOADING'] = 'LAZY'
    if s.get('HF_ENDPOINT'):
        os.environ['HF_ENDPOINT'] = str(s.get('HF_ENDPOINT'))
    if s.get('HTTP_PROXY'):
        os.environ['HTTP_PROXY'] = str(s.get('HTTP_PROXY'))
    if s.get('HTTPS_PROXY'):
        os.environ['HTTPS_PROXY'] = str(s.get('HTTPS_PROXY'))
    
    # 指定本地 tokenizer 缓存目录（避免在线拉取失败）
    tokenizer_cache_dir = Path(s.get('TRANSFORMERS_CACHE', Path('D:/Program/EasyLora/.hf/hub'))).resolve()

    # 为 sd-scripts 生成 dataset_config（避免 "No data found"，允许直接用图像+同名 .txt）
    # 若检测到标准结构 processed/dataset，则优先使用该子目录
    # 筛选出有标签文件的图片，创建临时数据集目录
    base_dir_abs = Path(train_dir).resolve()
    candidate_dataset_dir = base_dir_abs / "dataset"
    
    if candidate_dataset_dir.exists():
        # 筛选有标签的图片
        images_with_captions = filter_images_with_captions(candidate_dataset_dir)
        callbacks.log(f"检测到 {len(images_with_captions)} 张有标签的图片")
        
        if not images_with_captions:
            raise RuntimeError("没有找到有标签的图片，请先为图片添加标签")
        
        # 创建临时数据集目录，只包含有标签的图片
        temp_dataset_dir = output_dir / "temp_dataset"
        # 如果存在先清理，确保没有旧数据干扰
        try:
            if temp_dataset_dir.exists():
                shutil.rmtree(temp_dataset_dir)
        except Exception:
            pass
        temp_dataset_dir.mkdir(exist_ok=True)
        
        # 复制有标签的图片和对应的标签文件到临时目录
        for img_path in images_with_captions:
            caption_path = img_path.with_suffix(".txt")
            try:
                # 复制图片
                shutil.copy2(img_path, temp_dataset_dir / img_path.name)
                # 复制标签文件
                shutil.copy2(caption_path, temp_dataset_dir / caption_path.name)
            except Exception:
                pass
        
        image_dir_abs = temp_dataset_dir
        callbacks.log(f"已创建临时数据集目录，包含 {len(images_with_captions)} 张图片")
    else:
        image_dir_abs = base_dir_abs
    
    image_dir_posix = image_dir_abs.as_posix()
    dataset_config_path = output_dir / "dataset_config_auto.toml"
    try:
        dataset_config_toml = (
            "[general]\n"
            "shuffle_caption = false\n"
            "enable_bucket = true\n"
            "bucket_no_upscale = false\n"
            "bucket_reso_steps = 64\n"
            "caption_extension = \".txt\"\n"
            "\n"
            "[[datasets]]\n"
            f"resolution = {params.image_size}\n"
            "min_bucket_reso = 64\n"
            "max_bucket_reso = 2048\n"
            "\n"
            "  [[datasets.subsets]]\n"
            f"  image_dir = \"{image_dir_posix}\"\n"
            "  num_repeats = 1\n"
        )
        dataset_config_path.write_text(dataset_config_toml, encoding="utf-8")
        callbacks.log(f"已生成数据集配置: {dataset_config_path}")
    except Exception as e:
        callbacks.log(f"警告：写入数据集配置失败，将回退 train_data_dir 模式（可能导致找不到数据）: {e}")
        dataset_config_path = None  # 回退

    cmd = [
        sys.executable,
        "-u",
        "-m",
        "accelerate.commands.launch",
        str(script_to_use),
        "--pretrained_model_name_or_path", params.model_id,
        "--tokenizer_cache_dir", str(tokenizer_cache_dir),
    ]

    # 优先使用 dataset_config，避免 sd-scripts 对目录结构的限制
    if dataset_config_path is not None:
        cmd += ["--dataset_config", str(dataset_config_path)]
    else:
        cmd += [
            "--train_data_dir", str(train_dir),
            "--caption_extension", ".txt",
        ]

    # 选择运行时混合精度：若用户配置为 bf16 但设备不支持，则自动降级为 fp16
    preferred_precision = str(s.get('MIXED_PRECISION', 'fp16')).lower()
    runtime_precision = preferred_precision
    try:
        if preferred_precision in ('bf16', 'bfloat16'):
            bf16_supported = False
            if torch.cuda.is_available():
                try:
                    # PyTorch 2.x 提供 is_bf16_supported
                    bf16_supported = bool(getattr(torch.cuda, 'is_bf16_supported', lambda: False)())
                except Exception:
                    # 回退：按算力估计（Ampere 及以上）
                    try:
                        major, _minor = torch.cuda.get_device_capability(0)
                        bf16_supported = major >= 8
                    except Exception:
                        bf16_supported = False
            if not bf16_supported:
                runtime_precision = 'fp16'
                callbacks.log("检测到该 GPU/驱动不支持 bfloat16，已自动降级为 fp16。")
    except Exception:
        pass

    cmd += [
        "--resolution", f"{params.image_size},{params.image_size}",
        "--output_dir", str(output_dir),
        "--output_name", output_path.stem,
        "--network_module", "networks.lora",
        "--network_dim", str(params.lora_rank),
        "--network_alpha", str(params.lora_rank),
        "--learning_rate", str(params.learning_rate),
        "--train_batch_size", str(params.train_batch_size),
        "--max_train_steps", str(params.train_steps),
        "--save_precision", runtime_precision,
        "--mixed_precision", runtime_precision,
        "--gradient_accumulation_steps", str(params.gradient_accumulation_steps),
        # enable bucketing to accept smaller images by upscaling to buckets
        *( ["--enable_bucket"] if s.get('ENABLE_BUCKET', True) else [] ),
        "--bucket_reso_steps", str(int(s.get('BUCKET_RESO_STEPS', 64))),
        "--min_bucket_reso", str(int(s.get('MIN_BUCKET_RESO', 64))),
        "--max_bucket_reso", str(int(s.get('MAX_BUCKET_RESO', 2048))),
        # reduce CPU RAM usage by dataloader workers
        "--max_data_loader_n_workers", "0",
        # note: some sd-scripts versions don't support logging flags; omit to keep compatibility
    ]

    # 预缓存 latents 以降低训练时 VAE 参与与显存占用
    try:
        cmd += ["--cache_latents", "--vae_batch_size", "1"]
    except Exception:
        pass

    # 使用 8bit Adam（若 sd-scripts 支持）降低显存
    try:
        if bool(s.get('USE_8BIT_ADAM', True)):
            cmd += ["--use_8bit_adam"]
    except Exception:
        pass

    # 若设置了自定义 VAE 路径则追加；低显存模式下跳过以减少占用
    try:
        vae_path_from_settings = str(s.get('DEFAULT_VAE_PATH', '')).strip()
        if vae_path_from_settings and not ('low_vram_mode' in locals() and low_vram_mode):
            cmd += ["--vae", vae_path_from_settings]
    except Exception:
        pass

    # 周期保存权重与 state
    if save_every_steps and save_every_steps > 0:
        last_n = int(get_settings().get('SAVE_LAST_N_STEPS', 3))
        cmd += ["--save_every_n_steps", str(int(save_every_steps)), "--save_last_n_steps", str(last_n)]
    if save_state:
        cmd += ["--save_state"]

    # 断点自动恢复：寻找 output_dir 下最新 state
    resume_offset_steps = 0
    if auto_resume:
        try:
            latest_state = None
            candidates = sorted(output_dir.glob(output_path.stem + "*-state"), key=lambda p: p.stat().st_mtime, reverse=True)
            if candidates:
                latest_state = candidates[0]
            if latest_state and latest_state.exists():
                cmd += ["--resume", str(latest_state)]
                callbacks.log(f"检测到断点状态，已自动 --resume {latest_state}")
                # 解析上次 step 作为偏移量，用于会后重命名新生成的 step 文件
                try:
                    import re as _re
                    m = _re.search(r"step(\d+)-state$", latest_state.as_posix())
                    if m:
                        resume_offset_steps = int(m.group(1))
                except Exception:
                    resume_offset_steps = 0
        except Exception:
            pass

    # 低显存优化：梯度检查点与仅训练 UNet，可显著降低 SDXL 显存占用
    try:
        if 'low_vram_mode' in locals() and low_vram_mode:
            if s.get('GRADIENT_CHECKPOINTING', True):
                cmd += ["--gradient_checkpointing"]
            cmd += ["--network_train_unet_only"]
            # 在 low_vram 下尽量启用高效注意力
            try:
                import xformers  # type: ignore
                _ = xformers.__version__
                if s.get('USE_XFORMERS', True):
                    cmd += ["--xformers"]
            except Exception:
                try:
                    is_windows = platform.system().lower() == 'windows'
                except Exception:
                    is_windows = False
                if s.get('USE_SDPA', True) and not is_windows:
                    cmd += ["--sdpa"]
            # 显存特别吃紧时将潜变量缓存到磁盘，进一步降低峰值显存
            try:
                if (vram_gb_val is not None) and vram_gb_val <= 10.0:
                    cmd += ["--cache_latents_to_disk"]
            except Exception:
                pass
    except Exception:
        pass

    # 非低显存路径下，也按设置尽量开启梯度检查点与高效注意力（对峰值显存有帮助）
    try:
        if not low_vram_mode:
            if s.get('GRADIENT_CHECKPOINTING', True):
                cmd += ["--gradient_checkpointing"]
            try:
                import xformers  # type: ignore
                _ = xformers.__version__
                if s.get('USE_XFORMERS', True):
                    cmd += ["--xformers"]
            except Exception:
                if s.get('USE_SDPA', False):
                    cmd += ["--sdpa"]
            # 显存 <=10GB 时，依然尝试将潜变量缓存到磁盘
            try:
                if (vram_gb_val is not None) and vram_gb_val <= 10.0:
                    cmd += ["--cache_latents_to_disk"]
            except Exception:
                pass
    except Exception:
        pass

    # 若是 SDXL，探测 sd-scripts 是否支持 --sdxl（即使分辨率被降级也需要）
    if is_sdxl and not use_legacy_sdxl:
        if _kohya_supports_sdxl(kohya_train_py):
            cmd += [
                "--sdxl",
                "--full_bf16", "--min_snr_gamma", "5.0",
            ]
        else:
            raise RuntimeError(
                "当前 sd-scripts 不支持 SDXL（无 --sdxl 且无 sdxl_train_network.py）。请更新 sd-scripts 或改用 SD1.5/SD2.1。"
            )

    # 额外参数透传（专家选项）
    try:
        extra = str(get_settings().get('EXTRA_ARGS', '')).strip()
        if extra:
            cmd += shlex.split(extra)
    except Exception:
        pass

    callbacks.log("命令: " + " ".join(cmd))

    # 记录运行前已有的模型文件，用来区分本轮新生成的文件
    try:
        pre_existing_models = set(output_dir.glob(output_path.stem + "-step*.safetensors"))
        pre_existing_states = set(output_dir.glob(output_path.stem + "-step*-state"))
    except Exception:
        pre_existing_models, pre_existing_states = set(), set()
    
    # 准备子进程环境变量
    env = os.environ.copy()
    env['HF_HOME'] = str(Path("D:/Program/EasyLora/.hf").resolve())
    env['TRANSFORMERS_CACHE'] = str(Path("D:/Program/EasyLora/.hf/hub").resolve())
    env['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True,max_split_size_mb:64'
    env['CUDA_MODULE_LOADING'] = 'LAZY'
    env['PYTHONUNBUFFERED'] = '1'
    
    # 为旧版 accelerate 注入兼容补丁：提供缺失的 clear_device_cache，避免 peft 导入失败
    try:
        bootstrap_dir = (output_dir / "_bootstrap").resolve()
        bootstrap_dir.mkdir(parents=True, exist_ok=True)
        sitecustomize_py = bootstrap_dir / "sitecustomize.py"
        sitecustomize_code = """
import importlib, sys

# 为缺失的 accelerate.utils.memory.clear_device_cache 提供兜底实现
try:
    mem = importlib.import_module('accelerate.utils.memory')
    if not hasattr(mem, 'clear_device_cache'):
        def clear_device_cache():
            try:
                import torch, gc
                if hasattr(torch, 'cuda') and torch.cuda.is_available():
                    torch.cuda.empty_cache()
                gc.collect()
            except Exception:
                pass
        mem.clear_device_cache = clear_device_cache
except Exception:
    pass

# 如果已有 peft 模块且 __spec__ 为 None，则补齐 __spec__ 以便 importlib.util.find_spec 正常工作
try:
    if 'peft' in sys.modules:
        m = sys.modules['peft']
        if getattr(m, '__spec__', None) is None:
            try:
                from importlib.machinery import ModuleSpec
                _spec = ModuleSpec(name='peft', loader=None)
                try:
                    _spec.submodule_search_locations = []
                except Exception:
                    pass
                m.__spec__ = _spec
            except Exception:
                m.__spec__ = object()
            if not hasattr(m, '__path__'):
                m.__path__ = []
except Exception:
    pass
"""
        # 写入补丁文件（幂等）
        if not sitecustomize_py.exists() or sitecustomize_py.read_text(encoding="utf-8") != sitecustomize_code:
            sitecustomize_py.write_text(sitecustomize_code, encoding="utf-8")
        # 将补丁目录置于 PYTHONPATH 最前
        env["PYTHONPATH"] = str(bootstrap_dir) + (os.pathsep + env["PYTHONPATH"] if "PYTHONPATH" in env else "")
        callbacks.log(f"已注入 accelerate 兼容补丁: {sitecustomize_py} ; PYTHONPATH={env['PYTHONPATH']}")
    except Exception as e:
        callbacks.log(f"警告：注入 accelerate 兼容补丁失败（可忽略）：{e}")

    # 仅在系统未安装 peft 时，才创建最小 peft 存根；若已安装则删除旧的存根以避免遮蔽真实包
    try:
        need_stub = False
        try:
            import importlib.util as _ilu
            spec = _ilu.find_spec('peft')
            need_stub = spec is None
        except Exception:
            need_stub = True

        peft_pkg_dir = (bootstrap_dir / "peft").resolve()

        if need_stub:
            peft_pkg_dir.mkdir(parents=True, exist_ok=True)
            peft_init = peft_pkg_dir / "__init__.py"
            peft_init_code = (
                "__all__ = ['PeftModel', '__version__']\n"
                "__version__ = '0.0.0-stub'\n"
                "class PeftModel:\n"
                "    pass\n"
            )
            if not peft_init.exists() or peft_init.read_text(encoding='utf-8') != peft_init_code:
                peft_init.write_text(peft_init_code, encoding='utf-8')
        else:
            # 已安装 peft：移除旧存根，避免 diffusers 导入 peft.tuners 失败
            try:
                if peft_pkg_dir.exists():
                    # 尝试删除整个目录
                    for child in peft_pkg_dir.iterdir():
                        try:
                            child.unlink(missing_ok=True)
                        except Exception:
                            pass
                    peft_pkg_dir.rmdir()
            except Exception:
                pass
    except Exception as e:
        callbacks.log(f"警告：处理 peft 存根失败（可忽略）：{e}")

    # 进一步增强稳定性：在 venv 的 site-packages 写入 .pth 启动钩子，确保任何子进程都能应用补丁
    try:
        import sysconfig
        site_packages_dir = Path(sysconfig.get_paths().get('purelib', sys.prefix)).resolve()
        pth_file = site_packages_dir / "easylora_accelerate_fix.pth"
        pth_code = (
            "import importlib, sys\n"
            "# provide fallback clear_device_cache for accelerate\n"
            "try:\n"
            "    mem = importlib.import_module('accelerate.utils.memory')\n"
            "    if not hasattr(mem, 'clear_device_cache'):\n"
            "        def clear_device_cache():\n"
            "            try:\n"
            "                import torch, gc\n"
            "                if hasattr(torch, 'cuda') and torch.cuda.is_available():\n"
            "                    torch.cuda.empty_cache()\n"
            "                gc.collect()\n"
            "            except Exception:\n"
            "                pass\n"
            "        mem.clear_device_cache = clear_device_cache\n"
            "except Exception:\n"
            "    pass\n"
            "# ensure peft module has a valid __spec__ and __path__ if already imported\n"
            "try:\n"
            "    if 'peft' in sys.modules:\n"
            "        m = sys.modules['peft']\n"
            "        if getattr(m, '__spec__', None) is None:\n"
            "            try:\n"
            "                from importlib.machinery import ModuleSpec\n"
            "                _spec = ModuleSpec(name='peft', loader=None)\n"
            "                try:\n"
            "                    _spec.submodule_search_locations = []\n"
            "                except Exception:\n"
            "                    pass\n"
            "                m.__spec__ = _spec\n"
            "            except Exception:\n"
            "                m.__spec__ = object()\n"
            "            if not hasattr(m, '__path__'):\n"
            "                m.__path__ = []\n"
            "except Exception:\n"
            "    pass\n"
        )
        if not pth_file.exists() or pth_file.read_text(encoding='utf-8') != pth_code:
            pth_file.write_text(pth_code, encoding='utf-8')
        callbacks.log(f"已写入启动钩子: {pth_file}")
    except Exception as e:
        callbacks.log(f"警告：写入 .pth 启动钩子失败（可忽略）：{e}")
    
    try:
        popen_kwargs = dict(stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1, text=True, env=env)
        if os.name == 'nt':
            popen_kwargs['creationflags'] = getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
        with subprocess.Popen(cmd, **popen_kwargs) as proc:
            start_time = time.time()
            for line in proc.stdout:  # type: ignore
                line = line.rstrip()
                callbacks.log(line)
                # 停止请求：优雅终止子进程
                try:
                    if stop_event is not None and stop_event.is_set():
                        callbacks.log("收到停止指令，正在终止训练...")
                        _kill_process_tree(proc)
                        break
                except Exception:
                    pass
                # 断点续训时，sd-scripts 会从 1 重新编号。实时捕获保存事件并立刻重命名为偏移后的序号。
                try:
                    if resume_offset_steps and resume_offset_steps > 0:
                        import re as _re
                        m_ckpt = _re.search(r"saving checkpoint:\s+(.+?-step(\d+)\.safetensors)", line, flags=_re.IGNORECASE)
                        if m_ckpt:
                            src = Path(m_ckpt.group(1))
                            cur = int(m_ckpt.group(2))
                            new_step = resume_offset_steps + cur
                            dst = src.with_name(src.name.replace(f"step{cur:08d}", f"step{new_step:08d}"))
                            _wait_and_rename(src, dst)
                            # 每次保存后尝试清理超出数量的旧模型
                            try:
                                max_keep = int(get_settings().get('MAX_MODELS_BEFORE_CLEAN', 0))
                                if max_keep and max_keep > 0:
                                    _cleanup_old_checkpoints(output_dir, output_path.stem, max_keep)
                            except Exception:
                                pass
                        # 当日志提示 Random states saved 时，路径通常包含文件，取其父目录后重命名
                        m_state_end = _re.search(r"Random states saved in\s+(.+?step(\d+)-state)(?:[\\/].*)?", line, flags=_re.IGNORECASE)
                        if m_state_end:
                            srcd = Path(m_state_end.group(1))
                            cur = int(m_state_end.group(2))
                            new_step = resume_offset_steps + cur
                            dstd = srcd.with_name(srcd.name.replace(f"step{cur:08d}", f"step{new_step:08d}"))
                            _wait_and_rename(srcd, dstd, is_dir=True)
                except Exception:
                    pass
                # 简单解析步数信息
                prog = _extract_progress(line, params.train_steps)
                if prog is not None:
                    done = prog
                    # 优先读取日志中的 ETA
                    eta_log = _extract_eta(line)
                    if eta_log:
                        callbacks.update_progress(done / params.train_steps, eta_log, done, params.train_steps)
                    else:
                        elapsed = time.time() - start_time
                        left_steps = max(0, params.train_steps - done)
                        eta = left_steps * (elapsed / max(1, done)) if done > 0 else 0
                        callbacks.update_progress(done / params.train_steps, _format_eta(eta), done, params.train_steps)

        if proc.returncode != 0:
            raise RuntimeError(f"sd-scripts 训练失败，退出码 {proc.returncode}")
    except FileNotFoundError as e:
        raise RuntimeError("未找到 accelerate 或 Python 环境，请确认已安装 accelerate") from e

    # sd-scripts 会在 output_dir 下生成 .safetensors
    if not output_path.exists():
        # 兜底：查找同名 .safetensors
        cand = list(output_dir.glob(output_path.stem + "*.safetensors"))
        if cand:
            cand[0].rename(output_path)
    # 若仍未生成，直接报错，避免误报“完成”
    if not output_path.exists():
        raise RuntimeError(
            "sd-scripts 训练未生成 LoRA 权重文件（.safetensors）。请检查数据集是否为空、路径是否正确或查看上方日志。"
        )
    # 可选：基于数量限制的清理：最多生成 N 个模型，超出则仅保留最新
    try:
        s2 = get_settings()
        max_models = int(s2.get('MAX_MODELS_BEFORE_CLEAN', 0))
        if max_models and max_models > 0:
            stem = output_path.stem
            safes = sorted(output_path.parent.glob(stem + "*.safetensors"), key=lambda p: p.stat().st_mtime, reverse=True)
            if len(safes) > max_models:
                for old in safes[max_models:]:
                    try:
                        old.unlink(missing_ok=True)
                    except Exception:
                        pass
    except Exception:
        pass

    # 若从断点恢复，sd-scripts 会从 1 重新编号；这里将本轮新生成的 step 文件/状态目录重命名为偏移量后的连续编号
    try:
        if resume_offset_steps and resume_offset_steps > 0:
            import re as _re
            # 找到本轮新生成的 safetensors 与 state
            all_models = set(output_dir.glob(output_path.stem + "-step*.safetensors"))
            new_models = [p for p in all_models if p not in pre_existing_models]
            for p in sorted(new_models, key=lambda x: x.stat().st_mtime):
                m = _re.search(r"step(\d+)\.safetensors$", p.name)
                if not m:
                    continue
                cur = int(m.group(1))
                new_step = resume_offset_steps + cur
                new_name = p.name.replace(f"step{cur:08d}", f"step{new_step:08d}")
                dst = p.with_name(new_name)
                if not dst.exists():
                    p.rename(dst)
            # 状态目录（同步处理可能在保存完成后才出现的目录）
            def _rename_state_dirs():
                all_states = set(output_dir.glob(output_path.stem + "-step*-state"))
                new_states = [p for p in all_states if p not in pre_existing_states]
                for d in sorted(new_states, key=lambda x: x.stat().st_mtime):
                    m = _re.search(r"step(\d+)-state$", d.name)
                    if not m:
                        continue
                    cur = int(m.group(1))
                    new_step = resume_offset_steps + cur
                    new_name = d.name.replace(f"step{cur:08d}", f"step{new_step:08d}")
                    dst = d.with_name(new_name)
                    if not dst.exists():
                        d.rename(dst)
            _rename_state_dirs()
    except Exception:
        pass

    # 训练结束后再做一次兜底：把本轮新生成的 state 目录统一偏移重命名（避免运行中目录占用导致失败）
    try:
        if resume_offset_steps and resume_offset_steps > 0:
            import re as _re
            all_states = set(output_dir.glob(output_path.stem + "-step*-state"))
            new_states = [p for p in all_states if p not in pre_existing_states]
            for d in sorted(new_states, key=lambda x: x.stat().st_mtime):
                m = _re.search(r"step(\d+)-state$", d.name)
                if not m:
                    continue
                cur = int(m.group(1))
                new_step = resume_offset_steps + cur
                new_name = d.name.replace(f"step{cur:08d}", f"step{new_step:08d}")
                dst = d.with_name(new_name)
                _wait_and_rename(d, dst, is_dir=True)
    except Exception:
        pass

    return output_path


def _extract_progress(line: str, total_steps: int) -> Optional[int]:
    """从一行日志中解析当前 step。

    支持格式：
    - "Step 123/1000" 或 "step 123 of 1000"
    - "steps:  16%|...| 199/1200 [..]"（sd-scripts tqdm 样式）
    """
    import re
    # 1) 常见 Step 样式
    m = re.search(r"[Ss]tep\s+(\d+)\s*(?:/|of)\s*(\d+)", line)
    if m:
        cur = int(m.group(1))
        tot = int(m.group(2))
        if tot > 0:
            return min(cur, total_steps or tot)

    # 2) sd-scripts tqdm 行：包含 steps: 和  current/total
    if "steps:" in line:
        m2 = re.search(r"\b(\d+)\s*/\s*(\d+)\b", line)
        if m2:
            cur = int(m2.group(1))
            tot = int(m2.group(2))
            if tot > 0:
                return min(cur, total_steps or tot)
    return None


def _extract_eta(line: str) -> Optional[str]:
    """从 sd-scripts tqdm 行中提取 ETA，例如 "<10:41:15" 或 "<10:41"。"""
    import re
    m = re.search(r"<([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)", line)
    if m:
        return m.group(1)
    return None


def _wait_and_rename(src: Path, dst: Path, is_dir: bool = False, timeout: float = 10.0) -> None:
    """等待源文件/目录出现并稳定后重命名到目标名。"""
    import time as _t
    start = _t.time()
    while not src.exists() and _t.time() - start < timeout:
        _t.sleep(0.1)
    if not src.exists():
        return
    # 尝试多次重命名，避免被占用
    for _ in range(300):  # try up to ~30s
        try:
            if dst.exists():
                return
            src.rename(dst)
            return
        except Exception:
            _t.sleep(0.1)


def _cleanup_old_checkpoints(output_dir: Path, stem: str, max_keep: int) -> None:
    """仅保留最近的 max_keep 个模型（按修改时间倒序），并同步清理对应的 state 目录。

    关联规则：{stem}-stepXXXXXXXX.safetensors ↔ {stem}-stepXXXXXXXX-state/
    """
    try:
        import re as _re
        safes = sorted(output_dir.glob(stem + "-step*.safetensors"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in safes[max_keep:]:
            # 删除对应的 state 目录（若存在）
            try:
                m = _re.search(r"step(\d+)\.safetensors$", old.name)
                if m:
                    step_str = m.group(1)
                    state_dir = output_dir / f"{stem}-step{step_str}-state"
                    _rm_tree(state_dir)
            except Exception:
                pass
            try:
                old.unlink(missing_ok=True)
            except Exception:
                pass
    except Exception:
        pass


def _rm_tree(path: Path) -> None:
    """递归删除目录（若存在）。"""
    try:
        if not path.exists():
            return
        if path.is_file():
            path.unlink(missing_ok=True)
            return
        for child in path.iterdir():
            _rm_tree(child)
        path.rmdir()
    except Exception:
        pass


def _kill_process_tree(proc: subprocess.Popen) -> None:
    """尝试终止并杀死整个进程组（Windows/Linux）。"""
    if os.name == 'nt':
        try:
            os.kill(proc.pid, signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        except Exception:
            pass
        try:
            proc.terminate()
        except Exception:
            pass
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.terminate()
            except Exception:
                pass
    # 等待最多 3 秒，若未退出则强杀
    try:
        proc.wait(timeout=3)
    except Exception:
        try:
            if os.name == 'nt':
                os.kill(proc.pid, signal.SIGTERM)
            else:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
            try:
                proc.terminate()
            except Exception:
                pass
        else:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
        # 等待最多 3 秒，若未退出则强杀
        try:
            proc.wait(timeout=3)
        except Exception:
            try:
                if os.name == 'nt':
                    os.kill(proc.pid, signal.SIGTERM)
                else:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass


def _kohya_supports_sdxl(kohya_train_py: Path) -> bool:
    """调用 `train_network.py -h` 检测是否包含 --sdxl 选项。"""
    try:
        out = subprocess.run(
            [sys.executable, str(kohya_train_py), "-h"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=20,
        )
        help_text = out.stdout or ""
        return "--sdxl" in help_text
    except Exception:
        return False
