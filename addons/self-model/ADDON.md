# Self Model Addon

## Name

`self-model`

## Purpose

Gives Gorky a live, local self-description source so setup/capability answers are grounded in this actual instance, not generic model behavior.

## What It Changes

- Adds read-only introspection script: `scripts/self-model-report.sh`
- Adds `gorky self` command to refresh the report
- Produces `store/self-model.md` (safe report with no secrets)

## Required Environment Variables

- `SELF_MODEL_ENABLED=true`
- Optional: `SELF_MODEL_REPORT_PATH=store/self-model.md`

## Install

```bash
gorky addon-install self-model
```

## Safety Notes

- Report is read-only.
- Secrets are never printed (no token/key values).
- Only high-level runtime/config facts are included.
