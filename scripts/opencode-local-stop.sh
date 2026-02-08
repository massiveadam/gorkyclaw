#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="data/opencode-local-runner.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "OpenCode local runner is not running."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" || true
  sleep 0.3
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" || true
  fi
fi

rm -f "$PID_FILE"
echo "Stopped OpenCode local runner."
