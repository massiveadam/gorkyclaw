import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { validateAddonDir } from '../scripts/addon-validate.js';

function makeTempAddon(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-addon-'));
  const addonDir = path.join(root, name);
  fs.mkdirSync(addonDir);
  return { root, addonDir };
}

function writeAddonMd(addonDir: string, name: string, options?: { omitSafety?: boolean }) {
  const safetySection = options?.omitSafety
    ? ''
    : '## Safety Notes\n\n- Keep scripts idempotent.\n\n';
  const content = `# ${name} Addon

## Name

\`${name}\`

## Purpose

Provides a test capability.

## What It Changes

- Touches sample files.

## Required Environment Variables

- \`TEST_FLAG\`

## Install

\`\`\`bash
gorky addon-install ${name}
\`\`\`

${safetySection}`.trim();
  fs.writeFileSync(path.join(addonDir, 'ADDON.md'), content);
}

function writeAddonManifest(addonDir: string, name: string, options?: { omitField?: string }) {
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    name,
    title: 'Test Addon',
    description: 'Provides a test capability for validation.',
    type: 'capability',
    version: '1.0.0',
    requiresApprovalByDefault: true,
    entrypoints: {
      install: 'install.sh',
      docs: 'ADDON.md',
      envExample: 'env.example',
    },
    env: [{ key: 'TEST_FLAG', required: false }],
  };
  if (options?.omitField) {
    delete manifest[options.omitField];
  }
  fs.writeFileSync(path.join(addonDir, 'addon.json'), JSON.stringify(manifest, null, 2));
}

test('validateAddonDir accepts a well-formed addon', () => {
  const { root, addonDir } = makeTempAddon('valid-addon');
  try {
    writeAddonMd(addonDir, 'valid-addon');
    writeAddonManifest(addonDir, 'valid-addon');
    fs.writeFileSync(path.join(addonDir, 'env.example'), 'TEST_FLAG=\n');
    fs.writeFileSync(path.join(addonDir, 'install.sh'), '#!/usr/bin/env bash\necho ok\n');
    const result = validateAddonDir(addonDir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateAddonDir rejects missing required sections', () => {
  const { root, addonDir } = makeTempAddon('missing-section');
  try {
    writeAddonMd(addonDir, 'missing-section', { omitSafety: true });
    writeAddonManifest(addonDir, 'missing-section');
    fs.writeFileSync(path.join(addonDir, 'env.example'), 'TEST_FLAG=\n');
    fs.writeFileSync(path.join(addonDir, 'install.sh'), '#!/usr/bin/env bash\necho ok\n');
    const result = validateAddonDir(addonDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('Safety Notes')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateAddonDir rejects invalid env.example keys', () => {
  const { root, addonDir } = makeTempAddon('bad-env');
  try {
    writeAddonMd(addonDir, 'bad-env');
    writeAddonManifest(addonDir, 'bad-env');
    fs.writeFileSync(path.join(addonDir, 'env.example'), 'bad key=\n');
    fs.writeFileSync(path.join(addonDir, 'install.sh'), '#!/usr/bin/env bash\necho ok\n');
    const result = validateAddonDir(addonDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('env.example')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateAddonDir rejects missing addon.json fields', () => {
  const { root, addonDir } = makeTempAddon('missing-manifest-field');
  try {
    writeAddonMd(addonDir, 'missing-manifest-field');
    writeAddonManifest(addonDir, 'missing-manifest-field', { omitField: 'version' });
    fs.writeFileSync(path.join(addonDir, 'env.example'), 'TEST_FLAG=\n');
    fs.writeFileSync(path.join(addonDir, 'install.sh'), '#!/usr/bin/env bash\necho ok\n');
    const result = validateAddonDir(addonDir);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('missing required field: version')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
