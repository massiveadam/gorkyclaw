#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUT_FILE="${1:-skills-export.tgz}"

if [[ ! -d skills ]]; then
  echo "No skills directory found."
  exit 1
fi

tar -czf "$OUT_FILE" skills SKILLS_INDEX.md
echo "Exported skills bundle: $OUT_FILE"
