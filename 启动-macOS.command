#!/bin/bash
# 启动-macOS.command — 双击启动（Finder 会用终端打开 .command）
# 逻辑都在 start.mjs，这里只处理"没装 Node"的提示与窗口不闪退。
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  ✗ 没有检测到 Node.js"
  echo
  echo "    本项目只需要 Node 18 或更高版本，装完不用 npm install。"
  echo "    方式一：https://nodejs.org/zh-cn/download 下载.pkg 安装"
  echo "    方式二：brew install node"
  echo
  echo "    装好后重新双击本文件即可。"
  echo
  read -r -p "  按回车关闭窗口…" _
  exit 1
fi

echo "  DAO3 编辑器复刻 — 正在启动本地服务（Ctrl+C 停止）"
node start.mjs "$@"
echo
echo "  服务已停止。"
read -r -p "  按回车关闭窗口…" _
