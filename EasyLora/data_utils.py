"""
data_utils.py

数据集处理工具：
- 加载用户选择的图片
- 自动裁剪/填充到方形
- 调整尺寸到 512 或 768
- 基础增强：随机翻转、亮度/对比度变化、轻微旋转（离线增强，保存增强后的图像）
- 生成 caption 文本文件（基于文件名或通用关键词）

说明：
- 为简化依赖，使用 Pillow 实现离线增强并落盘
- 处理后的图像与对应 caption 保存在 `workspace/processed` 与 `workspace/captions`
"""

from __future__ import annotations

import math
import random
from pathlib import Path
from typing import Iterable, List, Tuple, Dict, Any

from PIL import Image, ImageEnhance

from .config import (
    DEFAULT_CAPTIONS_DIR,
    DEFAULT_PROCESSED_DIR,
    get_settings,
)


SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def list_images(input_dir: Path) -> List[Path]:
    images: List[Path] = []
    if not input_dir.exists():
        return images
    for p in input_dir.iterdir():
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
            images.append(p)
    images.sort()
    return images


def compute_avg_long_side(images: List[Path]) -> int:
    if not images:
        return 512
    total = 0
    count = 0
    for img_path in images:
        try:
            with Image.open(img_path) as im:
                w, h = im.size
                total += max(w, h)
                count += 1
        except Exception:
            continue
    return int(total / max(1, count))


def pad_to_square(im: Image.Image, fill_color=(0, 0, 0)) -> Image.Image:
    w, h = im.size
    if w == h:
        return im
    dim = max(w, h)
    new_im = Image.new("RGB", (dim, dim), fill_color)
    offset = ((dim - w) // 2, (dim - h) // 2)
    new_im.paste(im, offset)
    return new_im


def apply_offline_augmentations(im: Image.Image, settings: Dict[str, Any] = None) -> Image.Image:
    """对图像进行轻量增强。
    
    默认参数：
    - 50% 概率水平翻转
    - 亮度在 [0.9, 1.1]
    - 对比度在 [0.9, 1.1]
    - 旋转在 [-10, 10] 度，并使用黑边填充
    """
    if settings is None:
        settings = {}
        
    img = im
    
    # 水平翻转
    if random.random() < settings.get("aug_flip_prob", 0.5):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)

    # 亮度
    brightness_range = settings.get("aug_brightness_range", 0.1)
    brightness_factor = random.uniform(1.0 - brightness_range, 1.0 + brightness_range)
    img = ImageEnhance.Brightness(img).enhance(brightness_factor)

    # 对比度
    contrast_range = settings.get("aug_contrast_range", 0.1)
    contrast_factor = random.uniform(1.0 - contrast_range, 1.0 + contrast_range)
    img = ImageEnhance.Contrast(img).enhance(contrast_factor)

    # 轻微旋转
    rotate_range = settings.get("aug_rotate_range", 10)
    if rotate_range > 0:
        angle = random.uniform(-rotate_range, rotate_range)
        img = img.rotate(angle, expand=True, fillcolor=(0, 0, 0))

    # 旋转后再方形填充
    img = pad_to_square(img)
    return img


def get_next_image_index(dataset_folder: Path) -> int:
    """获取下一个图片序号，基于现有图片文件"""
    if not dataset_folder.exists():
        return 0
        
    existing_images = []
    for img_file in dataset_folder.glob("img_*.png"):
        try:
            # 提取序号，例如 img_0031.png -> 31
            name = img_file.stem
            if name.startswith("img_"):
                # 处理可能存在的后缀，如 img_0031_aug1
                parts = name.split('_')
                if len(parts) >= 2 and parts[1].isdigit():
                    existing_images.append(int(parts[1]))
        except:
            continue
    
    # 返回下一个序号，如果没有现有图片则从0开始
    return max(existing_images) + 1 if existing_images else 0


def is_valid_caption(caption: str) -> bool:
    """检查标签内容是否有效"""
    if not caption or not caption.strip():
        return False
    
    caption_trimmed = caption.strip()
    # 检查是否是默认的序号标签（只包含文件名，没有逗号分隔的标签）
    # 例如: "img_0001" 是无效的，但 "img_0001, 1girl, solo" 是有效的
    # 或者 "mysstyle, 1girl" 也是有效的
    
    # 规则1: 如果包含逗号且总长度超过20，通常是有效标签
    if "," in caption_trimmed and len(caption_trimmed) > 20:
        return True
        
    # 规则2: 如果不以 "img_" 开头且长度超过10，通常是有效标签
    if not caption_trimmed.startswith("img_") and len(caption_trimmed) > 10:
        return True
        
    return False


