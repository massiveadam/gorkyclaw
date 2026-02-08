import { NewMessage } from './types.js';

export function buildUserPrompt(messages: Pick<NewMessage, 'content'>[]): string {
  const parts = messages
    .map((m) => m.content.trim())
    .filter((text) => text.length > 0);

  return parts.join('\n\n').trim();
}
