# Basic Addon Template

## Name

`basic-addon`

## Purpose

Describe the capability this addon introduces.

## What It Changes

- List files/scripts/services touched by the addon.

## Required Environment Variables

- Add variable names here. Put defaults/placeholders in `env.example`.

## Install

```bash
./scripts/addon-install.sh basic-addon
```

## Safety Notes

- Keep scripts idempotent.
- Do not embed secrets.
- Prefer approval-gated actions for mutating operations.
