#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.example" ]]; then
  echo ".env.example not found. Run from repo root."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

set_env() {
  local key="$1"
  local value="$2"
  if rg -q "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${value}#g" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

prompt_required() {
  local label="$1"
  local varname="$2"
  local val=""
  while [[ -z "$val" ]]; do
    read -r -p "${label}: " val
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
  done
  set_env "$varname" "$val"
}

prompt_optional() {
  local label="$1"
  local varname="$2"
  local default="$3"
  read -r -p "${label} [${default}]: " val
  val="${val:-$default}"
  set_env "$varname" "$val"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16
  else
    date +%s | sha256sum | cut -d' ' -f1 | cut -c1-32
  fi
}

detect_telegram_chat_id() {
  local token="$1"
  local response=""
  local chat_id=""
  local i

  echo ""
  echo "Trying to detect your Telegram chat id..."
  echo "If not already done, open Telegram and send /start to your bot now."

  # Poll a few times so the user can send a fresh message during onboarding.
  for i in 1 2 3; do
    response="$(curl -fsS "https://api.telegram.org/bot${token}/getUpdates?timeout=20&limit=10&allowed_updates=%5B%22message%22,%22edited_message%22,%22channel_post%22%5D" 2>/dev/null || true)"
    if [[ -z "$response" ]]; then
      continue
    fi

    if command -v jq >/dev/null 2>&1; then
      chat_id="$(printf '%s' "$response" | jq -r '.result | reverse | .[] | (.message.chat.id // .edited_message.chat.id // .channel_post.chat.id // empty) | select(. != null) | tostring' 2>/dev/null | head -n1 || true)"
    else
      chat_id="$(printf '%s' "$response" | node -e '
        const fs = require("fs");
        try {
          const d = JSON.parse(fs.readFileSync(0, "utf8"));
          const r = Array.isArray(d.result) ? d.result.slice().reverse() : [];
          for (const u of r) {
            const id = (u.message && u.message.chat && u.message.chat.id) ||
                       (u.edited_message && u.edited_message.chat && u.edited_message.chat.id) ||
                       (u.channel_post && u.channel_post.chat && u.channel_post.chat.id);
            if (id !== undefined && id !== null) {
              process.stdout.write(String(id));
              break;
            }
          }
        } catch {}
      ' 2>/dev/null || true)"
    fi

    if [[ -n "$chat_id" ]]; then
      break
    fi
  done

  printf '%s' "$chat_id"
}

echo ""
echo "NanoClaw Onboarding (Telegram + OpenRouter free-only)"
echo "====================================================="
echo ""
echo "Get these before continuing:"
echo "- Telegram bot token (BotFather)"
echo "- Open Telegram and message your bot (/start) so chat id can be detected"
echo "- OpenRouter API key"
echo ""

prompt_required "Telegram bot token" "TELEGRAM_BOT_TOKEN"
telegram_token="$(rg '^TELEGRAM_BOT_TOKEN=' .env | cut -d'=' -f2-)"
detected_chat_id="$(detect_telegram_chat_id "$telegram_token")"
if [[ -n "$detected_chat_id" ]]; then
  set_env "TELEGRAM_ADMIN_CHAT_ID" "$detected_chat_id"
  echo "Detected Telegram admin chat id: $detected_chat_id"
else
  echo "Could not auto-detect Telegram admin chat id."
  echo "Message your bot once (e.g. /start), then enter chat id manually."
  prompt_required "Telegram admin chat id" "TELEGRAM_ADMIN_CHAT_ID"
fi
prompt_required "OpenRouter API key (sk-or-...)" "OPENROUTER_API_KEY"
set_env "ANTHROPIC_API_KEY" "$(rg '^OPENROUTER_API_KEY=' .env | cut -d'=' -f2-)"

prompt_optional "Obsidian vault path (optional)" "OBSIDIAN_VAULT_PATH" ""
prompt_optional "Obsidian memory dirs (comma-separated)" "OBSIDIAN_MEMORY_DIRS" "Memory,Projects"

set_env "ANTHROPIC_BASE_URL" "http://127.0.0.1:3000"
set_env "REQUIRE_FREE_MODELS" "true"
set_env "REASONING_MODEL" "google/gemma-3-27b-it:free"
set_env "COMPLETION_MODEL" "google/gemma-3-27b-it:free"
set_env "FALLBACK_MODELS" "meta-llama/llama-3.3-70b-instruct:free,mistralai/mistral-small-3.1-24b-instruct:free"
set_env "ENABLE_APPROVED_EXECUTION" "true"
set_env "APPROVED_ACTION_WEBHOOK_URL" "http://127.0.0.1:8080/dispatch"

if ! rg -q '^OPS_RUNNER_SHARED_SECRET=.+$' .env || [[ "$(rg '^OPS_RUNNER_SHARED_SECRET=' .env | cut -d'=' -f2-)" == "CHANGE_ME_RUNNER_SECRET" ]]; then
  set_env "OPS_RUNNER_SHARED_SECRET" "$(gen_secret)"
fi
if ! rg -q '^APPROVED_ACTION_WEBHOOK_SECRET=.+$' .env || [[ "$(rg '^APPROVED_ACTION_WEBHOOK_SECRET=' .env | cut -d'=' -f2-)" == "CHANGE_ME_WEBHOOK_SECRET" ]]; then
  set_env "APPROVED_ACTION_WEBHOOK_SECRET" "$(gen_secret)"
fi

echo ""
echo "Environment updated in .env"
echo ""
read -r -p "Build/start stack now? [Y/n]: " start_now
start_now="${start_now:-Y}"

if [[ "$start_now" =~ ^[Yy]$ ]]; then
  ./scripts/bootstrap.sh
  docker rm -f openclaw-anthropic-proxy openclaw-runner 2>/dev/null || true
  docker run -d --name openclaw-anthropic-proxy --restart unless-stopped --env-file .env -e PORT=3000 -p 3000:3000 openclaw-anthropic-proxy:latest
  docker run -d --name openclaw-runner --restart unless-stopped --env-file .env -e PORT=8080 -p 8080:8080 -v "$HOME/.ssh:/app/keys:ro" -v "$PWD/infra/data:/app/data" nanoclaw-ops-runner:latest
  sudo systemctl restart nanoclaw
  ./scripts/doctor.sh || true
fi

echo ""
echo "Done. You can now test by messaging your Telegram bot."
