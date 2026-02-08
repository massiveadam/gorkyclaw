# Squid Music Downloader Addon

## Name

`squid-music-downloader`

Manifest: `addon.json`

## Purpose

Run a safe album download workflow from a query string, copy staged files to your server music folder, and trigger a beets import command.

## What It Changes

- Adds runtime hook `run.sh` for approval-gated execution via `gorky addon-run`.
- Adds env contract for source endpoint, download command, transfer target, and import command.
- Defaults to dry-run mode until explicitly enabled.

## Required Environment Variables

- `SQUID_ENABLE_EXECUTION` (`false` by default, set `true` only after review)
- `SQUID_DOWNLOAD_COMMAND_TEMPLATE` command template including `{query}` placeholder
- `SQUID_TARGET_HOST` and `SQUID_TARGET_PATH`
- `SQUID_IMPORT_COMMAND`
- Optional SSH overrides: `SQUID_SSH_USER`, `SQUID_SSH_KEY_PATH`, `SQUID_CONNECT_TIMEOUT`

## Install

```bash
gorky addon-install squid-music-downloader
```

## Run

```bash
gorky addon-run squid-music-downloader "album title query"
```

## Safety Notes

- Dry-run by default (`SQUID_ENABLE_EXECUTION=false`).
- Never deletes existing music files.
- Requires explicit approval when executed through action proposals.
- Uses retries for transient download failures.
