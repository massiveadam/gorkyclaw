# OpenCode Serve Addon

## Name

`opencode-serve`

## Purpose

Connects Gorky to an OpenCode `/serve` endpoint for code tasks while keeping approval-only execution.

## What It Changes

- Adds endpoint/env wiring for OpenCode serve dispatch.
- Keeps mutating tasks approval-gated through existing action queue.

## Required Environment Variables

- `OPENCODE_SERVE_URL` (e.g. `http://127.0.0.1:8765`)
- `OPENCODE_SERVE_TOKEN`
- `OPENCODE_DEFAULT_WORKDIR`
- `OPENCODE_TIMEOUT_MS`

## Install

```bash
gorky addon-install opencode-serve
```

## Safety Notes

- Route only approved tasks to serve endpoint.
- Keep per-target allowlists in place.
- Never store serve token in git.
