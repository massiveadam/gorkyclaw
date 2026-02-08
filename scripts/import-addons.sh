#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BUNDLE="${1:-}"
if [[ -z "$BUNDLE" ]]; then
  echo "Usage: $0 <addons-export.tgz>"
  exit 1
fi

if [[ ! -f "$BUNDLE" ]]; then
  echo "Bundle not found: $BUNDLE"
  exit 1
fi

mkdir -p addons
tar -xzf "$BUNDLE" -C "$ROOT_DIR"
echo "Imported addons from: $BUNDLE"
