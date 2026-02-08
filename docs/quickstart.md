# Quickstart (Linux, Telegram, Free OpenRouter)

## 1. Clone

```bash
git clone https://github.com/gavrielc/nanoclaw.git
cd nanoclaw
```

## 2. Bootstrap

```bash
./scripts/bootstrap.sh
```

This installs dependencies, builds images, installs the systemd unit, and creates `.env` from `.env.example` if missing.

Alternative (recommended): interactive onboarding wizard

```bash
./scripts/onboard.sh
```

This prompts for Telegram/OpenRouter values, writes `.env`, generates local secrets, and can start everything.

## 3. Configure

Edit `.env` and set at minimum:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `OPENROUTER_API_KEY`
- `ANTHROPIC_API_KEY` (same as OpenRouter key for proxy path)

Use `config/profiles/free-telegram.env` as the default profile baseline.

## 4. Start services

```bash
docker rm -f openclaw-anthropic-proxy openclaw-runner 2>/dev/null || true
docker run -d --name openclaw-anthropic-proxy --restart unless-stopped --env-file .env -e PORT=3000 -p 3000:3000 openclaw-anthropic-proxy:latest
docker run -d --name openclaw-runner --restart unless-stopped --env-file .env -e PORT=8080 -p 8080:8080 -v "$HOME/.ssh:/app/keys:ro" -v "$PWD/infra/data:/app/data" nanoclaw-ops-runner:latest
sudo systemctl restart nanoclaw
```

## 5. Verify

```bash
./scripts/doctor.sh
```

Then send a test message to your Telegram bot.

## Single command

After bootstrap installs the CLI, use:

```bash
gorky
```

This is equivalent to `gorky start` and starts all services automatically.
