# EasyLora

一个开箱即用的 LoRA 训练与标注小工具：后端基于 FastAPI，前端基于 React + Vite。支持图片上传、数据预处理、标签编辑与一键启动训练，并在训练完成后可将 LoRA 自动复制到本地 SD WebUI 的 `models/Lora` 目录。

### 目录结构
- `EasyLora/`: 训练与配置核心代码
- `server.py`: 轻量后端（HTTP + WebSocket）
- `web/`: 前端工程（Vite + React + Tailwind）
- `workspace/`: 数据工作区（原始上传、处理后数据与标签）
- `outputs/`: 训练输出（LoRA、state、checkpoint 等）
- `user_settings.json`: 用户设置（可在前端设置页保存）

### 环境要求
- Python 3.10+（建议使用虚拟环境）
- Node.js 18+
- Windows 下建议已安装可用的 CUDA 与匹配版本的 PyTorch（否则将回退到 CPU 训练）

### 后端快速开始（Windows / cmd）
```bat
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python server.py
```
后端默认监听 `http://127.0.0.1:8000`。

### 前端启动
```bat
cd web
npm ci
npm run dev
```
前端默认在 `http://127.0.0.1:5173`，已通过开发代理转发 `/api` 与 `/ws` 到后端（见 `web/vite.config.ts`）。

### 使用流程
1) 打开前端页面，进入「设置」页，按需填写：
   - `DEFAULT_SD_WEBUI_LORA_DIR`: 训练完成后 LoRA 复制目标目录
   - 模型路径：如需要自定义 SDXL 或 SD1.5/SD2.1 基座
   - 其他缓存/代理相关参数
2) 上传图片至工作区（也可直接将图片放入 `workspace/raw_uploads/`）
3) 在「标注」页编辑或调整标签（对应文件位于 `workspace/processed/dataset/*.txt`）
4) 点击开始训练，前端通过 WebSocket 接收实时日志与进度
5) 训练产物默认存放于 `outputs/`；若启用复制，会额外复制到 `DEFAULT_SD_WEBUI_LORA_DIR`

### 关键路径与配置
- 配置合并逻辑见 `EasyLora/config.py`，默认值与注释已给出
- 用户覆盖写入 `user_settings.json`（也可直接编辑此文件）
- 常用键：
  - `DEFAULT_OUTPUT_DIR`, `DEFAULT_WORKSPACE_DIR`
  - `DEFAULT_SD_WEBUI_LORA_DIR`, `COPY_TO_SD_WEBUI_ON_FINISH`
  - `DEFAULT_MODEL_512`/`768`/`SDXL`
  - `LR_SLIDER_MIN`/`LR_SLIDER_MAX`、`DEFAULT_STEPS_*`、`DEFAULT_RANK_*`

### 典型命令
- 停止当前训练（HTTP）：`POST /api/stop`
- 获取/保存设置：`GET/POST /api/settings`
- 列出处理后图片：`GET /api/processed-images`

### 端到端测试（可选）
```bat
cd web
npx playwright install
npm run test:e2e
```

### 常见问题
- Q: 首次启动很慢？
  - A: 需要下载或首次加载权重，且数据会预处理到 `workspace/processed/`。

### Git LFS（可选）
若你希望跟踪权重文件，可安装并启用 Git LFS：
```bat
git lfs install
git lfs track "*.safetensors" "*.bin" "*.pt" "*.npz" "*.ckpt"
git add .gitattributes
```

### 许可证
本项目采用 PolyForm Noncommercial License 1.0.0：

- 非商业用途：免费使用、修改与再发布
- 商业用途：需取得作者书面授权

完整条款参见 `LICENSE` 文件。

