#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ADDON_NAME="${1:-}"
ADDON_INPUT="${2:-}"

if [[ -z "$ADDON_NAME" ]]; then
  echo "Usage: $0 <addon-name> [input]"
  exit 1
fi

ADDON_DIR="addons/${ADDON_NAME}"
if [[ ! -d "$ADDON_DIR" ]]; then
  echo "Addon not found: ${ADDON_NAME}"
  exit 1
fi

if ! node ./scripts/addon-validate.js "$ADDON_DIR"; then
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

HOOK_REL="$(node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write((m.entrypoints&&m.entrypoints.run)||'run.sh')" "${ADDON_DIR}/addon.json" 2>/dev/null || true)"
if [[ -z "$HOOK_REL" ]]; then
  HOOK_REL="run.sh"
fi
HOOK="${ADDON_DIR}/${HOOK_REL}"
if [[ ! -f "$HOOK" ]]; then
  echo "Addon ${ADDON_NAME} has no run.sh hook."
  exit 1
fi

if [[ ! -x "$HOOK" ]]; then
  chmod +x "$HOOK"
fi

echo "Running addon hook: ${ADDON_NAME}"
if [[ -n "$ADDON_INPUT" ]]; then
  ADDON_INPUT="$ADDON_INPUT" "$HOOK"
else
  "$HOOK"
fi
