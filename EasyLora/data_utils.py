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
from typing import Iterable, List, Tuple

from PIL import Image, ImageEnhance

from .config import (
    DEFAULT_CAPTIONS_DIR,
    DEFAULT_PROCESSED_DIR,
)


SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def list_images(input_dir: Path) -> List[Path]:
    images: List[Path] = []
    for p in input_dir.iterdir():
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
            images.append(p)
    images.sort()
    return images


def compute_avg_long_side(images: List[Path]) -> int:
    if not images:
        return 512
    total = 0
    for img_path in images:
        try:
            with Image.open(img_path) as im:
                w, h = im.size
        except Exception:
            continue
        total += max(w, h)
    count = max(1, len(images))
    return int(total / count)


def pad_to_square(im: Image.Image, fill_color=(0, 0, 0)) -> Image.Image:
    w, h = im.size
    if w == h:
        return im
    dim = max(w, h)
    new_im = Image.new("RGB", (dim, dim), fill_color)
    offset = ((dim - w) // 2, (dim - h) // 2)
    new_im.paste(im, offset)
    return new_im


def apply_offline_augmentations(im: Image.Image) -> Image.Image:
    """对图像进行轻量增强。

    - 50% 概率水平翻转
    - 亮度在 [0.9, 1.1]
    - 对比度在 [0.9, 1.1]
    - 旋转在 [-10, 10] 度，并使用黑边填充
    """
    img = im
    if random.random() < 0.5:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)

    # 亮度
    brightness_factor = random.uniform(0.9, 1.1)
    img = ImageEnhance.Brightness(img).enhance(brightness_factor)

    # 对比度
    contrast_factor = random.uniform(0.9, 1.1)
    img = ImageEnhance.Contrast(img).enhance(contrast_factor)

    # 轻微旋转
    angle = random.uniform(-10, 10)
    img = img.rotate(angle, expand=True, fillcolor=(0, 0, 0))

    # 旋转后再方形填充
    img = pad_to_square(img)
    return img


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

    saved: List[Path] = []
    for idx, img_path in enumerate(image_paths):
        try:
            with Image.open(img_path) as im:
                im = im.convert("RGB")
        except Exception:
            continue

        base = pad_to_square(im)
        base = base.resize((target_size, target_size), Image.BICUBIC)

        # 原图版本
        out_name = f"img_{idx:04d}.png"
        out_path = dataset_folder / out_name
        base.save(out_path)
        saved.append(out_path)
        _write_caption(out_path, captions_dir, captions_keyword)

        # 增强版本
        for k in range(max(0, augment_factor - 1)):
            aug = apply_offline_augmentations(base)
            out_name_aug = f"img_{idx:04d}_aug{k+1}.png"
            out_path_aug = dataset_folder / out_name_aug
            aug.save(out_path_aug)
            saved.append(out_path_aug)
            _write_caption(out_path_aug, captions_dir, captions_keyword)

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

    caption_path = captions_dir / f"{image_path.stem}.txt"
    caption_path.write_text(text, encoding="utf-8")

