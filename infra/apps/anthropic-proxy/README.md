# Anthropic-Compatible Proxy (OpenRouter)

This service is a local Anthropic-compatible proxy for NanoClaw. It forwards:
- `POST /v1/messages`
- `POST /v1/messages/count_tokens`

to OpenRouter `POST /messages`, and force-sets model selection from env.

## Environment
- `OPENROUTER_API_KEY`: OpenRouter API key.
- `REASONING_MODEL`: OpenRouter model id for reasoning (recommended `google/gemma-3-27b-it:free`).
- `COMPLETION_MODEL`: OpenRouter model id for completion (recommended `google/gemma-3-27b-it:free`).
- `PORT`: Port to bind (default 3000).
- `OPENROUTER_BASE_URL`: Defaults to `https://openrouter.ai/api/v1`.
- `REQUIRE_FREE_MODELS`: Defaults to `true`; if enabled, non-`/free` models are rejected and replaced with `openrouter/free`.

## Usage
- The proxy is available at `http://anthropic-proxy:3000`.
- Set `ANTHROPIC_BASE_URL` to that URL in NanoClaw.
