# Upgrade Guide

## Pull latest

```bash
git pull
```

## Rebuild

```bash
npm install
npm run build
docker build -t openclaw-anthropic-proxy:latest infra/apps/anthropic-proxy
docker build -t nanoclaw-ops-runner:latest infra/apps/ops-runner
docker build -t nanoclaw-agent:latest -f container/Dockerfile container
```

## Restart runtime

```bash
docker rm -f openclaw-anthropic-proxy openclaw-runner 2>/dev/null || true
docker run -d --name openclaw-anthropic-proxy --restart unless-stopped --env-file .env -e PORT=3000 -p 3000:3000 openclaw-anthropic-proxy:latest
docker run -d --name openclaw-runner --restart unless-stopped --env-file .env -e PORT=8080 -p 8080:8080 -v "$HOME/.ssh:/app/keys:ro" -v "$PWD/infra/data:/app/data" nanoclaw-ops-runner:latest
sudo systemctl restart nanoclaw
```

## Post-upgrade checks

```bash
./scripts/doctor.sh
./scripts/reliability-smoke.sh --env-file .env
```
