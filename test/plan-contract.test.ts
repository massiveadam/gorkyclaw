import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_PLAN,
  formatPlanBlock,
  parsePlanFromText,
  type Plan,
} from '../src/plan-contract.js';

test('ensure plan formatting helpers produce fenced block', () => {
  const plan: Plan = EMPTY_PLAN;
  const block = formatPlanBlock(plan);
  assert.ok(block.startsWith('```json'));
  assert.ok(block.includes('"actions": []'));
});

test('parsePlanFromText handles valid actions and schema description', () => {
  const raw = `Here is what I can do.\n\n` +
    '```json\n' +
    JSON.stringify(
      {
        actions: [
          {
            type: 'question',
            question: 'What OpenClaw version should I upgrade?',
          },
          {
            type: 'ssh',
            target: 'william',
            command: 'uname -a',
            requiresApproval: true,
            reason: 'Confirm kernel before upgrade',
          },
        ],
      },
      null,
      2,
    ) +
    '\n```';

  const result = parsePlanFromText(raw);
  assert.strictEqual(result.errors.length, 0);
  assert.ok(result.plan);
  assert.strictEqual(result.plan?.actions.length, 2);
});

test('parsePlanFromText validates web_fetch actions', () => {
  const raw = [
    '```json',
    JSON.stringify(
      {
        actions: [
          {
            type: 'web_fetch',
            url: 'https://example.com/releases',
            mode: 'browser',
            requiresApproval: true,
            reason: 'Collect latest release notes',
            extract: 'Summarize top 3 changes',
          },
        ],
      },
      null,
      2,
    ),
    '```',
  ].join('\n');

  const result = parsePlanFromText(raw);
  assert.ok(result.plan);
  assert.strictEqual(result.errors.length, 0);
  assert.deepStrictEqual(result.plan?.actions[0], {
    type: 'web_fetch',
    url: 'https://example.com/releases',
    mode: 'browser',
    requiresApproval: true,
    reason: 'Collect latest release notes',
    extract: 'Summarize top 3 changes',
  });
});

test('parsePlanFromText reports missing block', () => {
  const result = parsePlanFromText('No block here');
  assert.strictEqual(result.plan, null);
  assert.ok(result.errors[0].includes('Missing JSON plan block'));
});

test('parsePlanFromText accepts raw JSON plan without fences', () => {
  const result = parsePlanFromText('{"actions":[{"type":"reply"}]}');
  assert.ok(result.plan);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.plan?.actions.length, 1);
});

test('parsePlanFromText handles assistant metadata restatement before fenced plan', () => {
  const raw = [
    'User: adam',
    'Channel: Telegram',
    'Group: Ops Room',
    '',
    'I can help with that. Here is the plan:',
    '```json',
    '{"actions":[{"type":"reply"}]}',
    '```',
  ].join('\n');

  const result = parsePlanFromText(raw);
  assert.ok(result.plan);
  assert.strictEqual(result.errors.length, 0);
  assert.deepStrictEqual(result.plan, { actions: [{ type: 'reply' }] });
});

test('parsePlanFromText raw JSON fallback accepts json-prefixed output', () => {
  const result = parsePlanFromText(
    'json\n{"actions":[{"type":"question","question":"Should I restart now?"}]}',
  );

  assert.ok(result.plan);
  assert.strictEqual(result.errors.length, 0);
  assert.deepStrictEqual(result.plan, {
    actions: [{ type: 'question', question: 'Should I restart now?' }],
  });
});

test('parsePlanFromText accepts empty plan object as fallback to no actions', () => {
  const result = parsePlanFromText('```json\n{}\n```');

  assert.ok(result.plan);
  assert.strictEqual(result.errors.length, 0);
  assert.deepStrictEqual(result.plan, EMPTY_PLAN);
});
