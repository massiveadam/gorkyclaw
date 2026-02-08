import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUserPrompt } from '../src/prompt.js';

test('buildUserPrompt joins message content without metadata', () => {
  const prompt = buildUserPrompt([
    { content: 'Hello is this working well now?' },
    { content: "I'm looking to upgrade my current openclaw install" },
  ]);

  assert.equal(
    prompt,
    'Hello is this working well now?\n\nI\'m looking to upgrade my current openclaw install',
  );
});

test('buildUserPrompt handles realistic Telegram-style grouped conversation', () => {
  const prompt = buildUserPrompt([
    { content: '  @assistant can you check the deploy status?  ' },
    { content: '' },
    { content: '\nThe bot restarted at 03:14 UTC.\nStill seeing timeout spikes.\n' },
    { content: 'Please suggest next steps before we page SRE.' },
  ]);

  assert.equal(
    prompt,
    '@assistant can you check the deploy status?\n\nThe bot restarted at 03:14 UTC.\nStill seeing timeout spikes.\n\nPlease suggest next steps before we page SRE.',
  );
});
