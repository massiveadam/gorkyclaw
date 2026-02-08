import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildObsidianMemoryHeader } from '../src/obsidian-memory.js';

test('buildObsidianMemoryHeader returns relevant snippets from vault', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-memory-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const memoryDir = path.join(root, 'Memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  const relevant = path.join(memoryDir, 'openclaw-upgrade.md');
  const irrelevant = path.join(memoryDir, 'shopping-list.md');

  fs.writeFileSync(
    relevant,
    'OpenClaw upgrade checklist: backup config, verify plugins, run migration steps.',
    'utf-8',
  );
  fs.writeFileSync(
    irrelevant,
    'Buy eggs, milk, and bread this weekend.',
    'utf-8',
  );

  const header = buildObsidianMemoryHeader({
    vaultPath: root,
    memoryDirs: ['Memory'],
    query: 'I want to upgrade OpenClaw safely',
    maxSnippets: 2,
    maxChars: 140,
  });

  assert.ok(header.includes('Memory Context'));
  assert.ok(header.includes('openclaw-upgrade.md'));
  assert.ok(!header.includes('shopping-list.md'));
});

test('buildObsidianMemoryHeader ignores memory dirs outside vault', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-memory-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const insideDir = path.join(root, 'Memory');
  fs.mkdirSync(insideDir, { recursive: true });
  fs.writeFileSync(
    path.join(insideDir, 'inside.md'),
    'Safe note about OpenClaw upgrade plans.',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(outside, 'outside.md'),
    'Outside vault note about OpenClaw upgrade plans.',
    'utf-8',
  );

  const header = buildObsidianMemoryHeader({
    vaultPath: root,
    memoryDirs: ['Memory', `../${path.basename(outside)}`],
    query: 'openclaw upgrade',
    maxSnippets: 5,
    maxChars: 200,
  });

  assert.ok(header.includes('inside.md'));
  assert.ok(!header.includes('outside.md'));
});

test('buildObsidianMemoryHeader skips oversized markdown files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-memory-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const memoryDir = path.join(root, 'Memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  const hugePath = path.join(memoryDir, 'huge.md');
  const hugeBody = `${'x'.repeat(1024 * 1024 + 10)} openclaw`;
  fs.writeFileSync(hugePath, hugeBody, 'utf-8');

  const header = buildObsidianMemoryHeader({
    vaultPath: root,
    memoryDirs: ['Memory'],
    query: 'openclaw',
    maxSnippets: 3,
    maxChars: 120,
  });

  assert.equal(header, '');
});

test('buildObsidianMemoryHeader skips binary-like markdown files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-memory-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const memoryDir = path.join(root, 'Memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  const binaryPath = path.join(memoryDir, 'binary.md');
  fs.writeFileSync(binaryPath, Buffer.from([0x6f, 0x70, 0x65, 0x00, 0x6e, 0x63, 0x6c, 0x61, 0x77]));

  const header = buildObsidianMemoryHeader({
    vaultPath: root,
    memoryDirs: ['Memory'],
    query: 'openclaw',
    maxSnippets: 3,
    maxChars: 120,
  });

  assert.equal(header, '');
});

test('buildObsidianMemoryHeader uses deterministic ordering for equal scores', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-memory-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const memoryDir = path.join(root, 'Memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  const alpha = path.join(memoryDir, 'alpha.md');
  const beta = path.join(memoryDir, 'beta.md');
  const body = 'Project migration notes and rollout checklist.';
  fs.writeFileSync(alpha, body, 'utf-8');
  fs.writeFileSync(beta, body, 'utf-8');

  const fixedTime = new Date('2026-01-01T12:00:00.000Z');
  fs.utimesSync(alpha, fixedTime, fixedTime);
  fs.utimesSync(beta, fixedTime, fixedTime);

  const header = buildObsidianMemoryHeader({
    vaultPath: root,
    memoryDirs: ['Memory'],
    query: 'migration rollout checklist',
    maxSnippets: 2,
    maxChars: 120,
  });

  const lines = header
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.split(':', 1)[0]);

  assert.deepEqual(lines, ['- Memory/alpha.md', '- Memory/beta.md']);
});
