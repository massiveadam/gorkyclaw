# Image To Text Addon

## Name

`image-to-text`

## Purpose

Adds OCR capability so Gorky can extract text from screenshots/photos after approval.

## What It Changes

- Introduces OCR runner hooks (Tesseract/vision API based, implementation-specific).
- Adds env placeholders for OCR provider keys and limits.

## Required Environment Variables

- `OCR_PROVIDER` (`local_tesseract` or `openrouter_vision`)
- `OCR_MAX_IMAGE_MB`
- Optional: `OCR_API_KEY` (only when provider requires it)

## Install

```bash
gorky addon-install image-to-text
```

## Safety Notes

- Keep image retention disabled by default.
- Strip EXIF metadata where possible.
- Treat OCR output as untrusted text.
