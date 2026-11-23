@echo off
setlocal
chcp 65001 >nul

echo 如有训练在运行，请先回到网页点停止，等待训练退出。
choice /C YN /N /M "关闭 EasyLora 启动窗口？[Y/N] "
if errorlevel 2 exit /b 0

rem 只处理 EasyLora 启动器创建的 cmd 窗口，不结束系统中其他 Python 或 Node 任务。
taskkill /F /T /IM cmd.exe /FI "WINDOWTITLE eq EasyLora Backend*" 2>nul
taskkill /F /T /IM cmd.exe /FI "WINDOWTITLE eq EasyLora Frontend*" 2>nul
echo 如启动窗口仍在运行，请分别在其中按 Ctrl+C 后关闭。
