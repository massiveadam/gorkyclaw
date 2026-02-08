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
PORT="${OPENCODE_LOCAL_PORT:-8765}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "OpenCode local runner: running (pid $(cat "$PID_FILE"))."
else
  echo "OpenCode local runner: stopped."
fi

if command -v curl >/dev/null 2>&1; then
  echo "Health:"
  curl -s "http://127.0.0.1:${PORT}/health" || true
  echo ""
fi
