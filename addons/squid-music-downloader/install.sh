#!/usr/bin/env bash
set -euo pipefail

echo "squid-music-downloader installed."
echo "1) Configure env values in .env (search/download/target/import settings)."
echo "2) Keep SQUID_ENABLE_EXECUTION=false until you validate dry-run output."
echo "3) Test with: gorky addon-run squid-music-downloader \"your album query\""
