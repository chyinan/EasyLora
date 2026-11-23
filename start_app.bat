@echo off
setlocal
chcp 65001 >nul

if not exist "%~dp0.venv\Scripts\python.exe" (
    echo 未找到 .venv，请先按 README 安装 Python 依赖。
    pause
    exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo 未找到 npm，请先安装 Node.js。
    pause
    exit /b 1
)
if not exist "%~dp0web\node_modules\.bin\vite.cmd" (
    echo 未安装前端依赖，请进入 web 目录执行 npm ci。
    pause
    exit /b 1
)

start "EasyLora Backend" /D "%~dp0." cmd /D /K .venv\Scripts\python.exe server.py
if errorlevel 1 exit /b 1
start "EasyLora Frontend" /D "%~dp0web" cmd /D /K npm run dev -- --strictPort
if errorlevel 1 exit /b 1

echo 请打开 http://localhost:5173 ，如未能访问请查看新窗口中的报错。