def filter_images_with_captions(dataset_dir: Path) -> List[Dict[str, Any]]:
    """筛选出有真正标签内容的图片
    
    返回列表结构:
    [
        {
            "filename": "img_0001.png",
            "path": Path object,
            "caption": "content..."
        },
        ...
    ]
    """
    results = []
    
    if not dataset_dir.exists():
        return results
        
    # 支持的图片格式
    for img_file in sorted(dataset_dir.iterdir()):
        if img_file.is_file() and img_file.suffix.lower() in SUPPORTED_EXTS:
            # 检查是否有对应的标签文件
            caption_file = img_file.with_suffix(".txt")
            if caption_file.exists():
                try:
                    # 检查标签文件是否有内容
                    caption_content = caption_file.read_text(encoding="utf-8").strip()
                    if is_valid_caption(caption_content):
                        results.append({
                            "filename": img_file.name,
                            "path": img_file,
                            "caption": caption_content
                        })
                except Exception:
                    # 如果读取失败，跳过这个文件
                    continue
    
    return results


def process_and_save(
    image_paths: List[Path],
    target_size: int,
    augment_factor: int = 1,
    captions_keyword: str | None = None,
) -> Tuple[Path, Path, List[Path]]:
    """处理图像并保存到工作区目录，返回 (processed_dir, captions_dir, saved_images)。

    augment_factor: 每张图的增强数量（包含原图变换版），MVP 默认 1。
    captions_keyword: 如果提供，统一作为 caption；否则使用文件名生成。
    """

    processed_dir = DEFAULT_PROCESSED_DIR
    captions_dir = DEFAULT_CAPTIONS_DIR
    processed_dir.mkdir(parents=True, exist_ok=True)
    captions_dir.mkdir(parents=True, exist_ok=True)

    # 创建 sd-scripts 期望的目录结构：processed_dir 下创建子文件夹
    dataset_folder = processed_dir / "dataset"
    dataset_folder.mkdir(exist_ok=True)

    # 获取下一个图片序号
    next_index = get_next_image_index(dataset_folder)
    
    # 获取全局设置用于增强参数
    settings = get_settings()
    aug_settings = {
        "aug_flip_prob": float(settings.get("AUG_FLIP_PROB", 0.5)),
        "aug_brightness_range": float(settings.get("AUG_BRIGHTNESS_RANGE", 0.1)),
        "aug_contrast_range": float(settings.get("AUG_CONTRAST_RANGE", 0.1)),
        "aug_rotate_range": float(settings.get("AUG_ROTATE_RANGE", 10)),
    }

    saved: List[Path] = []
    for i, img_path in enumerate(image_paths):
        try:
            with Image.open(img_path) as im:
                # 统一转换为 RGB，处理 RGBA/P 等格式
                if im.mode != "RGB":
                    im = im.convert("RGB")
                
                # 方形填充并调整大小
                base = pad_to_square(im)
                base = base.resize((target_size, target_size), Image.BICUBIC)
        except Exception:
            continue

        # 原图版本 - 使用连续的序号
        current_index = next_index + i
        out_name = f"img_{current_index:04d}.png"
        out_path = dataset_folder / out_name
        base.save(out_path)
        saved.append(out_path)
        _write_caption(out_path, dataset_folder, captions_keyword)

        # 增强版本
        for k in range(max(0, augment_factor - 1)):
            aug = apply_offline_augmentations(base, aug_settings)
            out_name_aug = f"img_{current_index:04d}_aug{k+1}.png"
            out_path_aug = dataset_folder / out_name_aug
            aug.save(out_path_aug)
            saved.append(out_path_aug)
            _write_caption(out_path_aug, dataset_folder, captions_keyword)

    return processed_dir, captions_dir, saved


def _write_caption(image_path: Path, captions_dir: Path, keyword: str | None) -> None:
    if keyword and keyword.strip():
        text = keyword.strip()
    else:
        # 使用文件名（去掉扩展与后缀 aug）作为 tag，空格替换为逗号，简单规范化
        stem = image_path.stem
        stem = stem.replace("_aug", "").replace("-", " ")
        words = [w for w in stem.split() if w]
        text = ", ".join(words) if words else "person, style"

    # 使用图片文件名（img_****格式）来创建标签文件
    caption_path = image_path.with_suffix('.txt')
    caption_path.write_text(text, encoding="utf-8")
