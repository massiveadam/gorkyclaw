# Agent Config Snippet (Claude Agent SDK via OpenRouter Proxy)

```bash
# Point Claude Agent SDK to an Anthropic-compatible proxy backed by OpenRouter
export ANTHROPIC_BASE_URL="http://anthropic-proxy:3000"
export ANTHROPIC_API_KEY="<your-openrouter-key>"
export REQUIRE_FREE_MODELS="true"
export COMPLETION_MODEL="google/gemma-3-27b-it:free"
export REASONING_MODEL="google/gemma-3-27b-it:free"
```

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const stream = query({
  prompt: "<user message>",
  options: {
    systemPrompt: { type: "preset", preset: "claude_code" },
    tools: { type: "preset", preset: "claude_code" },
    settingSources: ["project"],
    permissionMode: "default",
  },
});
```

```md
# CLAUDE.md (excerpt)
You are the assistant speaking directly to the user.
Never say "I received the message" or restate sender/time metadata unless asked.
After every reply, output a fenced JSON plan block:
```json
{
  "actions": [
    {
      "type": "web_fetch",
      "url": "https://example.com",
      "mode": "http",
      "requiresApproval": true,
      "reason": "Fetch release notes"
    }
  ]
}
```
```

Note: Claude Code presets do not expose explicit temperature/top_p settings. If you use a direct OpenRouter runner instead of Claude Code, set `temperature: 0.2` and `top_p: 1.0` in the request.
