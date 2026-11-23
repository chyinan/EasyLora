"""
train.py

LoRA 训练核心模块 - 使用 kohya-ss sd-scripts 进行单 GPU 训练

重构版本：
- 模块化设计，职责清晰
- 统一的错误处理
- 简化的 VRAM 自适应逻辑
- 清晰的配置管理
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional

from safetensors import safe_open

from .config import (
    AutoTrainParams,
    auto_params_by_dataset,
    auto_select_image_size,
    auto_params_sdxl,
    get_output_lora_path,
    resolve_project_path,
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
    runtime_precision: str = "fp16"
    

# ============== 工具函数 ==============

def format_eta(seconds: float) -> str:
    """格式化剩余时间"""
    seconds = int(seconds)
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"


def require_cuda():
    """Fail before spawning a trainer; device enumeration alone cannot verify a Blackwell wheel."""
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("未安装 PyTorch。请按 README 安装与显卡匹配的 CUDA 版 PyTorch。") from exc
    if not torch.cuda.is_available():
        raise RuntimeError("未检测到可用 CUDA GPU；请检查 NVIDIA 驱动和 CUDA 版 PyTorch。")
    try:
        torch.ones(1, device="cuda").add_(1).item()
    except RuntimeError as exc:
        raise RuntimeError(f"PyTorch 无法在当前显卡上执行 CUDA 运算，请核对驱动及 CUDA wheel：{exc}") from exc
    return torch


def validate_lora(path: Path) -> None:
    """Only publish the fresh final file containing Kohya adapter matrices."""
    if not path.is_file():
        raise RuntimeError("训练未生成最终 LoRA 文件（中间检查点不作为最终产物）")
    try:
        with safe_open(str(path), framework="np") as tensors:
            keys = set(tensors.keys())
            for key in keys:
                if key.startswith("lora_") and key.endswith(".lora_down.weight"):
                    up = key[:-len(".lora_down.weight")] + ".lora_up.weight"
                    if up in keys:
                        down_shape = tensors.get_slice(key).get_shape()
                        up_shape = tensors.get_slice(up).get_shape()
                        if (len(down_shape) in (2, 4) and len(up_shape) == len(down_shape)
                                and all(down_shape) and all(up_shape) and down_shape[0] == up_shape[1]):
                            return
    except Exception as exc:
        raise RuntimeError(f"无法读取训练产物 {path.name}: {exc}") from exc
    raise RuntimeError(f"训练产物 {path.name} 不含配对的 Kohya LoRA 权重")


def detect_vram(torch) -> VRAMConfig:
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


def check_bf16_support(torch) -> bool:
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
    if proc.poll() is not None:
        return
    if os.name == "nt":
        # Target this job and its children, not every python.exe on the machine.
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        # Popen(start_new_session=True) made this PID the leader of a private group.
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            proc.kill()
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
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


# ============== Kohya 训练命令构建器 ==============

class KohyaCommandBuilder:
    """构建 Kohya sd-scripts 训练命令"""
    
    def __init__(self, params: AutoTrainParams, settings: dict):
        self.params = params
        self.settings = settings
        self.cmd: List[str] = []
        
    def build_base_command(self, script_path: Path, output_dir: Path, 
                           output_name: str, dataset_config: Path, start_step: int = 0) -> 'KohyaCommandBuilder':
        """构建基础命令"""
        # Accelerator works directly under Python in single-GPU mode. Do not inherit
        # distributed launcher defaults from a user's unrelated accelerate config.
        self.cmd = [
            sys.executable, "-u", str(script_path),
            "--pretrained_model_name_or_path", self.params.model_id,
            "--save_model_as", "safetensors",
            "--dataset_config", str(dataset_config),
            "--resolution", f"{self.params.image_size},{self.params.image_size}",
            "--output_dir", str(output_dir),
            "--output_name", output_name,
            "--network_module", "networks.lora",
            "--network_dim", str(self.params.lora_rank),
            "--network_alpha", str(self.params.lora_rank),
            "--learning_rate", str(self.params.learning_rate),
            "--train_batch_size", str(self.params.train_batch_size),
            "--max_train_steps", str(self.params.train_steps - start_step),
            "--gradient_accumulation_steps", str(self.params.gradient_accumulation_steps),
            "--max_data_loader_n_workers", "0",
        ]
        if self.settings.get("DEFAULT_VAE_PATH"):
            self.cmd.extend(["--vae", str(resolve_project_path(self.settings["DEFAULT_VAE_PATH"]))])
        if self.params.model_family == "SD2.1":
            self.cmd.extend(["--v2", "--v_parameterization"])
        if self.params.model_family == "SDXL":
            self.cmd.append("--no_half_vae")
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
        elif self.settings.get('USE_8BIT_ADAM', False):
            self.cmd.append("--use_8bit_adam")
        
        if unet_lr:
            self.cmd.extend(["--unet_lr", str(unet_lr)])
        if text_encoder_lr:
            self.cmd.extend(["--text_encoder_lr", str(text_encoder_lr)])
        
        return self
    
    def add_save_settings(self, save_every: int, save_state: bool,
                          resume: Optional[Path]) -> 'KohyaCommandBuilder':
        if save_every > 0:
            self.cmd.extend(["--save_every_n_steps", str(save_every)])
            keep = int(self.settings.get("SAVE_LAST_N_STEPS", 3))
            if keep > 0:
                # Upstream uses a distance in steps, not the number of checkpoint files.
                self.cmd.extend(["--save_last_n_steps", str((keep - 1) * save_every)])
        if save_state:
            self.cmd.append("--save_state")
        if resume is not None:
            # The optimizer/network/RNG are restored by Accelerate. External offset +
            # a remaining-step budget avoids sd-scripts counting skipped batches as
            # completed optimizer steps when accumulation or epoch boundaries apply.
            self.cmd.extend(["--resume", str(resume), "--initial_step", "0"])
        return self

    def add_vram_optimizations(self, vram_config: VRAMConfig) -> 'KohyaCommandBuilder':
        """添加显存优化设置"""
        self.cmd.extend(["--cache_latents", "--vae_batch_size", "1"])
        
        if self.settings.get('GRADIENT_CHECKPOINTING', True):
            self.cmd.append("--gradient_checkpointing")
        
        if vram_config.low_vram_mode:
            self.cmd.append("--network_train_unet_only")
        
        if self.settings.get('USE_XFORMERS', False):
            self.cmd.append("--xformers")
        elif self.settings.get('USE_SDPA', True):
            self.cmd.append("--sdpa")

        # 极低显存时缓存到磁盘
        if vram_config.vram_gb > 0 and vram_config.vram_gb <= 10.0:
            self.cmd.append("--cache_latents_to_disk")
        
        return self
    
    def add_extra_args(self) -> 'KohyaCommandBuilder':
        """添加额外参数"""
        extra = str(self.settings.get('EXTRA_ARGS', '')).strip()
        if extra:
            import shlex
            lexer = shlex.shlex(extra, posix=True)
            lexer.whitespace_split = True
            lexer.commenters = ""
            if os.name == "nt":
                lexer.escape = ""  # Preserve backslashes in unquoted Windows paths.
            args = list(lexer)
            if "--resume" in self.cmd and any(
                arg.split("=", 1)[0] in {"--lr_scheduler", "--lr_scheduler_type", "--lr_scheduler_args",
                                          "--lr_warmup_steps", "--lr_decay_steps", "--max_train_epochs",
                                          "--max_train_steps", "--initial_step", "--initial_epoch",
                                          "--skip_until_initial_step", "--resume", "--config_file"}
                for arg in args
            ):
                raise ValueError("自动续训仅支持默认恒定学习率和界面设置的步数；请移除覆盖调度器或步数的额外参数")
            self.cmd.extend(args)
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
        self.torch = require_cuda()
        self.vram_config = detect_vram(self.torch)
    
    def prepare_params(self) -> None:
        """准备并调整训练参数（显存自适应）"""
        if not self.vram_config.vram_gb:
            return
        
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
    
    def select_script(self, scripts_dir: Path) -> KohyaConfig:
        name = "sdxl_train_network.py" if self.params.model_family == "SDXL" else "train_network.py"
        script = scripts_dir / name
        if not script.is_file():
            raise RuntimeError(f"找不到 {script}。请检查设置中的 sd-scripts 路径。")
        precision = str(self.settings.get("MIXED_PRECISION", "fp16")).lower()
        if precision in ("bf16", "bfloat16") and check_bf16_support(self.torch):
            return KohyaConfig(script, runtime_precision="bf16")
        if precision in ("bf16", "bfloat16"):
            self.callbacks.log("GPU 不支持 bfloat16，自动降级为 fp16")
        return KohyaConfig(script, runtime_precision="fp16")

    def prepare_dataset(self, images: List[Path], work_dir: Path, captions_dir: Path, stop_event=None):
        """Snapshot exactly the selected images, and fingerprint the pairs for safe resume."""
        image_dir = work_dir / "dataset"
        image_dir.mkdir()
        digest = hashlib.sha256()
        count = 0
        for img in sorted(images):
            if stop_event and stop_event.is_set():
                raise RuntimeError("训练已取消")
            caption_file = img.with_suffix(".txt")
            if not caption_file.is_file():
                caption_file = captions_dir / caption_file.name
            if not caption_file.is_file():
                continue
            text = caption_file.read_text(encoding="utf-8-sig").strip()
            if not is_valid_caption(text):
                continue
            # Canonical names also avoid stem collisions between uploaded formats.
            target = image_dir / f"{count:08d}{img.suffix.lower()}"
            shutil.copyfile(img, target)
            target.with_suffix(".txt").write_text(text, encoding="utf-8")
            with target.open("rb") as f:
                pair_hash = hashlib.sha256()
                for block in iter(lambda: f.read(1024 * 1024), b""):
                    pair_hash.update(block)
            digest.update(pair_hash.digest())
            digest.update(hashlib.sha256(text.encode()).digest())
            count += 1
        if not count:
            raise RuntimeError("没有找到有标签的图片，请先为图片添加标签")
        # CLI supplies bucket, resolution and batch options; TOML must not override them.
        config = work_dir / "dataset.toml"
        config.write_text(
            '[general]\ncaption_extension = ".txt"\n[[datasets]]\n[[datasets.subsets]]\n'
            + f'image_dir = {json.dumps(image_dir.as_posix(), ensure_ascii=False)}\nnum_repeats = 1\n',
            encoding="utf-8",
        )
        self.callbacks.log(f"本次训练使用 {count} 张已标注图片")
        return config, digest.hexdigest()

    def setup_environment(self) -> dict:
        """设置环境变量"""
        env = os.environ.copy()
        
        env['HF_HOME'] = str(resolve_project_path(self.settings.get('HF_HOME') or '.hf'))
        if self.settings.get('TRANSFORMERS_CACHE'):
            env['HF_HUB_CACHE'] = str(resolve_project_path(self.settings['TRANSFORMERS_CACHE']))
        env['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True,max_split_size_mb:64'
        env['CUDA_MODULE_LOADING'] = 'LAZY'
        env['PYTHONUNBUFFERED'] = '1'
        env['HF_HUB_ENABLE_HF_TRANSFER'] = '0'
        
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "HF_ENDPOINT"):
            if self.settings.get(key):
                env[key] = str(self.settings[key])
        # 日志网络配置
        hf_endpoint = env.get('HF_ENDPOINT', 'https://huggingface.co')
        self.callbacks.log(f"HF_ENDPOINT: {hf_endpoint}")
        
        return env
    
    def run(self, images: List[Path], captions_dir: Path, scripts_dir: Path,
            model_name: Optional[str], save_every: int, save_state: bool, auto_resume: bool,
            optimizer_type: Optional[str], unet_lr: Optional[float], text_encoder_lr: Optional[float],
            stop_event: Optional[threading.Event]) -> Path:
        self.prepare_params()
        config = self.select_script(scripts_dir)
        name = format_output_filename(self.params.train_steps, name=model_name or "model")
        output = get_output_lora_path().with_name(name).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="easylora-") as tmp:
            dataset, fingerprint = self.prepare_dataset(images, Path(tmp), captions_dir, stop_event)
            builder = KohyaCommandBuilder(self.params, self.settings)
            # Identity is independent of output date/target steps; another model,
            # dataset or optimizer must never pick up this run's optimizer state.
            identity = (model_name or "model", self.params.model_id, self.params.model_family,
                        self.params.image_size, self.params.lora_rank, self.params.train_batch_size,
                        self.params.gradient_accumulation_steps, self.params.learning_rate,
                        config.runtime_precision, self.vram_config.low_vram_mode, optimizer_type,
                        unet_lr, text_encoder_lr, self.settings.get("EXTRA_ARGS"),
                        self.settings.get("DEFAULT_VAE_PATH"), fingerprint)
            group = hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]
            history = output.parent / ".easylora-runs" / group
            checkpoint = find_resume_state(history, self.params.train_steps) if auto_resume else None
            resume, start_step = checkpoint or (None, 0)
            if auto_resume:
                self.callbacks.log(f"从第 {start_step} 步恢复权重和优化器，还需 {self.params.train_steps-start_step} 步: {resume}"
                                   if resume else "未找到此任务的可恢复状态，从头开始")
            history.mkdir(parents=True, exist_ok=True)
            run_dir = Path(tempfile.mkdtemp(prefix="run-", dir=history))
            try:
                if start_step:
                    (run_dir / "start-step").write_text(str(start_step), encoding="ascii")
                builder.build_base_command(config.script_path, run_dir, "adapter", dataset, start_step)
                builder.add_precision(config.runtime_precision).add_bucket_settings()
                builder.add_optimizer(optimizer_type, unet_lr, text_encoder_lr)
                builder.add_save_settings(save_every, save_state, resume)
                builder.add_vram_optimizations(self.vram_config).add_extra_args()
                self.callbacks.log(f"启动 {self.params.model_family} 训练: {config.script_path.name}")
                if save_every or save_state:
                    self.callbacks.log(f"检查点目录: {run_dir}")
                self.run_process(builder.get_command(), stop_event, start_step)
                final = run_dir / "adapter.safetensors"
                validate_lora(final)
                if stop_event and stop_event.is_set():
                    raise RuntimeError("训练已取消")
                final.replace(output)
                cleanup_old_checkpoints(run_dir, "adapter", int(self.settings.get("MAX_MODELS_BEFORE_CLEAN", 0)))
                return output
            finally:
                if not any(run_dir.glob("*-state")):
                    (run_dir / "start-step").unlink(missing_ok=True)
                if not any(run_dir.iterdir()):
                    run_dir.rmdir()

    def run_process(self, cmd: List[str], stop_event: Optional[threading.Event], start_step: int = 0):
        if stop_event and stop_event.is_set():
            raise RuntimeError("训练已取消")
        start_time = time.monotonic()
        flags = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt"
                 else {"start_new_session": True})
        env = self.setup_environment()
        env["PYTHONIOENCODING"] = "utf-8"
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, encoding="utf-8", errors="replace", env=env, **flags) as proc:
            finished = threading.Event()

            def cancel_if_requested():
                while not finished.wait(0.15):
                    if stop_event.is_set():
                        kill_process_tree(proc)
                        return

            monitor = threading.Thread(target=cancel_if_requested, daemon=True) if stop_event is not None else None
            if monitor:
                monitor.start()
            try:
                for line in proc.stdout:
                    line = line.rstrip()
                    self.callbacks.log(line)
                    step = extract_progress(line, self.params.train_steps - start_step)
                    if step is not None:
                        step += start_step
                        total = self.params.train_steps
                        eta = extract_eta(line) or format_eta((total - step) * (time.monotonic() - start_time) / max(step - start_step, 1))
                        self.callbacks.update_progress(step / total, eta, step, total)
                proc.wait()
            finally:
                if proc.poll() is None:
                    kill_process_tree(proc)
                finished.set()
                if monitor:
                    monitor.join()
            if stop_event and stop_event.is_set():
                raise RuntimeError("训练已取消")
            if proc.returncode:
                raise RuntimeError(f"训练失败，退出码 {proc.returncode}；请查看上方 sd-scripts 日志")


def find_resume_state(history: Path, target_steps: int) -> Optional[tuple[Path, int]]:
    """Take the newest complete state for this dataset/configuration, never a prefix match."""
    candidates = []
    saw_state = False
    for state in history.glob("run-*/adapter*-state"):
        if state.name != "adapter-state" and not re.fullmatch(r"adapter-step[0-9]+-state", state.name):
            continue
        saw_state = True
        # Accelerate writes random_states_0.pkl after the model/optimizer/scheduler;
        # train_state.json alone is written by a pre-save hook and may be incomplete.
        files = ("train_state.json", "model.safetensors", "optimizer.bin", "scheduler.bin", "random_states_0.pkl")
        if not all((state / f).is_file() and (state / f).stat().st_size > 0 for f in files):
            continue
        try:
            step = int(json.loads((state / "train_state.json").read_text(encoding="utf-8"))["current_step"])
        except (KeyError, ValueError, TypeError):
            continue
        offset = state.parent / "start-step"
        if offset.is_file():
            step += int(offset.read_text(encoding="ascii"))
        if step > 0:
            candidates.append((state.stat().st_mtime_ns, step, str(state), state))
    if not candidates:
        if saw_state:
            raise RuntimeError("找到检查点目录，但没有完整可恢复的训练状态；请检查日志或关闭自动续训后重新开始")
        return None
    _, step, _, path = max(candidates)
    if step >= target_steps:
        raise RuntimeError(f"检查点已完成 {step} 步；续训目标须更大，或关闭自动续训重新训练")
    return path, step


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
    model_name: Optional[str] = None,
    base_model: Optional[str] = None,
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
    
    actual_count = len(image_paths)
    if base_model is not None and base_model not in {"SD1.5", "SD2.1", "SDXL"}:
        raise ValueError(f"未知模型类型: {base_model}")
    if base_model == "SDXL" or (base_model is None and avg_long_side >= int(settings["RES_THRESHOLD_SDXL"])):
        params = auto_params_sdxl(actual_count)
    else:
        image_size = {"SD1.5": 512, "SD2.1": 768}.get(base_model, auto_select_image_size(avg_long_side))
        params = auto_params_by_dataset(actual_count, image_size)
    if override_steps and override_steps > 0:
        params.train_steps = override_steps
    if override_lr and override_lr > 0:
        params.learning_rate = override_lr
    callbacks.log(f"{params.model_family} | {params.model_id} | {params.image_size}px | {params.train_steps} 步 | rank {params.lora_rank}")
    scripts = settings.get("DEFAULT_KOHYA_SCRIPTS_DIR")
    if not scripts or not resolve_project_path(scripts).is_dir():
        raise RuntimeError("未找到 kohya-ss/sd-scripts。请按 README 安装并在设置中指定脚本目录。")
    save_every = override_save_every if override_save_every is not None else int(settings.get("DEFAULT_SAVE_EVERY", 0))
    auto_resume = override_auto_resume if override_auto_resume is not None else settings.get("DEFAULT_AUTO_RESUME", False)
    save_state = override_save_state if override_save_state is not None else (save_every > 0 or auto_resume)
    trainer = KohyaTrainer(params, callbacks)
    output = trainer.run(image_paths, captions_dir, resolve_project_path(scripts), model_name,
                         save_every, save_state, auto_resume, optimizer_type, unet_lr, text_encoder_lr, stop_event)
    if settings.get("COPY_TO_SD_WEBUI_ON_FINISH", True) and sd_webui_lora_dir:
        dst = sd_webui_lora_dir / output.name
        if dst.resolve() != output.resolve():
            try:
                sd_webui_lora_dir.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=sd_webui_lora_dir, delete=False) as tmp:
                    staged_copy = Path(tmp.name)
                try:
                    shutil.copyfile(output, staged_copy)
                    staged_copy.replace(dst)
                finally:
                    staged_copy.unlink(missing_ok=True)
                callbacks.log(f"已复制到 WebUI LoRA 目录: {dst}")
            except OSError as exc:
                callbacks.log(f"LoRA 已保存到 {output}，但复制到 WebUI 失败: {exc}")
    callbacks.update_progress(1.0, "00:00")
    return output
