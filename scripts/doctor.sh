#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "NanoClaw doctor"
echo "============="

ok() { echo "OK   $*"; }
warn() { echo "WARN $*"; }
fail() { echo "FAIL $*"; }

matches() {
  local pattern="$1"
  if command -v rg >/dev/null 2>&1; then
    rg -q "$pattern"
  else
    grep -Eq "$pattern"
  fi
}

if docker info >/dev/null 2>&1; then
  ok "Docker daemon is reachable"
else
  fail "Docker daemon is not reachable"
  exit 1
fi

if systemctl is-active nanoclaw >/dev/null 2>&1; then
  ok "systemd service 'nanoclaw' is active"
else
  warn "systemd service 'nanoclaw' is not active"
fi

for c in openclaw-anthropic-proxy openclaw-runner; do
  if docker ps --format '{{.Names}}' | matches "^${c}$"; then
    ok "Container '$c' is running"
  else
    warn "Container '$c' is not running"
  fi
done

if [[ -f .env ]]; then
  ok ".env exists"
else
  fail ".env missing"
  exit 1
fi

for var in TELEGRAM_BOT_TOKEN TELEGRAM_ADMIN_CHAT_ID OPENROUTER_API_KEY ANTHROPIC_BASE_URL; do
  if matches "^${var}=.+$" < .env; then
    ok "$var is set"
  else
    warn "$var is missing"
  fi
done

if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
  ok "Proxy health endpoint responds"
else
  warn "Proxy health endpoint failed"
fi

if curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1; then
  ok "Ops runner health endpoint responds"
else
  warn "Ops runner health endpoint failed"
fi

echo ""
echo "Recent nanoclaw logs:"
sudo journalctl -u nanoclaw -n 20 --no-pager || true
