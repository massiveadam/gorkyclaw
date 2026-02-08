import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWebhookSignature,
  isAllowedReadonlyCommand,
  isAllowedWebUrl,
} from '../src/approved-executor.js';

test('isAllowedReadonlyCommand allows safe diagnostics', () => {
  assert.equal(isAllowedReadonlyCommand('uptime'), true);
  assert.equal(isAllowedReadonlyCommand('docker ps'), true);
  assert.equal(isAllowedReadonlyCommand('systemctl status docker --no-pager'), true);
  assert.equal(isAllowedReadonlyCommand('ls -la /data/music'), true);
});

test('isAllowedReadonlyCommand blocks dangerous/meta command patterns', () => {
  assert.equal(isAllowedReadonlyCommand('rm -rf /'), false);
  assert.equal(isAllowedReadonlyCommand('uptime; whoami'), false);
  assert.equal(isAllowedReadonlyCommand('bash -i'), false);
});

test('isAllowedWebUrl allows public http/https and blocks local/private targets', () => {
  assert.equal(isAllowedWebUrl('https://example.com/docs'), true);
  assert.equal(isAllowedWebUrl('http://1.1.1.1/'), true);
  assert.equal(isAllowedWebUrl('http://localhost:3000'), false);
  assert.equal(isAllowedWebUrl('http://192.168.1.10/status'), false);
  assert.equal(isAllowedWebUrl('file:///etc/passwd'), false);
});

test('buildWebhookSignature is deterministic', () => {
  const signature = buildWebhookSignature(
    '1739059200000',
    '{"ok":true}',
    'topsecret',
  );
  assert.equal(
    signature,
    '4c9d53b363181ec66fd09bdc9a9d31e2f6a309d03c397c99aeaccf3a1d8854f4',
  );
});
