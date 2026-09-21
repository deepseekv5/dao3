# run-win.ps1 — Windows PowerShell 启动（与 启动-Windows.bat 同一逻辑，给命令行用户）
# 用法： powershell -ExecutionPolicy Bypass -File run-win.ps1
#       或在 PowerShell 里直接 .\run-win.ps1 --port=5173
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host ""
  Write-Host "  X 没有检测到 Node.js" -ForegroundColor Red
  Write-Host "    本项目只需要 Node 18+，装完不需要 npm install。"
  Write-Host "    下载: https://nodejs.org/zh-cn/download"
  Write-Host ""
  exit 1
}

# 只用 PowerShell 5.1 也支持的语法（Windows 自带的那一版没有 ?? / 三元）
$raw = (node --version) 2>$null
if (-not $raw) {
  Write-Host "  X node 命令无法执行，请确认安装后重开本窗口。" -ForegroundColor Red
  exit 1
}
$major = [int](($raw -replace '^v', '').Split('.')[0])
if ($major -lt 18) {
  Write-Host "  X 需要 Node 18+，当前为 $raw" -ForegroundColor Red
  exit 1
}

Write-Host "  DAO3 编辑器复刻 - 启动本地服务（Ctrl+C 停止）" -ForegroundColor DarkGray
node start.mjs @args
exit $LASTEXITCODE
