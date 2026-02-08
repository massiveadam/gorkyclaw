#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ADDON_NAME="${1:-}"
if [[ -z "$ADDON_NAME" ]]; then
  echo "Usage: $0 <addon-name>"
  exit 1
fi

ADDON_DIR="addons/${ADDON_NAME}"
if [[ ! -d "$ADDON_DIR" ]]; then
  echo "Addon not found: ${ADDON_NAME}"
  ./scripts/addon-list.sh || true
  exit 1
fi

if [[ ! -f "${ADDON_DIR}/ADDON.md" ]]; then
  echo "Invalid addon (${ADDON_NAME}): ADDON.md missing"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [[ -f "${ADDON_DIR}/env.example" ]]; then
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    key="${line%%=*}"
    if ! rg -q "^${key}=" .env; then
      echo "$line" >> .env
      echo "Added ${key} to .env (from addon template)"
    fi
  done < "${ADDON_DIR}/env.example"
fi

if [[ -x "${ADDON_DIR}/install.sh" ]]; then
  echo "Running ${ADDON_DIR}/install.sh ..."
  "${ADDON_DIR}/install.sh"
elif [[ -f "${ADDON_DIR}/install.sh" ]]; then
  echo "Running ${ADDON_DIR}/install.sh ..."
  bash "${ADDON_DIR}/install.sh"
else
  echo "No install.sh found. Addon metadata applied only."
fi

echo "Addon installed: ${ADDON_NAME}"
echo "Review ${ADDON_DIR}/ADDON.md for post-install steps."
