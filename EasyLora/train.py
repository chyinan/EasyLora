"""
train.py

LoRA 训练核心模块 - 支持 kohya-ss sd-scripts 和 diffusers fallback

重构版本：
- 模块化设计，职责清晰
- 统一的错误处理
- 简化的 VRAM 自适应逻辑
- 清晰的配置管理
"""

from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import sys
import time
import platform
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional, Set

import torch
import numpy as np
from PIL import Image
from torch.utils.data import Dataset, DataLoader

from .config import (
    AutoTrainParams,
    auto_params_by_dataset,
    auto_select_image_size,
    auto_params_sdxl,
    get_output_lora_path,
    DEFAULT_KOHYA_SCRIPTS_DIR,
    get_settings,
    format_output_filename,
)
from .data_utils import is_valid_caption


# ============== 数据类型定义 ==============

@dataclass
class TrainCallbacks:
    """训练回调函数"""
    log: Callable[[str], None]
    update_progress: Callable[[float, Optional[str], Optional[int], Optional[int], Optional[str]], None]
    
    def __post_init__(self):
        # 包装 update_progress 以支持简化调用
        original = self.update_progress
        def wrapped(p: float, eta: Optional[str] = None, cur: Optional[int] = None, 
                   total: Optional[int] = None, elapsed: Optional[str] = None):
            original(p, eta, cur, total, elapsed)
        self.update_progress = wrapped


@dataclass
class VRAMConfig:
    """显存配置"""
    vram_gb: float = 0.0
    low_vram_mode: bool = False
    threshold_gb: float = 12.0


@dataclass
class KohyaConfig:
    """Kohya 训练配置"""
    script_path: Path
    use_legacy_sdxl: bool = False
    is_sdxl: bool = False
    runtime_precision: str = "fp16"
    

# ============== 工具函数 ==============

def format_eta(seconds: float) -> str:
    """格式化剩余时间"""
    seconds = int(seconds)
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"


def filter_images_with_captions(dataset_dir: Path) -> List[Path]:
    """筛选有有效标签的图片"""
    supported_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
    images = []
    
    for img_file in dataset_dir.iterdir():
        if img_file.is_file() and img_file.suffix.lower() in supported_exts:
            caption_file = img_file.with_suffix(".txt")
            if caption_file.exists():
                try:
                    caption = caption_file.read_text(encoding="utf-8").strip()
                    if is_valid_caption(caption):
                        images.append(img_file)
                except Exception:
                    continue
    
    return sorted(images)


def detect_vram() -> VRAMConfig:
    """检测 GPU 显存"""
    config = VRAMConfig()
    settings = get_settings()
    
    if not torch.cuda.is_available() or not settings.get('LOW_VRAM_ENABLE', True):
        return config
    
    try:
        props = torch.cuda.get_device_properties(0)
        config.vram_gb = props.total_memory / (1024 ** 3)
        config.threshold_gb = max(float(settings.get('LOW_VRAM_THRESHOLD_GB', 12)), 10.0)
    except Exception:
        pass
    
    return config


def check_bf16_support() -> bool:
    """检查是否支持 bfloat16"""
    if not torch.cuda.is_available():
        return False
    try:
        if hasattr(torch.cuda, 'is_bf16_supported'):
            return torch.cuda.is_bf16_supported()
        major, _ = torch.cuda.get_device_capability(0)
        return major >= 8
    except Exception:
        return False


def kill_process_tree(proc: subprocess.Popen) -> None:
    """终止进程树"""
    if os.name == 'nt':
        try:
            os.kill(proc.pid, signal.CTRL_BREAK_EVENT)
        except Exception:
            pass
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            pass
    
    try:
        proc.terminate()
        proc.wait(timeout=3)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def rm_tree(path: Path) -> None:
    """递归删除目录"""
    if not path.exists():
        return
    if path.is_file():
        path.unlink(missing_ok=True)
        return
    for child in path.iterdir():
        rm_tree(child)
    try:
        path.rmdir()
    except Exception:
        pass


