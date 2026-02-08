#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (Node 20+). Install node first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required."
  exit 1
fi

echo "Installing npm dependencies..."
npm install

echo "Building TypeScript..."
npm run build

echo "Building images..."
docker build -t openclaw-anthropic-proxy:latest infra/apps/anthropic-proxy
docker build -t nanoclaw-ops-runner:latest infra/apps/ops-runner
docker build -t nanoclaw-agent:latest -f container/Dockerfile container

mkdir -p infra/data

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit .env before starting services."
fi

echo "Installing systemd unit..."
sudo install -m 0644 systemd/nanoclaw.service /etc/systemd/system/nanoclaw.service
sudo systemctl daemon-reload
sudo systemctl enable nanoclaw >/dev/null 2>&1 || true

echo "Installing global CLI command..."
sudo install -m 0755 scripts/gorky /usr/local/bin/gorky

echo "Bootstrap complete."
echo "Next:"
echo "1) Edit .env"
echo "2) Start stack: gorky"
echo "3) Run health check: ./scripts/doctor.sh"
