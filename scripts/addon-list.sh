#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d addons ]]; then
  echo "No addons directory found."
  exit 0
fi

echo "Available addons:"
find addons -mindepth 1 -maxdepth 1 -type d ! -name templates -printf '- %f\n' | sort
