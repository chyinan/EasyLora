# RTX 5070 Ti（16 GB）最小 LoRA 验证（Windows 11）

此流程的目标是确认 **CUDA 可用 → 实际训练 → 生成有效 LoRA → 同底模加载推理**，不是评估模型质量。建议先测 SD 1.5，再测 SDXL。下面的软件版本是可复现的安装基线，不代表已在本机跑通 GPU。

## 1. 安装并核实 GPU

安装支持 RTX 50 系列的 NVIDIA 驱动、Python 3.11 x64、Git 和 Node.js 22 LTS。以下是从 EasyLora 根目录执行的 PowerShell 命令，不需要更改执行策略。

```powershell
py -3.11 -m venv .venv
$py = (Resolve-Path .\.venv\Scripts\python.exe).Path
& $py -m pip install --upgrade pip
& $py -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
git clone https://github.com/kohya-ss/sd-scripts.git sd-scripts
git -C sd-scripts checkout 88ff6b5391e89822d0463df8769591273d0d28b1
Push-Location sd-scripts
& $py -m pip install -r requirements.txt
Pop-Location
& $py -m pip install -r requirements.txt
& $py -m pip check
nvidia-smi
& $py -c "import torch; assert torch.cuda.is_available(), 'CUDA not available'; print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name(0), torch.cuda.get_device_capability(), torch.cuda.get_arch_list()); x=torch.ones((128,128),device='cuda',dtype=torch.float16); print((x@x)[0,0].item()); torch.cuda.synchronize()"
```

应显示 RTX 5070 Ti、CUDA `12.8`、计算能力 `(12, 0)`，最后输出 `128.0`。若失败，先解决驱动或装错 CPU/CUDA wheel 的问题，不要开始训练。安装依据：[PyTorch 官方 wheel 索引说明](https://pytorch.org/get-started/previous-versions/)、[固定版本的 sd-scripts 安装说明](https://github.com/kohya-ss/sd-scripts/blob/88ff6b5391e89822d0463df8769591273d0d28b1/README.md)。

安装前端依赖后，双击 `start_app.bat` 或分两个终端运行 README 的手动命令。浏览器打开 `http://localhost:5173`。本项目是本机工具，不要直接暴露到公网或共享网络。只启动一个后端进程；网页刷新可看回本次运行，但重启后端不能恢复进程或实时状态，旧产物和可用的训练状态仍在磁盘。

```powershell
Push-Location web
npm ci
Pop-Location
.\start_app.bat
```

## 2. 跑第一次训练

1. 在 **设置 → 路径与导出** 填入本地 `sd-scripts` 的绝对路径。把 **512 底模** 指向一份你能在推理软件中打开的 SD 1.5 `.safetensors` 底模（不是 LoRA），可选的 VAE、WebUI 自动复制路径留空。用 SDXL 时填入 **SDXL 底模**，并在主界面选 SDXL；两者不能混用。
2. 准备 8–12 张你拥有使用权的 JPEG/PNG，第一轮用 512×512 或相近尺寸。导入并给每张图写非空描述，例如 `elora_test, a ceramic mug on a wooden table`。用新工作区或先移除旧训练图，避免混用数据。
3. 设置精度 `fp16`、批量 `1`、打开 SDPA、关闭 xFormers。显存不足先关闭占显存的推理软件，再启用梯度检查点；第一次不要装 8bit 优化器或尝试高级参数。
4. 主界面选 **SD1.5 / 10 步 / AdamW**，模型名可填 `easy_smoke`，保存间隔 `0`，不勾选自动续训。点击开始，等日志真的显示步数推进并且任务完成。首次可能下载文本编码器配置；不能联网时先准备对应的模型缓存。
5. 用任务完成区的下载入口或日志中的本地产物路径取得 `.safetensors`。确认文件确为本次任务写出。遇到 CUDA 错误、Kohya 非零退出、找不到产物或取消，都不算训练完成。

### 单独检查取消和断点续训

首轮通过后再做：用同名任务、相同底模和训练设置，把总步数设为 30、保存间隔设为 5，开启自动续训（会写训练状态）。至少等第 5 步的中间状态保存完成，再取消；确认网页进入取消态，Kohya 不再占用 GPU。预处理阶段取消时，当前数据准备结束后会停止，不再启动 Kohya。然后保持模型名、底模、数据及训练目标不变，再启动并在日志确认加载同一次任务范围内保存的 state。仅有 `.safetensors` 权重文件并不是可续训的优化器状态。默认恒定学习率可续训：恢复权重、优化器和 RNG，继续剩余优化步；不保证精确重放到数据加载器里原来的批次。此验证不要设置自定义学习率调度或覆盖训练步数的额外参数。

## 3. 确认 LoRA 能加载推理

优先复用已经能运行的 ComfyUI 或 Stable Diffusion WebUI。以 ComfyUI 为例：

1. 把本次 `.safetensors` 放到 `ComfyUI/models/loras/`，刷新模型列表。在 Checkpoint Loader 中选择**训练时同一份**底模，连接 `Load LoRA` 的 MODEL 和 CLIP 输入输出。
2. 文本提示使用训练时用过的触发词；固定种子，生成两张图。先把 MODEL 和 CLIP 强度都设为 0，再设为 0.8，其他参数不变。
3. **通过条件：** 开启 LoRA 后加载不报错且输出图片。两种权重出图有差异是有用的复核；仅训练 10 步，不应该用画面好不好判断训练链路成功。确认后再提高步数，单独做 SDXL 验证。

如只有 FastAPI/UI/模拟训练进程的测试日志，没有 GPU 训练日志和以上推理记录，就不要把它写成真实端到端训练完成。
