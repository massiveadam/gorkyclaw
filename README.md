<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="GorkyClaw" width="360">
</p>

# GorkyClaw

A private fork of [NanoClaw](https://github.com/gavrielc/nanoclaw) focused on:

- Telegram-first operation
- OpenRouter free-model routing by default
- approval-gated action execution
- simple onboarding and shared addon packs

## Fork Notice

This project is a fork of `gavrielc/nanoclaw`.

Core direction in this fork:

- replace WhatsApp-centric flow with Telegram as the primary interface
- keep runtime minimal and auditable
- keep secrets local (`.env`) and out of git
- support sharing features between friends via `addons/` and `skills/`

## Quick Start

```bash
git clone https://github.com/massiveadam/gorkyclaw.git
cd gorkyclaw
./scripts/onboard.sh
```

`onboard.sh` handles:

- `.env` creation/update
- Telegram bot token prompt
- Telegram admin chat id auto-detection (after `/start`)
- OpenRouter key prompt
- free-model defaults
- local secret generation
- optional build/start flow

## Daily Commands

After onboarding:

```bash
gorky                # start stack
gorky status         # health check
gorky restart        # restart everything
gorky logs           # tail service logs
gorky onboard        # rerun onboarding
gorky self           # regenerate runtime self-report
```

If `gorky` is not found:

```bash
~/.local/bin/gorky status
```

## Architecture (Current)

```text
Telegram -> NanoClaw core -> approval queue -> ops-runner -> target systems
                        \-> web research pipeline (free model rewrite)
```

Main components:

- `src/index.ts` - core orchestration
- `infra/apps/anthropic-proxy` - OpenRouter-compatible proxy
- `infra/apps/ops-runner` - approved action execution runner
- `scripts/onboard.sh` - onboarding
- `scripts/gorky` - operator CLI

## Free Model Policy

Default runtime is free-only.

Important `.env` values:

- `REQUIRE_FREE_MODELS=true`
- `REASONING_MODEL=google/gemma-3-27b-it:free`
- `COMPLETION_MODEL=google/gemma-3-27b-it:free`

## Addons and Skills

This fork supports two extension layers:

- `addons/` - installable feature packs with env templates/install hooks
- `skills/` - reusable skill content and templates

Commands:

```bash
gorky addons
gorky addon-install self-model
gorky addon-install image-to-text
gorky addon-install voice-to-text
gorky addon-install opencode-serve
```

Share features by committing addon/skill folders to git. Each user applies their own local `.env` values.

## Security Model

- approval-only execution path for mutating actions
- no secret values committed
- webhook signatures for runner dispatch
- isolated containers for proxy/runner

See:

- `docs/SECURITY.md`
- `docs/addons.md`
- `docs/quickstart.md`

## Troubleshooting

### Docker permission denied

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

### TypeScript command not found

```bash
NODE_ENV= npm install --include=dev
npm run build
```

### Telegram admin chat id missing

- Send `/start` to your bot in Telegram
- Rerun `./scripts/onboard.sh`

## Credits

- Original NanoClaw author: [`gavrielc`](https://github.com/gavrielc/nanoclaw)
- This fork: `massiveadam/gorkyclaw`

## License

MIT (same as upstream)