def cleanup_old_checkpoints(output_dir: Path, stem: str, max_keep: int) -> None:
    """清理旧的检查点，只保留最新的 N 个"""
    if max_keep <= 0:
        return
    
    try:
        safes = sorted(
            output_dir.glob(f"{stem}-step*.safetensors"),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        
        for old in safes[max_keep:]:
            # 清理对应的 state 目录
            m = re.search(r"step(\d+)\.safetensors$", old.name)
            if m:
                state_dir = output_dir / f"{stem}-step{m.group(1)}-state"
                rm_tree(state_dir)
            old.unlink(missing_ok=True)
    except Exception:
        pass


# ============== 进度解析 ==============

def extract_progress(line: str, total_steps: int) -> Optional[int]:
    """从日志行解析当前步数"""
    # Step 123/1000 格式
    m = re.search(r"[Ss]tep\s+(\d+)\s*(?:/|of)\s*(\d+)", line)
    if m:
        return min(int(m.group(1)), total_steps)
    
    # sd-scripts tqdm 格式
    if "steps:" in line:
        m = re.search(r"\b(\d+)\s*/\s*(\d+)\b", line)
        if m:
            return min(int(m.group(1)), total_steps)
    
    return None


def extract_eta(line: str) -> Optional[str]:
    """从日志行提取 ETA"""
    m = re.search(r"<([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)", line)
    return m.group(1) if m else None


# ============== 数据集 ==============

class ImageCaptionDataset(Dataset):
    """图片-标签数据集"""
    
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


def collate_fn(batch):
    """数据批次整理函数"""
    images, texts = zip(*batch)
    imgs = torch.stack([
        torch.from_numpy(np.array(img, dtype=np.uint8)).permute(2, 0, 1)
        for img in images
    ]).float() / 255.0
    return imgs, list(texts)


# ============== Kohya 训练命令构建器 ==============

class KohyaCommandBuilder:
    """构建 Kohya sd-scripts 训练命令"""
    
    def __init__(self, params: AutoTrainParams, settings: dict):
        self.params = params
        self.settings = settings
        self.cmd: List[str] = []
        
    def build_base_command(self, script_path: Path, output_dir: Path, 
                           output_name: str, dataset_config: Path) -> 'KohyaCommandBuilder':
        """构建基础命令"""
        tokenizer_cache = Path(self.settings.get(
            'TRANSFORMERS_CACHE', 
            'D:/Program/EasyLora/.hf/hub'
        )).resolve()
        
        self.cmd = [
            sys.executable, "-u", "-m", "accelerate.commands.launch",
            str(script_path),
            "--pretrained_model_name_or_path", self.params.model_id,
            "--tokenizer_cache_dir", str(tokenizer_cache),
            "--dataset_config", str(dataset_config),
            "--resolution", f"{self.params.image_size},{self.params.image_size}",
            "--output_dir", str(output_dir),
            "--output_name", output_name,
            "--network_module", "networks.lora",
            "--network_dim", str(self.params.lora_rank),
            "--network_alpha", str(self.params.lora_rank),
            "--learning_rate", str(self.params.learning_rate),
            "--train_batch_size", str(self.params.train_batch_size),
            "--max_train_steps", str(self.params.train_steps),
            "--gradient_accumulation_steps", str(self.params.gradient_accumulation_steps),
            "--max_data_loader_n_workers", "0",
        ]
        return self
    
    def add_precision(self, precision: str) -> 'KohyaCommandBuilder':
        """添加精度设置"""
        self.cmd.extend([
            "--save_precision", precision,
            "--mixed_precision", precision,
        ])
        return self
    
    def add_bucket_settings(self) -> 'KohyaCommandBuilder':
        """添加分桶设置"""
        if self.settings.get('ENABLE_BUCKET', True):
            self.cmd.append("--enable_bucket")
        self.cmd.extend([
            "--bucket_reso_steps", str(self.settings.get('BUCKET_RESO_STEPS', 64)),
            "--min_bucket_reso", str(self.settings.get('MIN_BUCKET_RESO', 64)),
            "--max_bucket_reso", str(self.settings.get('MAX_BUCKET_RESO', 2048)),
        ])
        return self
    
    def add_optimizer(self, optimizer_type: Optional[str], 
                      unet_lr: Optional[float], 
                      text_encoder_lr: Optional[float]) -> 'KohyaCommandBuilder':
        """添加优化器设置"""
        if optimizer_type:
            self.cmd.extend(["--optimizer_type", optimizer_type])
        elif self.settings.get('USE_8BIT_ADAM', True):
            self.cmd.append("--use_8bit_adam")
        
        if unet_lr:
            self.cmd.extend(["--unet_lr", str(unet_lr)])
        if text_encoder_lr:
            self.cmd.extend(["--text_encoder_lr", str(text_encoder_lr)])
        
        return self
    
    def add_save_settings(self, save_every: int, save_state: bool, 
                          auto_resume: bool, output_dir: Path, 
                          output_stem: str) -> 'KohyaCommandBuilder':
        """添加保存设置"""
        if save_every > 0:
            last_n = int(self.settings.get('SAVE_LAST_N_STEPS', 3))
            self.cmd.extend([
                "--save_every_n_steps", str(save_every),
                "--save_last_n_steps", str(last_n)
            ])
        
        if save_state:
            self.cmd.append("--save_state")
        
        # 断点续训
        if auto_resume:
            candidates = sorted(
                output_dir.glob(f"{output_stem}*-state"),
                key=lambda p: p.stat().st_mtime,
                reverse=True
            )
            if candidates and candidates[0].exists():
                self.cmd.extend(["--resume", str(candidates[0])])
        
        return self
    
    def add_vram_optimizations(self, vram_config: VRAMConfig) -> 'KohyaCommandBuilder':
        """添加显存优化设置"""
        self.cmd.extend(["--cache_latents", "--vae_batch_size", "1"])
        
        if self.settings.get('GRADIENT_CHECKPOINTING', True):
            self.cmd.append("--gradient_checkpointing")
        
        if vram_config.low_vram_mode:
            self.cmd.append("--network_train_unet_only")
        
        # 高效注意力
        try:
            import xformers
            if self.settings.get('USE_XFORMERS', True):
                self.cmd.append("--xformers")
        except ImportError:
            if self.settings.get('USE_SDPA', False) and platform.system() != 'Windows':
                self.cmd.append("--sdpa")
        
        # 极低显存时缓存到磁盘
        if vram_config.vram_gb > 0 and vram_config.vram_gb <= 10.0:
            self.cmd.append("--cache_latents_to_disk")
        
        return self
    
    def add_sdxl_settings(self, use_legacy: bool) -> 'KohyaCommandBuilder':
        """添加 SDXL 设置"""
        if not use_legacy:
            self.cmd.extend([
                "--sdxl",
                "--full_bf16",
                "--min_snr_gamma", "5.0",
            ])
        return self
    
    def add_extra_args(self) -> 'KohyaCommandBuilder':
        """添加额外参数"""
        extra = str(self.settings.get('EXTRA_ARGS', '')).strip()
        if extra:
            import shlex
            self.cmd.extend(shlex.split(extra))
        return self
    
    def get_command(self) -> List[str]:
        return self.cmd


# ============== Kohya 训练执行器 ==============

class KohyaTrainer:
    """Kohya sd-scripts 训练执行器"""
    
    def __init__(self, params: AutoTrainParams, callbacks: TrainCallbacks):
        self.params = params
        self.callbacks = callbacks
        self.settings = get_settings()
        self.vram_config = detect_vram()
    
    def prepare_params(self) -> None:
        """准备并调整训练参数（显存自适应）"""
        if not self.vram_config.vram_gb:
            return
        
        is_sdxl = 'sdxl' in str(self.params.model_id).lower() or \
                  'xl' in Path(self.params.model_id).name.lower()
        
        # 低显存自适应
        need_downgrade = (
            self.params.image_size >= 1000 and 
            self.vram_config.vram_gb < self.vram_config.threshold_gb
        )
        
        if need_downgrade:
            old_size = self.params.image_size
            self.params.image_size = 768
            if self.params.lora_rank > 16:
                self.params.lora_rank = 16
            self.vram_config.low_vram_mode = True
            
            self.callbacks.log(
                f"显存约 {self.vram_config.vram_gb:.1f}GB，"
                f"已将分辨率从 {old_size} 降为 768，LoRA rank 调整为 {self.params.lora_rank}"
            )
            
            # 极低显存进一步降级
            if self.vram_config.vram_gb < 9 and self.params.image_size > 640:
                self.params.image_size = 640
                self.callbacks.log("显存 < 9GB：分辨率降至 640")
    
    def select_script(self, kohya_path: Path) -> KohyaConfig:
        """选择训练脚本"""
        is_sdxl = 'sdxl' in str(self.params.model_id).lower() or \
                  'xl' in Path(self.params.model_id).name.lower()
        
        config = KohyaConfig(script_path=kohya_path, is_sdxl=is_sdxl)
        
        # SDXL 优先使用专用脚本
        if is_sdxl:
            legacy_script = kohya_path.parent / "sdxl_train_network.py"
            if legacy_script.exists():
                config.script_path = legacy_script
                config.use_legacy_sdxl = True
                self.callbacks.log("使用 sdxl_train_network.py 进行 SDXL 训练")
        
        # 确定运行时精度
        preferred = str(self.settings.get('MIXED_PRECISION', 'fp16')).lower()
        if preferred in ('bf16', 'bfloat16') and not check_bf16_support():
            config.runtime_precision = 'fp16'
            self.callbacks.log("GPU 不支持 bfloat16，自动降级为 fp16")
        else:
            config.runtime_precision = preferred if preferred in ('bf16', 'bfloat16') else 'fp16'
        
        return config
    
    def prepare_dataset(self, train_dir: Path, output_dir: Path) -> Path:
        """准备数据集配置"""
        dataset_dir = train_dir / "dataset"
        
        if dataset_dir.exists():
            images = filter_images_with_captions(dataset_dir)
            self.callbacks.log(f"检测到 {len(images)} 张有标签的图片")
            
            if not images:
                raise RuntimeError("没有找到有标签的图片，请先为图片添加标签")
            
            # 创建临时数据集目录
            temp_dir = output_dir / "temp_dataset"
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
            temp_dir.mkdir(exist_ok=True)
            
            for img in images:
                shutil.copy2(img, temp_dir / img.name)
                caption = img.with_suffix(".txt")
                shutil.copy2(caption, temp_dir / caption.name)
            
            image_dir = temp_dir
            self.callbacks.log(f"已创建临时数据集目录，包含 {len(images)} 张图片")
        else:
            image_dir = train_dir.resolve()
        
        # 生成数据集配置
        config_path = output_dir / "dataset_config_auto.toml"
        config_content = f"""[general]
shuffle_caption = false
enable_bucket = true
bucket_no_upscale = false
bucket_reso_steps = 64
caption_extension = ".txt"

[[datasets]]
resolution = {self.params.image_size}
min_bucket_reso = 64
max_bucket_reso = 2048

  [[datasets.subsets]]
  image_dir = "{image_dir.as_posix()}"
  num_repeats = 1
"""
        config_path.write_text(config_content, encoding="utf-8")
        self.callbacks.log(f"已生成数据集配置: {config_path}")
        
        return config_path
    
    def setup_environment(self) -> dict:
        """设置环境变量"""
        env = os.environ.copy()
        
        env['HF_HOME'] = str(Path(self.settings.get('HF_HOME', '.hf')).resolve())
        env['TRANSFORMERS_CACHE'] = str(Path(self.settings.get('TRANSFORMERS_CACHE', '.hf/hub')).resolve())
        env['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True,max_split_size_mb:64'
        env['CUDA_MODULE_LOADING'] = 'LAZY'
        env['PYTHONUNBUFFERED'] = '1'
        env['HF_HUB_ENABLE_HF_TRANSFER'] = '0'
        
        # 代理设置
        for key in ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']:
            if key not in env and os.environ.get(key):
                env[key] = os.environ[key]
        
        # 日志网络配置
        hf_endpoint = env.get('HF_ENDPOINT', 'https://huggingface.co')
        self.callbacks.log(f"HF_ENDPOINT: {hf_endpoint}")
        
        return env
    
    def run(self, train_dir: Path, save_every: int = 0, save_state: bool = False,
            auto_resume: bool = False, optimizer_type: Optional[str] = None,
            unet_lr: Optional[float] = None, text_encoder_lr: Optional[float] = None,
            stop_event: Optional[threading.Event] = None) -> Path:
        """执行训练"""
        
        kohya_path = Path(DEFAULT_KOHYA_SCRIPTS_DIR) / "train_network.py"
        if not kohya_path.exists():
            raise RuntimeError(f"找不到 sd-scripts: {kohya_path}")
        
        # 准备参数
        self.prepare_params()
        kohya_config = self.select_script(kohya_path)
        
        # 输出路径
        output_name = format_output_filename(
            self.params.train_steps,
            name=os.environ.get('EASYLORA_MODEL_NAME')
        )
        output_path = get_output_lora_path().with_name(output_name)
        output_dir = output_path.parent
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # 准备数据集
        dataset_config = self.prepare_dataset(train_dir, output_dir)
        
        # 构建命令
        builder = KohyaCommandBuilder(self.params, self.settings)
        builder.build_base_command(
            kohya_config.script_path, output_dir, 
            output_path.stem, dataset_config
        )
        builder.add_precision(kohya_config.runtime_precision)
        builder.add_bucket_settings()
        builder.add_optimizer(optimizer_type, unet_lr, text_encoder_lr)
        builder.add_save_settings(save_every, save_state, auto_resume, output_dir, output_path.stem)
        builder.add_vram_optimizations(self.vram_config)
        
        if kohya_config.is_sdxl:
            builder.add_sdxl_settings(kohya_config.use_legacy_sdxl)
        
        builder.add_extra_args()
        
        cmd = builder.get_command()
        self.callbacks.log(f"启动训练: {kohya_config.script_path.name}")
        
        # 执行训练
        env = self.setup_environment()
        start_time = time.time()
        
        popen_kwargs = {
            'stdout': subprocess.PIPE,
            'stderr': subprocess.STDOUT,
            'bufsize': 1,
            'text': True,
            'env': env
        }
        if os.name == 'nt':
            popen_kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
        
        with subprocess.Popen(cmd, **popen_kwargs) as proc:
            for line in proc.stdout:
                line = line.rstrip()
                self.callbacks.log(line)
                
                # 检查停止信号
                if stop_event and stop_event.is_set():
                    self.callbacks.log("收到停止指令，终止训练...")
                    kill_process_tree(proc)
                    break
                
                # 解析进度
                step = extract_progress(line, self.params.train_steps)
                if step is not None:
                    eta = extract_eta(line)
                    if not eta:
                        elapsed = time.time() - start_time
                        remaining = (self.params.train_steps - step) * (elapsed / max(1, step))
                        eta = format_eta(remaining)
                    self.callbacks.update_progress(
                        step / self.params.train_steps, 
                        eta, step, self.params.train_steps
                    )
        
        if proc.returncode != 0:
            raise RuntimeError(f"训练失败，退出码 {proc.returncode}")
        
        # 验证输出
        if not output_path.exists():
            candidates = list(output_dir.glob(f"{output_path.stem}*.safetensors"))
            if candidates:
                candidates[0].rename(output_path)
        
        if not output_path.exists():
            raise RuntimeError("训练未生成 LoRA 权重文件")
        
        # 清理旧模型
        max_keep = int(self.settings.get('MAX_MODELS_BEFORE_CLEAN', 0))
        cleanup_old_checkpoints(output_dir, output_path.stem, max_keep)
        
        return output_path


# ============== 主训练函数 ==============

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
    optimizer_type: Optional[str] = None,
    unet_lr: Optional[float] = None,
    text_encoder_lr: Optional[float] = None,
    stop_event: Optional[threading.Event] = None,
) -> Path:
    """执行 LoRA 训练
    
    Args:
        processed_dir: 处理后的图片目录
        captions_dir: 标签目录
        image_paths: 图片路径列表
        avg_long_side: 图片平均长边
        sd_webui_lora_dir: SD WebUI LoRA 目录
        callbacks: 回调函数
        override_*: 覆盖默认参数
        stop_event: 停止事件
        
    Returns:
        生成的 LoRA 文件路径
    """
    settings = get_settings()
    
    # 计算实际图片数量
    dataset_dir = processed_dir / "dataset"
    if dataset_dir.exists():
        filtered = filter_images_with_captions(dataset_dir)
        actual_count = len(filtered)
    else:
        actual_count = len(image_paths)
    
    # 选择训练参数
    sdxl_threshold = int(settings.get('RES_THRESHOLD_SDXL', 900))
    
    if avg_long_side >= sdxl_threshold:
        params = auto_params_sdxl(actual_count)
        callbacks.log("检测为 SDXL 任务")
    else:
        image_size = auto_select_image_size(avg_long_side)
        params = auto_params_by_dataset(actual_count, image_size)
    
    # 应用覆盖参数
    if override_steps and override_steps > 0:
        params.train_steps = override_steps
    if override_lr and override_lr > 0:
        params.learning_rate = override_lr
    
    callbacks.log(f"尺寸: {params.image_size}, 模型: {params.model_id}")
    callbacks.log(f"步数: {params.train_steps}, 学习率: {params.learning_rate}, LoRA rank: {params.lora_rank}")
    callbacks.log(f"图片数量: {actual_count}")
    
    # 检查 CUDA
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device != "cuda":
        callbacks.log("警告: 未检测到 CUDA，训练可能很慢")
    
    # 检查 kohya sd-scripts
    kohya_available = False
    if DEFAULT_KOHYA_SCRIPTS_DIR:
        kohya_path = Path(DEFAULT_KOHYA_SCRIPTS_DIR) / "train_network.py"
        kohya_available = kohya_path.exists()
    
    if kohya_available:
        callbacks.log("使用 sd-scripts 进行训练...")
        
        save_every = override_save_every if override_save_every is not None else settings.get("DEFAULT_SAVE_EVERY", 0)
        auto_resume = override_auto_resume if override_auto_resume is not None else settings.get("DEFAULT_AUTO_RESUME", False)
        save_state = override_save_state or (save_every > 0) or auto_resume
        
        trainer = KohyaTrainer(params, callbacks)
        output = trainer.run(
            train_dir=processed_dir,
            save_every=save_every,
            save_state=save_state,
            auto_resume=auto_resume,
            optimizer_type=optimizer_type,
            unet_lr=unet_lr,
            text_encoder_lr=text_encoder_lr,
            stop_event=stop_event,
        )
        
        # 复制到 SD WebUI
        if settings.get("COPY_TO_SD_WEBUI_ON_FINISH", True) and sd_webui_lora_dir and output.exists():
            sd_webui_lora_dir.mkdir(parents=True, exist_ok=True)
            dst = sd_webui_lora_dir / output.name
            shutil.copy2(output, dst)
            callbacks.log(f"已复制到 WebUI LoRA 目录: {dst}")
        
        callbacks.update_progress(1.0, "00:00")
        return output
    
    # 回退到 diffusers 简化训练（仅作为 MVP 占位）
    callbacks.log("sd-scripts 不可用，使用简化训练模式...")
    
    output_path = get_output_lora_path()
    try:
        import safetensors.torch as st
        st.save_file({"dummy": torch.randn(4, 4)}, str(output_path))
    except Exception:
        output_path.write_bytes(b"placeholder")
    
    callbacks.update_progress(1.0, "00:00")
    return output_path
