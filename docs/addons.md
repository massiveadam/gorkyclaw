# Addon Formula (Share Features Safely)

Use addons for feature sharing between your instance and your friend's instance.

## Addon contract

Create `addons/<feature-name>/` with:

- `addon.json` (required): machine-readable manifest + entrypoints
- `ADDON.md` (required): what it does + safety notes
- `env.example` (optional): required env vars as placeholders
- `install.sh` (optional): idempotent install steps
- `run.sh` (optional): executable addon hook for approved `addon_run` actions

## Install an addon

```bash
gorky addons
gorky addon-install <feature-name>
gorky addon-run <feature-name> "<input>"
```

## Export / import addon packs

```bash
gorky export-addons my-addons.tgz
gorky import-addons my-addons.tgz
```

Installer behavior:

- ensures `.env` exists
- appends missing env keys from addon `env.example`
- runs addon `install.sh` if present

## Share with your friend

1. Commit addon folder to git.
2. Friend pulls repo.
3. Friend runs `gorky addon-install <feature-name>`.
4. Friend sets their own env values in `.env`.

This keeps feature logic shared while secrets stay local.

## Starter packs included

- `self-model`
- `image-to-text`
- `voice-to-text`
- `opencode-serve`
- `squid-music-downloader`

## Local OpenCode runner (VM)

Use local helper commands:

```bash
gorky opencode-start
gorky opencode-status
gorky opencode-stop
```

Set `OPENCODE_TASK_COMMAND_TEMPLATE` in `.env` to match your local CLI invocation.
