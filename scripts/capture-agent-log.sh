#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${1:-$(pwd)/groups/main/logs}"

if [[ ! -d "$LOG_DIR" ]]; then
  echo "Log directory not found: $LOG_DIR" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker binary not found" >&2
  exit 1
fi

before_latest="$(ls -1t "$LOG_DIR"/container-*.log 2>/dev/null | head -n 1 || true)"

echo "Waiting for next container run log in: $LOG_DIR"
echo "Send a Telegram message now..."

while true; do
  latest="$(ls -1t "$LOG_DIR"/container-*.log 2>/dev/null | head -n 1 || true)"
  if [[ -n "$latest" && "$latest" != "$before_latest" ]]; then
    echo ""
    echo "New run log captured: $latest"
    echo "----------------------------------------"
    cat "$latest"
    echo "----------------------------------------"
    break
  fi
  sleep 1
done
