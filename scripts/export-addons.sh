#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUT_FILE="${1:-addons-export.tgz}"

if [[ ! -d addons ]]; then
  echo "No addons directory found."
  exit 1
fi

tar -czf "$OUT_FILE" addons docs/addons.md
echo "Exported addons bundle: $OUT_FILE"
