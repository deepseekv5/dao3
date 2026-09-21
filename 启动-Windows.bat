@echo off
chcp 65001 >nul
rem 启动-Windows.bat — 双击启动 DAO3 编辑器复刻（Windows）
rem 真正的逻辑都在 start.mjs 里，这里只负责"有没有 Node"和"窗口别一闪而过"。
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   X 没有检测到 Node.js
  echo.
  echo     本项目只需要 Node 18 或更高版本，装完不用 npm install。
  echo     下载地址: https://nodejs.org/zh-cn/download
  echo     装好后重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

node --version >nul 2>nul
if errorlevel 1 (
  echo   X node 命令无法执行，请确认安装完成后重开本窗口。
  pause
  exit /b 1
)

echo.
echo   DAO3 编辑器复刻 - 正在启动本地服务...
echo   停止请按 Ctrl+C，或直接关闭本窗口。
echo.
node start.mjs %*
echo.
echo   服务已停止。
pause
endlocal
