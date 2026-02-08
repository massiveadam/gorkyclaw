#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const logDir = path.join(process.cwd(), 'groups', 'main', 'logs');
if (!fs.existsSync(logDir)) {
  console.error('Log directory not found:', logDir);
  process.exit(1);
}

const logs = fs
  .readdirSync(logDir)
  .filter((entry) => entry.endsWith('.log'))
  .map((entry) => ({
    entry,
    mtime: fs.statSync(path.join(logDir, entry)).mtimeMs,
  }))
  .sort((a, b) => b.mtime - a.mtime);

if (logs.length === 0) {
  console.error('No log files found in', logDir);
  process.exit(1);
}

const latestLog = path.join(logDir, logs[0].entry);
const lines = fs.readFileSync(latestLog, 'utf8').split(/\r?\n/);
const promptIndex = lines.findIndex((line) => line === 'Prompt:');

if (promptIndex === -1) {
  console.error('Prompt section not found in', latestLog);
  process.exit(1);
}

let endIndex = lines
  .slice(promptIndex + 1)
  .findIndex((line) => line.trim() === '');
endIndex =
  endIndex === -1 ? lines.length : promptIndex + 1 + endIndex;

const prompt = lines.slice(promptIndex + 1, endIndex).join('\n');
if (prompt.trim().length === 0) {
  console.error('Extracted prompt is empty');
  process.exit(1);
}

const payload = JSON.stringify({
  prompt,
  groupFolder: 'main',
  chatJid: 'test@g.us',
  isMain: false,
});

const docker = spawnSync('docker', ['run', '--rm', '-i', 'nanoclaw-agent:latest'], {
  input: payload,
  stdio: 'inherit',
});

process.exit(docker.status === null ? 1 : docker.status);
