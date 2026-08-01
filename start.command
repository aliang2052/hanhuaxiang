#!/bin/bash
cd "$(dirname "$0")"
PORT=4173
node server.js --port=${PORT} &
SERVER_PID=$!
sleep 0.8
open "http://localhost:${PORT}" >/dev/null 2>&1 || true
wait ${SERVER_PID}
