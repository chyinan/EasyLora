"""
main.py

PyQt5 GUI 入口：
- 选择图片文件夹
- 可选配置 WebUI LoRA 目录
- 一键开始：数据处理 -> 自动参数 -> 训练 -> 复制输出
- 实时日志显示与进度条 + 预计剩余时间

注意：这是 MVP 版本，训练环节为简化示例，主要打通端到端流程。
"""

from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Optional

from PyQt5 import QtCore, QtGui, QtWidgets

from .config import (
    ensure_dirs,
    resolve_sd_webui_lora_dir,
)
from .data_utils import list_images, compute_avg_long_side, process_and_save
from .train import train_lora, TrainCallbacks


class WorkerSignals(QtCore.QObject):
    log = QtCore.pyqtSignal(str)
    progress = QtCore.pyqtSignal(float, str)
    finished = QtCore.pyqtSignal(str)
    failed = QtCore.pyqtSignal(str)


class TrainWorker(QtCore.QRunnable):
    def __init__(self, input_dir: Path, sd_lora_dir: Optional[Path], signals: WorkerSignals):
        super().__init__()
        self.input_dir = input_dir
        self.sd_lora_dir = sd_lora_dir
        self.signals = signals

    @QtCore.pyqtSlot()
    def run(self):
        try:
            self.signals.log.emit("开始数据预处理...")
            images = list_images(self.input_dir)
            if not images:
                raise RuntimeError("未在该目录找到图片文件。支持：jpg/jpeg/png/webp/bmp")

            avg_long = compute_avg_long_side(images)
            processed_dir, captions_dir, saved_images = process_and_save(
                images, target_size=512 if avg_long < 700 else 768, augment_factor=1
            )

            self.signals.log.emit(f"已处理图片 {len(saved_images)} 张。开始训练...")

            def cb_log(msg: str):
                self.signals.log.emit(msg)

            def cb_progress(p: float, eta: Optional[str]):
                self.signals.progress.emit(float(p), eta or "--:--")

            output = train_lora(
                processed_dir=processed_dir,
                captions_dir=captions_dir,
                image_paths=saved_images,
                avg_long_side=avg_long,
                sd_webui_lora_dir=self.sd_lora_dir,
                callbacks=TrainCallbacks(log=cb_log, update_progress=cb_progress),
            )

            self.signals.finished.emit(str(output))
        except Exception as e:
            self.signals.failed.emit(str(e))


class MainWindow(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("EasyLora - LoRA 训练 MVP")
        self.resize(820, 640)

        ensure_dirs()

        self.input_dir_edit = QtWidgets.QLineEdit()
        self.browse_btn = QtWidgets.QPushButton("选择图片文件夹")
        self.sd_lora_dir_edit = QtWidgets.QLineEdit()
        self.sd_lora_dir_edit.setPlaceholderText("Stable Diffusion WebUI LoRA 目录，可留空")
        self.sd_browse_btn = QtWidgets.QPushButton("选择 LoRA 目录")
        self.start_btn = QtWidgets.QPushButton("开始训练")
        self.start_btn.setEnabled(True)

        self.progress_bar = QtWidgets.QProgressBar()
        self.eta_label = QtWidgets.QLabel("预计剩余: --:--")
        self.log_edit = QtWidgets.QTextEdit()
        self.log_edit.setReadOnly(True)

        form = QtWidgets.QFormLayout()
        h1 = QtWidgets.QHBoxLayout()
        h1.addWidget(self.input_dir_edit)
        h1.addWidget(self.browse_btn)
        form.addRow("图片文件夹:", h1)

        h2 = QtWidgets.QHBoxLayout()
        h2.addWidget(self.sd_lora_dir_edit)
        h2.addWidget(self.sd_browse_btn)
        form.addRow("WebUI LoRA 目录:", h2)
        form.addRow("进度:", self.progress_bar)
        form.addRow("", self.eta_label)
        form.addRow("日志:", self.log_edit)

        v = QtWidgets.QVBoxLayout(self)
        v.addLayout(form)
        v.addWidget(self.start_btn)

        self.thread_pool = QtCore.QThreadPool.globalInstance()
        self._connect()

    def _connect(self):
        self.browse_btn.clicked.connect(self.on_browse)
        self.sd_browse_btn.clicked.connect(self.on_browse_sd)
        self.start_btn.clicked.connect(self.on_start)

    def on_browse(self):
        d = QtWidgets.QFileDialog.getExistingDirectory(self, "选择图片文件夹")
        if d:
            self.input_dir_edit.setText(d)

    def on_browse_sd(self):
        d = QtWidgets.QFileDialog.getExistingDirectory(self, "选择 SD WebUI LoRA 目录")
        if d:
            self.sd_lora_dir_edit.setText(d)

    def on_start(self):
        input_dir = self.input_dir_edit.text().strip()
        if not input_dir:
            QtWidgets.QMessageBox.warning(self, "提示", "请先选择图片文件夹")
            return
        if not Path(input_dir).exists():
            QtWidgets.QMessageBox.warning(self, "提示", "图片文件夹不存在")
            return

        sd_dir_text = self.sd_lora_dir_edit.text().strip()
        # 始终解析，若为空则使用默认路径
        sd_dir = resolve_sd_webui_lora_dir(sd_dir_text or None)

        self.start_btn.setEnabled(False)
        self.progress_bar.setValue(0)
        self.eta_label.setText("预计剩余: --:--")
        self.log_edit.clear()

        signals = WorkerSignals()
        signals.log.connect(self.append_log)
        signals.progress.connect(self.on_progress)
        signals.finished.connect(self.on_finished)
        signals.failed.connect(self.on_failed)

        worker = TrainWorker(Path(input_dir), sd_dir, signals)
        self.thread_pool.start(worker)

    @QtCore.pyqtSlot(str)
    def append_log(self, text: str):
        self.log_edit.append(text)

    @QtCore.pyqtSlot(float, str)
    def on_progress(self, p: float, eta: str):
        self.progress_bar.setValue(int(p * 100))
        self.eta_label.setText(f"预计剩余: {eta}")

    @QtCore.pyqtSlot(str)
    def on_finished(self, out_path: str):
        self.append_log(f"完成！输出文件：{out_path}")
        self.start_btn.setEnabled(True)
        QtWidgets.QMessageBox.information(self, "完成", f"LoRA 已生成：\n{out_path}")

    @QtCore.pyqtSlot(str)
    def on_failed(self, err: str):
        self.append_log(f"错误：{err}")
        self.start_btn.setEnabled(True)
        QtWidgets.QMessageBox.critical(self, "错误", err)


def main():
    app = QtWidgets.QApplication(sys.argv)
    w = MainWindow()
    w.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()

