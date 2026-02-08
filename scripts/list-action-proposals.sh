#!/usr/bin/env bash
set -euo pipefail

QUEUE_FILE="${1:-$(pwd)/data/action-queue.json}"

if [[ ! -f "$QUEUE_FILE" ]]; then
  echo "No action queue file found at: $QUEUE_FILE"
  exit 0
fi

echo "Latest action proposals from: $QUEUE_FILE"
cat "$QUEUE_FILE"
