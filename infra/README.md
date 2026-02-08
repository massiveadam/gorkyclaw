# Infrastructure

This directory contains the OpenClaw-like autonomous assistant stack with defense-in-depth security.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ARCHITECTURE B                                  │
│                    Plan → Policy Check → Approval → Execute                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────────┐     ┌──────────────┐     ┌─────────┐
│   Telegram   │────▶│ Telegram Gateway │────▶│  Ops Runner  │────▶│ Targets │
│    User      │     │   (Bun/Telegraf) │     │  (Bun/HTTP)  │     │ (SSH)   │
└──────────────┘     └──────────────────┘     └──────────────┘     └─────────┘
                             │                        │
                             ▼                        ▼
                      ┌──────────────┐        ┌──────────────┐
                      │ NanoClaw     │        │   SQLite     │
                      │ (Planner)    │        │   (Jobs DB)  │
                      └──────────────┘        └──────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   Obsidian   │
                      │ (Ops Logs)   │
                      └──────────────┘
```

## Security Layers

1. **Tailscale Transport**: All communication over 100.x IPs
2. **SSH ForceCommand Gatekeeper**: Strict allowlist, no-pty, no-forwarding
3. **Policy Engine**: Validates commands against allowlist
4. **Human-in-the-Loop**: Telegram inline buttons for approval
5. **Ops Runner**: Restricted SSH key, internal network only

## Quick Start

```bash
# 1. Setup environment
cp .env.example .env
# Edit .env with your tokens and paths

# 2. Install SSH gatekeeper on targets
./scripts/install-gatekeeper.sh

# 3. Generate restricted SSH key
./scripts/generate-ssh-key.sh

# 4. Start services
docker-compose up -d

# 5. Test
# Send "Check uptime on william" in Telegram
```

## Components

- **apps/telegram-gateway**: Receives Telegram messages, interfaces with NanoClaw, manages approvals
- **apps/ops-runner**: Executes approved jobs via SSH
- **packages/shared**: Zod schemas and types shared between components
- **data/**: SQLite database volume
- **keys/**: SSH keys (gitignored)
- **scripts/**: Setup and utility scripts
