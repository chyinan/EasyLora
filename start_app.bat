@echo off
chcp 65001 >nul
echo ========================================
echo           EasyLora 启动脚本
echo ========================================
echo.

:: 激活虚拟环境
echo [1/3] 激活Python虚拟环境...
call .venv\Scripts\activate.bat
if errorlevel 1 (
    echo 错误：无法激活虚拟环境！
    pause
    exit /b 1
)
echo ✓ 虚拟环境已激活

:: 启动后端服务器
echo.
echo [2/3] 启动后端服务器...
echo 后端将在 http://localhost:8000 启动
start "EasyLora Backend" cmd /k "call .venv\Scripts\activate.bat && python server.py"
if errorlevel 1 (
    echo 错误：无法启动后端服务器！
    pause
    exit /b 1
)
echo ✓ 后端服务器已启动

:: 等待后端启动
echo.
echo 等待后端服务器启动...
timeout /t 3 /nobreak >nul

:: 启动前端开发服务器
echo.
echo [3/3] 启动前端开发服务器...
cd web
echo 前端将在 http://localhost:5173 启动
start "EasyLora Frontend" cmd /k "npm run dev"
if errorlevel 1 (
    echo 错误：无法启动前端开发服务器！
    pause
    exit /b 1
)
echo ✓ 前端开发服务器已启动

:: 返回根目录
cd ..

echo.
echo ========================================
echo           启动完成！
echo ========================================
echo 后端地址: http://localhost:8000
echo 前端地址: http://localhost:5173
echo.
echo 按任意键退出...
pause >nul 