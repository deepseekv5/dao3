#!/usr/bin/env bash
# run.sh — 启动本地服务（macOS / Linux）。Windows 用 启动-Windows.bat 或 run-win.ps1。
#
# 真正的启动逻辑在 start.mjs（端口探测、局域网地址、图集检查、打开浏览器），
# 本脚本只多做一件开发期才需要的事：把「本项目」上一轮遗留的 server.js 先停掉，
# 这样改完代码重复执行本脚本就能换到新代码，而不会复用到旧进程。
set -euo pipefail
cd "$(dirname "$0")"

PID_FILE="run.pid"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 未检测到 Node.js，请先安装 Node 18+ 后重试（https://nodejs.org/）。" >&2
  exit 1
fi

# lsof 的 -F 输出会把非 ASCII 路径转义成 \xNN，直接比字符串永远不相等，
# 所以用「工作目录 inode」判定进程是否属于本项目，避免误伤同名进程。
OUR_INO=$(stat -f%i . 2>/dev/null || stat -c%i .)
is_ours() {
  local ino
  ino=$(lsof -a -p "$1" -d cwd -Fi 2>/dev/null | sed -n 's/^i//p' | head -1)
  [ -n "$ino" ] && [ "$ino" = "$OUR_INO" ]
}
killed=0
if [ -f "$PID_FILE" ]; then
  pid=$(tr -dc '0-9' < "$PID_FILE" || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && is_ours "$pid"; then
    kill "$pid" 2>/dev/null && killed=1
  fi
fi
for pid in $(pgrep -f "node .*server\.js" 2>/dev/null || true); do
  is_ours "$pid" && { kill "$pid" 2>/dev/null && killed=1; } || true
done
[ "$killed" = 1 ] && { echo "▸ 已停止本项目的旧服务进程"; sleep 0.6; }

exec node start.mjs "$@"
