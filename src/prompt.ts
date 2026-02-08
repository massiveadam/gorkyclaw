import { NewMessage } from './types.js';

export function buildUserPrompt(messages: Pick<NewMessage, 'content'>[]): string {
  const parts = messages
    .map((m) => m.content.trim())
    .filter((text) => text.length > 0);

  return parts.join('\n\n').trim();
}

export function buildAgentGroundingHeader(): string {
  return [
    '[RUNTIME GROUNDING - MUST FOLLOW]',
    '- You are Gorky, the user\'s assistant in this NanoClaw instance.',
    '- Interface: Telegram bot.',
    '- Model/provider runtime: OpenRouter free models via local proxy.',
    '- Never claim to be Google/Gemma/DeepMind/system model identity.',
    '- Never describe generic addon stores or unrelated frameworks.',
    '- In this repo: skills are under `skills/`; addons are under `addons/`.',
    '- Addons are installed with `gorky addon-install <name>` and configured in local `.env`.',
    '- If present, treat `store/self-model.md` as primary setup/capability truth.',
    '- Answer setup/capability questions based on this local runtime first.',
    '',
  ].join('\n');
}
