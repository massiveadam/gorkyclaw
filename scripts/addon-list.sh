#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d addons ]]; then
  echo "No addons directory found."
  exit 0
fi

echo "Available addons:"
find addons -mindepth 1 -maxdepth 1 -type d ! -name templates -print0 \
  | sort -z \
  | while IFS= read -r -d '' dir; do
    name="$(basename "$dir")"
    manifest="${dir}/addon.json"
    if [[ -f "$manifest" ]]; then
      title="$(node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(m.title||'')" "$manifest" 2>/dev/null || true)"
      version="$(node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(m.version||'')" "$manifest" 2>/dev/null || true)"
      type="$(node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(m.type||'')" "$manifest" 2>/dev/null || true)"
      if [[ -n "$title" || -n "$version" || -n "$type" ]]; then
        echo "- ${name} (${type:-unknown} ${version:-?}) ${title}"
      else
        echo "- ${name}"
      fi
    else
      echo "- ${name}"
    fi
  done
