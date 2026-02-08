# Addons

Addons are portable feature packs you can share between NanoClaw instances.

Each addon lives in `addons/<name>/` and may include:

- `ADDON.md` (required): purpose, behavior, safety notes, and required env vars
- `env.example` (optional): addon-specific env vars
- `install.sh` (optional): idempotent install/patch script
- `uninstall.sh` (optional): rollback script

Use:

```bash
./scripts/addon-list.sh
./scripts/addon-install.sh <addon-name>
```

Keep secrets out of addon files. Put only variable names in `env.example`.
