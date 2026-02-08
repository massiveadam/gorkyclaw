# Addon Formula (Share Features Safely)

Use addons for feature sharing between your instance and your friend's instance.

## Addon contract

Create `addons/<feature-name>/` with:

- `ADDON.md` (required): what it does + safety notes
- `env.example` (optional): required env vars as placeholders
- `install.sh` (optional): idempotent install steps

## Install an addon

```bash
gorky addons
gorky addon-install <feature-name>
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

- `image-to-text`
- `voice-to-text`
- `opencode-serve`
