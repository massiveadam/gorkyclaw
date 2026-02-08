#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPORT_PATH="${SELF_MODEL_REPORT_PATH:-store/self-model.md}"
mkdir -p "$(dirname "$REPORT_PATH")"

get_env_value() {
  local key="$1"
  if command -v rg >/dev/null 2>&1; then
    rg "^${key}=" .env | head -n1 | cut -d'=' -f2- || true
  else
    grep -E "^${key}=" .env | head -n1 | cut -d'=' -f2- || true
  fi
}

match_stream() {
  local pattern="$1"
  if command -v rg >/dev/null 2>&1; then
    rg "$pattern" || true
  else
    grep -E "$pattern" || true
  fi
}

if [[ -f .env ]]; then
  free_required="$(get_env_value "REQUIRE_FREE_MODELS")"
  reasoning_model="$(get_env_value "REASONING_MODEL")"
  completion_model="$(get_env_value "COMPLETION_MODEL")"
  approval_exec="$(get_env_value "ENABLE_APPROVED_EXECUTION")"
else
  free_required=""
  reasoning_model=""
  completion_model=""
  approval_exec=""
fi

service_state="$(systemctl is-active nanoclaw 2>/dev/null || echo unknown)"
proxy_state="$(docker ps --format '{{.Names}} {{.Status}}' | match_stream '^openclaw-anthropic-proxy ')"
runner_state="$(docker ps --format '{{.Names}} {{.Status}}' | match_stream '^openclaw-runner ')"

branch="$(git branch --show-current 2>/dev/null || echo unknown)"
commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

addons_list="$(find addons -mindepth 1 -maxdepth 1 -type d ! -name templates -printf '- %f\n' | sort || true)"

cat > "$REPORT_PATH" <<EOF
# Gorky Self Model Snapshot

Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## Identity

- Assistant name: Gorky
- Interface: Telegram
- Runtime mode: OpenRouter free-only via local proxy
- Repo branch: ${branch}
- Repo commit: ${commit}

## Core Runtime Status

- nanoclaw service: ${service_state}
- anthropic proxy container: ${proxy_state:-not running}
- ops runner container: ${runner_state:-not running}

## Effective Config (safe subset)

- REQUIRE_FREE_MODELS: ${free_required:-unset}
- REASONING_MODEL: ${reasoning_model:-unset}
- COMPLETION_MODEL: ${completion_model:-unset}
- ENABLE_APPROVED_EXECUTION: ${approval_exec:-unset}

## Capability Packaging

### Addons (install with \`gorky addon-install <name>\`)
${addons_list:-"- (none)"}

## Operations Commands

- Start stack: \`gorky\`
- Health check: \`gorky status\` or \`./scripts/doctor.sh\`
- Rebuild report: \`gorky self\`
- List addons: \`gorky addons\`
- Install addon: \`gorky addon-install <name>\`
- Export addons: \`gorky export-addons <file>\`
- Import addons: \`gorky import-addons <file>\`
- Start local OpenCode runner: \`gorky opencode-start\`
- Local OpenCode status: \`gorky opencode-status\`

## Constraints

- Do not reveal API keys/tokens.
- Mutating actions require explicit approval.
- Treat this file as source-of-truth for setup/capability Q&A.
EOF

echo "Wrote ${REPORT_PATH}"
