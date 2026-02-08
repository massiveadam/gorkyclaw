#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

install_user_cli() {
  mkdir -p "$HOME/.local/bin"
  ln -sf "$ROOT_DIR/scripts/gorky" "$HOME/.local/bin/gorky"
  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    echo "Added ~/.local/bin to PATH in ~/.bashrc (open new shell or run: source ~/.bashrc)"
  fi
}

if [[ ! -f ".env.example" ]]; then
  echo ".env.example not found. Run from repo root."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

install_user_cli

has_line() {
  local pattern="$1"
  if command -v rg >/dev/null 2>&1; then
    rg -q "$pattern" .env
  else
    grep -Eq "$pattern" .env
  fi
}

get_value() {
  local key="$1"
  if command -v rg >/dev/null 2>&1; then
    rg "^${key}=" .env | head -n1 | cut -d'=' -f2-
  else
    grep -E "^${key}=" .env | head -n1 | cut -d'=' -f2-
  fi
}

set_env() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp)"

  if has_line "^${key}="; then
    awk -v k="$key" -v v="$value" '
      BEGIN { replaced = 0 }
      $0 ~ ("^" k "=") {
        if (!replaced) {
          print k "=" v
          replaced = 1
        }
        next
      }
      { print }
      END {
        if (!replaced) {
          print k "=" v
        }
      }
    ' .env > "$tmp_file"
    mv "$tmp_file" .env
  else
    rm -f "$tmp_file"
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

  >&2 echo ""
  >&2 echo "Trying to detect your Telegram chat id..."
  >&2 echo "If not already done, open Telegram and send /start to your bot now."

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

  if [[ "$chat_id" =~ ^-?[0-9]+$ ]]; then
    printf '%s' "$chat_id"
  else
    printf ''
  fi
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
telegram_token="$(get_value "TELEGRAM_BOT_TOKEN")"
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
set_env "ANTHROPIC_API_KEY" "$(get_value "OPENROUTER_API_KEY")"

prompt_optional "Obsidian vault path (optional)" "OBSIDIAN_VAULT_PATH" ""
prompt_optional "Obsidian memory dirs (comma-separated)" "OBSIDIAN_MEMORY_DIRS" "Memory,Projects"

set_env "ANTHROPIC_BASE_URL" "http://127.0.0.1:3000"
set_env "REQUIRE_FREE_MODELS" "true"
set_env "REASONING_MODEL" "google/gemma-3-27b-it:free"
set_env "COMPLETION_MODEL" "google/gemma-3-27b-it:free"
set_env "FALLBACK_MODELS" "meta-llama/llama-3.3-70b-instruct:free,mistralai/mistral-small-3.1-24b-instruct:free"
set_env "ENABLE_APPROVED_EXECUTION" "true"
set_env "APPROVED_ACTION_WEBHOOK_URL" "http://127.0.0.1:8080/dispatch"
set_env "OPS_RUNNER_URL" "http://127.0.0.1:8080"
set_env "RUN_MONITOR_POLL_INTERVAL_MS" "15000"
set_env "OPENCODE_SERVE_URL" "http://host.docker.internal:8765/run"
set_env "OPENCODE_LOCAL_PORT" "8765"
set_env "OPENCODE_DEFAULT_WORKDIR" "$PWD"
set_env "OPENCODE_TIMEOUT_MS" "21600000"
set_env "OPENCODE_LOCAL_AUTOSTART" "true"

if ! has_line '^OPS_RUNNER_SHARED_SECRET=.+$' || [[ "$(get_value "OPS_RUNNER_SHARED_SECRET")" == "CHANGE_ME_RUNNER_SECRET" ]]; then
  set_env "OPS_RUNNER_SHARED_SECRET" "$(gen_secret)"
fi
if ! has_line '^APPROVED_ACTION_WEBHOOK_SECRET=.+$' || [[ "$(get_value "APPROVED_ACTION_WEBHOOK_SECRET")" == "CHANGE_ME_WEBHOOK_SECRET" ]]; then
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
  docker run -d --name openclaw-runner --restart unless-stopped --env-file .env -e PORT=8080 -p 8080:8080 --add-host host.docker.internal:host-gateway -v "$HOME/.ssh:/app/keys:ro" -v "$PWD/infra/data:/app/data" nanoclaw-ops-runner:latest
  sudo systemctl restart nanoclaw
  ./scripts/doctor.sh || true
fi

echo ""
echo "Done. You can now test by messaging your Telegram bot."
