#!/usr/bin/env bash
set -euo pipefail

QUERY="${ADDON_INPUT:-}"
if [[ -z "$QUERY" ]]; then
  echo "Missing ADDON_INPUT. Example:"
  echo "  gorky addon-run squid-music-downloader \"album title\""
  exit 1
fi

SQUID_SOURCE_BASE_URL="${SQUID_SOURCE_BASE_URL:-https://tidal.squid.wtf}"
SQUID_QUERY_ENDPOINT="${SQUID_QUERY_ENDPOINT:-/api/search?query={query}&type=album&limit=10}"
SQUID_DOWNLOAD_COMMAND_TEMPLATE="${SQUID_DOWNLOAD_COMMAND_TEMPLATE:-}"
SQUID_STAGE_DIR="${SQUID_STAGE_DIR:-/tmp/squid-music-downloads}"
SQUID_TARGET_HOST="${SQUID_TARGET_HOST:-william}"
SQUID_TARGET_PATH="${SQUID_TARGET_PATH:-/data/music/downloads}"
SQUID_IMPORT_COMMAND="${SQUID_IMPORT_COMMAND:-docker exec beets beets import -q /data/music/downloads}"
SQUID_SSH_USER="${SQUID_SSH_USER:-adam}"
SQUID_SSH_KEY_PATH="${SQUID_SSH_KEY_PATH:-/home/adam/.ssh/nanoclaw_unraid}"
SQUID_CONNECT_TIMEOUT="${SQUID_CONNECT_TIMEOUT:-15}"
SQUID_MAX_RETRIES="${SQUID_MAX_RETRIES:-2}"
SQUID_ENABLE_EXECUTION="${SQUID_ENABLE_EXECUTION:-false}"

if [[ "$SQUID_TARGET_PATH" != /* ]]; then
  echo "SQUID_TARGET_PATH must be absolute. Got: $SQUID_TARGET_PATH"
  exit 1
fi

mkdir -p "$SQUID_STAGE_DIR"

encoded_query="$(node -e 'process.stdout.write(encodeURIComponent(process.env.QUERY || ""))')"

query_url="${SQUID_SOURCE_BASE_URL}${SQUID_QUERY_ENDPOINT//\{query\}/$encoded_query}"

echo "Squid downloader plan"
echo "- Query: ${QUERY}"
echo "- Source request: ${query_url}"
echo "- Stage dir: ${SQUID_STAGE_DIR}"
echo "- Target: ${SQUID_TARGET_HOST}:${SQUID_TARGET_PATH}"
echo "- Import command: ${SQUID_IMPORT_COMMAND}"
echo "- Execution enabled: ${SQUID_ENABLE_EXECUTION}"

if [[ "$SQUID_ENABLE_EXECUTION" != "true" ]]; then
  echo "Dry-run only. Set SQUID_ENABLE_EXECUTION=true to execute."
  exit 0
fi

if [[ -z "$SQUID_DOWNLOAD_COMMAND_TEMPLATE" ]]; then
  echo "SQUID_DOWNLOAD_COMMAND_TEMPLATE is required when SQUID_ENABLE_EXECUTION=true"
  exit 1
fi

download_cmd="${SQUID_DOWNLOAD_COMMAND_TEMPLATE//\{query\}/$QUERY}"
download_cmd="${download_cmd//\{stage_dir\}/$SQUID_STAGE_DIR}"

echo "Running download command..."
attempt=0
until bash -lc "$download_cmd"; do
  attempt=$((attempt + 1))
  if [[ "$attempt" -gt "$SQUID_MAX_RETRIES" ]]; then
    echo "Download failed after ${SQUID_MAX_RETRIES} retries."
    exit 1
  fi
  echo "Download failed. Retrying (${attempt}/${SQUID_MAX_RETRIES})..."
  sleep 2
done

if [[ ! -d "$SQUID_STAGE_DIR" ]]; then
  echo "Stage directory missing after download: $SQUID_STAGE_DIR"
  exit 1
fi

echo "Copying staged files to target host..."
scp -i "$SQUID_SSH_KEY_PATH" -o BatchMode=yes -o ConnectTimeout="$SQUID_CONNECT_TIMEOUT" -r \
  "$SQUID_STAGE_DIR"/. "${SQUID_SSH_USER}@${SQUID_TARGET_HOST}:${SQUID_TARGET_PATH}/"

echo "Triggering import command on target host..."
ssh -i "$SQUID_SSH_KEY_PATH" -o BatchMode=yes -o ConnectTimeout="$SQUID_CONNECT_TIMEOUT" \
  "${SQUID_SSH_USER}@${SQUID_TARGET_HOST}" "$SQUID_IMPORT_COMMAND"

echo "Addon run complete."
