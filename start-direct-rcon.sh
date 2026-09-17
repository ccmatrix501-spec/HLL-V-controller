#!/bin/sh
set -eu

BRIDGE_DIR="${EMBEDDED_RCON_DIR:-/opt/hllv-rcon-bridge}"
BRIDGE_PORT="${EMBEDDED_RCON_PORT:-8081}"
BRIDGE_PY="${EMBEDDED_RCON_PYTHON:-/opt/hllv-rcon-venv/bin/python}"
CONTROLLER_PORT="${PORT:-8090}"

export RCON_BACKEND="${RCON_BACKEND:-http://127.0.0.1:${BRIDGE_PORT}}"
export PLAYER_STATS_DB_PATH="${PLAYER_STATS_DB_PATH:-/tmp/hllv-player-stats.sqlite3}"
export HLLV_RCON_AUTO_CONNECT="${HLLV_RCON_AUTO_CONNECT:-true}"
export HLLV_RCON_RETRY_SECONDS="${HLLV_RCON_RETRY_SECONDS:-5}"
export HLLV_RCON_CHECK_SECONDS="${HLLV_RCON_CHECK_SECONDS:-3}"
export RCON_CONNECT_TIMEOUT="${RCON_CONNECT_TIMEOUT:-35}"
export RCON_COMMAND_TIMEOUT="${RCON_COMMAND_TIMEOUT:-30}"
export EMBEDDED_RCON_PORT="$BRIDGE_PORT"

if [ -z "${HLLV_RCON_HOST:-}" ] || [ -z "${HLLV_RCON_PASSWORD:-}" ]; then
  echo "[DIRECT-RCON] Missing HLLV_RCON_HOST or HLLV_RCON_PASSWORD; controller will start, but direct RCON auto-connect cannot authenticate." >&2
fi

echo "[DIRECT-RCON] Starting embedded HLL:V RCON service on 127.0.0.1:${BRIDGE_PORT}"
cd "$BRIDGE_DIR"
# The current revive compatibility parser can mistake our own SERVER STATS messages
# for revive-like events. Keep that diagnostic logger at ERROR so a busy server
# cannot flood Railway's 500 logs/sec limit while the bridge remains functional.
"$BRIDGE_PY" -c 'import logging, os, uvicorn; logging.getLogger("hllv-rcon-bridge.revives").setLevel(logging.ERROR); uvicorn.run("admin_support_entry:app", host="127.0.0.1", port=int(os.environ["EMBEDDED_RCON_PORT"]))' &
BRIDGE_PID=$!

cleanup() {
  code=$?
  trap - INT TERM EXIT
  if [ -n "${NODE_PID:-}" ]; then kill "$NODE_PID" 2>/dev/null || true; fi
  kill "$BRIDGE_PID" 2>/dev/null || true
  wait "$BRIDGE_PID" 2>/dev/null || true
  if [ -n "${NODE_PID:-}" ]; then wait "$NODE_PID" 2>/dev/null || true; fi
  exit "$code"
}
trap cleanup INT TERM EXIT

ready=0
i=0
while [ "$i" -lt 60 ]; do
  if wget -q -O /tmp/embedded-rcon-health.json "http://127.0.0.1:${BRIDGE_PORT}/health" 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    echo "[DIRECT-RCON] Embedded RCON service exited during startup." >&2
    wait "$BRIDGE_PID" || true
    exit 1
  fi
  i=$((i + 1))
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "[DIRECT-RCON] Embedded RCON service did not become healthy in time." >&2
  exit 1
fi

echo "[DIRECT-RCON] Embedded RCON service healthy; backend=${RCON_BACKEND}"
echo "[CONTROLLER] Starting controller on port ${CONTROLLER_PORT}"
cd /app
node --require ./persistent-auth.js --require ./public-stats-preload.js server.js &
NODE_PID=$!

while :; do
  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    echo "[DIRECT-RCON] Embedded RCON process stopped; restarting container." >&2
    wait "$BRIDGE_PID" || true
    exit 1
  fi
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "[CONTROLLER] Node controller stopped; restarting container." >&2
    wait "$NODE_PID" || true
    exit 1
  fi
  sleep 2
done
