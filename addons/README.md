# Addons

Addons are portable feature packs you can share between NanoClaw instances.

Each addon lives in `addons/<name>/` and may include:

- `addon.json` (required): machine-readable manifest (name/version/type/entrypoints/env)
- `ADDON.md` (required): human docs (purpose, behavior, safety notes)
- `env.example` (optional): addon-specific env vars
- `install.sh` (optional): idempotent install/patch script
- `run.sh` (optional): runtime hook callable via `gorky addon-run <name> "<input>"`
- `uninstall.sh` (optional): rollback script

Use:

```bash
./scripts/addon-list.sh
./scripts/addon-install.sh <addon-name>
./scripts/addon-run.sh <addon-name> "<input>"
```

Keep secrets out of addon files. Put only variable names in `env.example`.
