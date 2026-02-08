#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "Installing self-model addon..."
chmod +x scripts/self-model-report.sh 2>/dev/null || true
./scripts/self-model-report.sh
echo "Self-model report generated."
