# OpenClaw Infrastructure

## Quick Start

```bash
# 1. Enter infra directory
cd infra

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your tokens and paths

# 3. Generate SSH key for aiops user
./scripts/generate-ssh-key.sh

# 4. Install gatekeeper on target hosts
scp scripts/install-gatekeeper.sh root@100.70.173.74:/tmp/
ssh root@100.70.173.74 'bash /tmp/install-gatekeeper.sh'

# 5. Copy SSH public key to targets
cat keys/aiops.pub
# Add to /var/lib/aiops/.ssh/authorized_keys with ForceCommand

# 6. Build and start services
docker-compose up -d

# 7. Test
curl http://localhost:8080/health
```

## Architecture

See [README.md](README.md) and [docs/security.md](docs/security.md) for detailed documentation.

## Directory Structure

```
infra/
├── apps/
│   ├── telegram-gateway/    # Telegram bot + policy engine
│   └── ops-runner/          # SSH execution service
├── packages/
│   └── shared/              # Zod schemas and types
├── data/                    # SQLite database (gitignored)
├── keys/                    # SSH keys (gitignored)
├── scripts/
│   ├── generate-ssh-key.sh
│   └── install-gatekeeper.sh
├── docker-compose.yml
└── .env.example
```

## Testing

### Manual Test

Send in Telegram: `Check uptime on william`

Expected flow:

1. Gateway receives message
2. NanoClaw generates JSON plan
3. Gateway executes immediately (safe diagnostic)
4. Results posted to Telegram
5. Log written to Obsidian

### Test Dangerous Command

Send: `bash -i on william`

Expected:

1. Plan generated
2. Approval requested (or command blocked by policy)
3. Gatekeeper would reject if attempted

## Troubleshooting

### View logs

```bash
docker-compose logs -f telegram-gateway
docker-compose logs -f ops-runner
```

### Check database

```bash
docker-compose exec ops-runner sh
sqlite3 /app/data/jobs.db "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 5;"
```

### Test SSH manually

```bash
docker-compose exec ops-runner sh
ssh -i /app/keys/aiops -o StrictHostKeyChecking=yes aiops@100.70.173.74 uptime
```
