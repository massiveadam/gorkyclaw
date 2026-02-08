#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ADDON_NAME="${1:-}"
ADDON_PURPOSE="${2:-}"

if [[ -z "$ADDON_NAME" ]]; then
  echo "Usage: $0 <addon-name> [purpose]"
  exit 1
fi

if [[ ! "$ADDON_NAME" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]]; then
  echo "Invalid addon name: ${ADDON_NAME}"
  echo "Use lowercase letters, digits, and hyphens (max 64 chars)."
  exit 1
fi

if [[ "$ADDON_NAME" == "templates" ]]; then
  echo "Addon name 'templates' is reserved."
  exit 1
fi

TARGET_DIR="addons/${ADDON_NAME}"
TEMPLATE_DIR="addons/templates/basic-addon"

if [[ -d "$TARGET_DIR" ]]; then
  echo "Addon already exists: ${ADDON_NAME}"
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "${TEMPLATE_DIR}/ADDON.md" "${TARGET_DIR}/ADDON.md"
cp "${TEMPLATE_DIR}/addon.json" "${TARGET_DIR}/addon.json"
cp "${TEMPLATE_DIR}/env.example" "${TARGET_DIR}/env.example"
cp "${TEMPLATE_DIR}/install.sh" "${TARGET_DIR}/install.sh"
chmod +x "${TARGET_DIR}/install.sh"

if [[ -n "$ADDON_PURPOSE" ]]; then
  escaped_purpose="$(printf '%s' "$ADDON_PURPOSE" | sed -e 's/[\/&]/\\&/g' -e ':a;N;$!ba;s/\n/\\n/g')"
  sed -i "s|Describe the capability this addon introduces.|${escaped_purpose}|g" "${TARGET_DIR}/ADDON.md"
fi

safe_upper="$(echo "$ADDON_NAME" | tr '[:lower:]-' '[:upper:]_')"
sed -i "s/basic-addon/${ADDON_NAME}/g" "${TARGET_DIR}/ADDON.md" "${TARGET_DIR}/install.sh" "${TARGET_DIR}/addon.json"
sed -i "s/BASIC_ADDON_ENABLED/${safe_upper}_ENABLED/g" "${TARGET_DIR}/env.example"
if [[ -n "$ADDON_PURPOSE" ]]; then
  escaped_json_purpose="$(printf '%s' "$ADDON_PURPOSE" | sed -e 's/[\/&]/\\&/g' -e ':a;N;$!ba;s/\n/\\n/g')"
  sed -i "s|Describe the capability this addon introduces.|${escaped_json_purpose}|g" "${TARGET_DIR}/addon.json"
fi

if ! node ./scripts/addon-validate.js "${TARGET_DIR}"; then
  exit 1
fi

echo "Addon scaffold created: ${TARGET_DIR}"
echo "Next steps:"
echo "1) Edit ${TARGET_DIR}/ADDON.md"
echo "2) Implement ${TARGET_DIR}/install.sh"
echo "3) Optionally add defaults in ${TARGET_DIR}/env.example"
