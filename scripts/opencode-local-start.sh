#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PID_FILE="data/opencode-local-runner.pid"
LOG_FILE="logs/opencode-local-runner.log"
mkdir -p data logs

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "OpenCode local runner already running (pid $(cat "$PID_FILE"))."
  exit 0
fi

nohup node scripts/opencode-local-runner.mjs >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
sleep 0.5

echo "Started OpenCode local runner (pid $(cat "$PID_FILE"))."
echo "Health: curl -s http://127.0.0.1:${OPENCODE_LOCAL_PORT:-8765}/health"
