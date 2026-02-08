# Voice To Text Addon

## Name

`voice-to-text`

## Purpose

Adds speech transcription so Gorky can process voice notes into text commands.

## What It Changes

- Adds transcription pipeline hooks in runner/gateway.
- Adds env placeholders for transcription backend and language defaults.

## Required Environment Variables

- `STT_PROVIDER` (`whisper_local` or `openrouter_audio`)
- `STT_DEFAULT_LANGUAGE` (e.g. `en`)
- `STT_MAX_AUDIO_MINUTES`
- Optional: `STT_API_KEY`

## Install

```bash
gorky addon-install voice-to-text
```

## Safety Notes

- Keep approval gates for any action suggested from transcript.
- Keep raw audio retention off by default.
