@echo off
chcp 65001 >nul
echo ========================================
echo           EasyLora 停止脚本
echo ========================================
echo.

echo 正在停止所有相关进程...

:: 停止Python进程（后端）
taskkill /f /im python.exe /t 2>nul
if errorlevel 1 (
    echo 没有找到运行中的Python进程
) else (
    echo ✓ 已停止Python后端进程
)

:: 停止Node.js进程（前端）
taskkill /f /im node.exe /t 2>nul
if errorlevel 1 (
    echo 没有找到运行中的Node.js进程
) else (
    echo ✓ 已停止Node.js前端进程
)

:: 关闭相关的命令行窗口
taskkill /f /fi "WINDOWTITLE eq EasyLora Backend*" 2>nul
taskkill /f /fi "WINDOWTITLE eq EasyLora Frontend*" 2>nul

echo.
echo ========================================
echo           停止完成！
echo ========================================
echo 所有EasyLora相关进程已停止
echo.
echo 按任意键退出...
pause >nul 