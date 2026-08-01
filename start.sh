#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
PORT=4173
node server.js --port=${PORT} &
SERVER_PID=$!
sleep 0.8
if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 || true; fi
wait ${SERVER_PID}
