#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"
PORT_VALUE=${PORT:-4173}
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请安装 Node.js 18 或更高版本。" >&2
  exit 1
fi
node tools/preflight.js "--port=$PORT_VALUE"
exec node server.js "--port=$PORT_VALUE"
