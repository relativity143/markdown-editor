#!/usr/bin/env bash
# 走 HTTP 代理打包 Electron 应用
# 用法：./scripts/build-with-proxy.sh [target]
#   target 默认 mac-arm；可选：mac-arm / mac-x64 / mac

set -e
cd "$(dirname "$0")/.."

# 自动探测常见代理端口
PROXY_PORT="${PROXY_PORT:-}"
if [ -z "$PROXY_PORT" ]; then
  for p in 7897 7890 7891 1087 8080; do
    if curl -s -o /dev/null --max-time 2 --proxy "http://127.0.0.1:$p" https://github.com/ >/dev/null 2>&1; then
      PROXY_PORT="$p"
      break
    fi
  done
fi

if [ -z "$PROXY_PORT" ]; then
  echo "⚠️  未检测到可用的本地 HTTP 代理。请确保 Clash / Surge / V2Ray 已开启，"
  echo "    或手动指定：PROXY_PORT=xxxx ./scripts/build-with-proxy.sh"
  exit 1
fi

echo "→ 使用代理 127.0.0.1:$PROXY_PORT"

export HTTPS_PROXY="http://127.0.0.1:$PROXY_PORT"
export HTTP_PROXY="http://127.0.0.1:$PROXY_PORT"
export ALL_PROXY="http://127.0.0.1:$PROXY_PORT"
unset ELECTRON_RUN_AS_NODE

TARGET="${1:-mac-arm}"
case "$TARGET" in
  mac-arm|mac-arm64) npm run build:mac-arm ;;
  mac-x64|mac-intel) npm run build:mac-x64 ;;
  mac|all)           npm run build:mac ;;
  *) echo "未知目标: $TARGET (支持: mac-arm / mac-x64 / mac)"; exit 1 ;;
esac

echo "✓ 完成。产物在 dist/"
