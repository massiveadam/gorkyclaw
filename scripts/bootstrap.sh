#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

install_user_cli() {
  mkdir -p "$HOME/.local/bin"
  ln -sf "$ROOT_DIR/scripts/gorky" "$HOME/.local/bin/gorky"
  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    echo "Added ~/.local/bin to PATH in ~/.bashrc (open a new shell or run: source ~/.bashrc)"
  fi
}

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

if ! docker info >/dev/null 2>&1; then
  echo "Cannot access Docker daemon."
  echo "If you see 'permission denied', run:"
  echo "  sudo usermod -aG docker \$USER"
  echo "  newgrp docker"
  echo "Then rerun bootstrap."
  exit 1
fi

echo "Installing npm dependencies..."
NODE_ENV= npm install --include=dev

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
install_user_cli
if command -v sudo >/dev/null 2>&1; then
  sudo install -m 0755 scripts/gorky /usr/local/bin/gorky || true
fi

echo "Bootstrap complete."
echo "Next:"
echo "1) Edit .env"
echo "2) Start stack: gorky (or ~/.local/bin/gorky)"
echo "3) Run health check: ./scripts/doctor.sh"
