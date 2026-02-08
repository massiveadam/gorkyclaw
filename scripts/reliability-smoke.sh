#!/usr/bin/env bash
# Reliability smoke check for NanoClaw runtime dependencies and routing.
# Usage: ./scripts/reliability-smoke.sh [--env-file .env] [--service nanoclaw] [--proxy-container openclaw-anthropic-proxy] [--proxy-health-url http://127.0.0.1:3000/health]

set -u
set -o pipefail

ENV_FILE=".env"
SERVICE_NAME="nanoclaw"
PROXY_CONTAINER="openclaw-anthropic-proxy"
PROXY_HEALTH_URL="http://127.0.0.1:3000/health"

declare -a FAILS=()
declare -a WARNS=()

add_fail() {
  FAILS+=("$1")
  printf 'FAIL  %s\n' "$1"
}

add_warn() {
  WARNS+=("$1")
  printf 'WARN  %s\n' "$1"
}

add_ok() {
  printf 'OK    %s\n' "$1"
}

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

extract_env_key() {
  local key="$1"
  local content="$2"
  printf '%s\n' "$content" | awk -F '=' -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      k = line
      sub(/=.*/, "", k)
      gsub(/[[:space:]]+/, "", k)
      if (k == key) {
        v = line
        sub(/^[^=]*=/, "", v)
        print v
      }
    }
  ' | tail -n 1
}

is_free_model() {
  local model
  model="$(trim_value "$1")"
  [[ "$model" == "openrouter/free" || "$model" == *":free" ]]
}

print_usage() {
  cat <<EOF
Usage: $0 [options]
  --env-file PATH           Env file to check when container env is unavailable (default: .env)
  --service NAME            Main service name for systemd checks (default: nanoclaw)
  --proxy-container NAME    Proxy container name (default: openclaw-anthropic-proxy)
  --proxy-health-url URL    Proxy health URL (default: http://127.0.0.1:3000/health)
  -h, --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --service)
      SERVICE_NAME="${2:-}"
      shift 2
      ;;
    --proxy-container)
      PROXY_CONTAINER="${2:-}"
      shift 2
      ;;
    --proxy-health-url)
      PROXY_HEALTH_URL="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      print_usage
      exit 2
      ;;
  esac
done

docker_ok=false
proxy_running=false
proxy_env_text=""

if ! command -v docker >/dev/null 2>&1; then
  add_fail "docker CLI not found (install Docker and ensure docker is in PATH)"
else
  if docker ps >/dev/null 2>&1; then
    docker_ok=true
    add_ok "docker daemon is reachable"
  else
    add_fail "docker daemon is not reachable (start Docker service/Desktop)"
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  service_state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
  if [[ "$service_state" == "active" ]]; then
    add_ok "systemd service '$SERVICE_NAME' is active"
  elif [[ -z "$service_state" ]]; then
    add_warn "unable to query systemd service '$SERVICE_NAME' from this shell; run manually on host if needed"
  else
    add_fail "systemd service '$SERVICE_NAME' is '$service_state' (run: sudo systemctl start $SERVICE_NAME)"
  fi
else
  add_warn "systemctl not available; skipping service check"
fi

if pgrep -f "node .*dist/index\\.js|src/index\\.ts" >/dev/null 2>&1; then
  add_ok "main process appears to be running"
else
  add_fail "main process not detected (expected node dist/index.js)"
fi

if [[ "$docker_ok" == "true" ]]; then
  proxy_state="$(docker inspect -f '{{.State.Running}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
  if [[ "$proxy_state" == "true" ]]; then
    proxy_running=true
    add_ok "proxy container '$PROXY_CONTAINER' is running"
    proxy_env_text="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$PROXY_CONTAINER" 2>/dev/null || true)"
  else
    add_fail "proxy container '$PROXY_CONTAINER' is not running (start compose stack)"
  fi
fi

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 3 "$PROXY_HEALTH_URL" >/dev/null 2>&1; then
    add_ok "proxy health endpoint responds ($PROXY_HEALTH_URL)"
  else
    add_fail "proxy health endpoint failed ($PROXY_HEALTH_URL)"
  fi
else
  add_warn "curl not found; skipping proxy health request"
fi

if [[ -z "$proxy_env_text" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    proxy_env_text="$(cat "$ENV_FILE")"
    add_ok "using env file for routing checks ($ENV_FILE)"
  else
    add_fail "cannot load routing config: missing container env and missing $ENV_FILE"
  fi
fi

reasoning_model="$(trim_value "$(extract_env_key "REASONING_MODEL" "$proxy_env_text")")"
completion_model="$(trim_value "$(extract_env_key "COMPLETION_MODEL" "$proxy_env_text")")"
require_free_models="$(trim_value "$(extract_env_key "REQUIRE_FREE_MODELS" "$proxy_env_text")")"
openrouter_api_key="$(trim_value "$(extract_env_key "OPENROUTER_API_KEY" "$proxy_env_text")")"

if [[ "$require_free_models" == "REQUIRE_FREE_MODELS" ]]; then
  require_free_models=""
fi

if [[ -z "$reasoning_model" ]]; then
  add_fail "REASONING_MODEL is not set"
elif is_free_model "$reasoning_model"; then
  add_ok "REASONING_MODEL uses OpenRouter free model ($reasoning_model)"
else
  add_fail "REASONING_MODEL is not free-model routed ($reasoning_model)"
fi

if [[ -z "$completion_model" ]]; then
  add_fail "COMPLETION_MODEL is not set"
elif is_free_model "$completion_model"; then
  add_ok "COMPLETION_MODEL uses OpenRouter free model ($completion_model)"
else
  add_fail "COMPLETION_MODEL is not free-model routed ($completion_model)"
fi

if [[ -z "$require_free_models" || "${require_free_models,,}" == "true" ]]; then
  add_ok "REQUIRE_FREE_MODELS is enabled"
else
  add_fail "REQUIRE_FREE_MODELS is '$require_free_models' (set to true)"
fi

if [[ -n "$openrouter_api_key" ]]; then
  add_ok "OPENROUTER_API_KEY is present"
else
  add_fail "OPENROUTER_API_KEY is missing"
fi

echo
if [[ "${#FAILS[@]}" -eq 0 ]]; then
  echo "Result: PASS (${#WARNS[@]} warnings)"
  exit 0
fi

echo "Result: FAIL (${#FAILS[@]} failed checks, ${#WARNS[@]} warnings)"
exit 1
