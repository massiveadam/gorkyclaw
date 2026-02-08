#!/usr/bin/env node
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = parseInt(process.env.OPENCODE_LOCAL_PORT || '8765', 10);
const TOKEN = process.env.OPENCODE_SERVE_TOKEN || '';
const DEFAULT_CWD = process.env.OPENCODE_DEFAULT_WORKDIR || process.cwd();
const TIMEOUT_MS = parseInt(process.env.OPENCODE_TIMEOUT_MS || '21600000', 10); // 6h
const MAX_OUTPUT = parseInt(process.env.OPENCODE_MAX_OUTPUT || '200000', 10);
const CMD_TEMPLATE = process.env.OPENCODE_TASK_COMMAND_TEMPLATE || 'opencode "{task}"';

function json(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 1_000_000) {
        reject(new Error('Request too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function escapeShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildCommand(task) {
  const replacement = escapeShell(task);
  if (CMD_TEMPLATE.includes('{task}')) {
    return CMD_TEMPLATE.replaceAll('{task}', replacement);
  }
  return `${CMD_TEMPLATE} ${replacement}`;
}

function authOk(req) {
  if (!TOKEN) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${TOKEN}`;
}

async function runTask(task, cwd) {
  const command = buildCommand(task);
  const startedAt = Date.now();
  const child = spawn('bash', ['-lc', command], {
    cwd: cwd || DEFAULT_CWD,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8');
  });

  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000);
  }, TIMEOUT_MS);

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
  clearTimeout(timeout);

  return {
    ok: exitCode === 0,
    exitCode,
    durationMs: Date.now() - startedAt,
    stdout: stdout.slice(0, MAX_OUTPUT),
    stderr: stderr.slice(0, MAX_OUTPUT),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { status: 'ok', port: PORT });
  }

  if (req.method === 'POST' && req.url === '/run') {
    if (!authOk(req)) return json(res, 401, { ok: false, error: 'Unauthorized' });
    try {
      const body = await readJson(req);
      const task = String(body.task || '').trim();
      const cwd = body.cwd ? String(body.cwd).trim() : DEFAULT_CWD;
      if (!task) return json(res, 400, { ok: false, error: 'Missing task' });
      const result = await runTask(task, cwd);
      return json(res, result.ok ? 200 : 500, result);
    } catch (err) {
      return json(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenCode local runner listening on http://0.0.0.0:${PORT}`);
  console.log(`Command template: ${CMD_TEMPLATE}`);
  console.log(`Default cwd: ${DEFAULT_CWD}`);
});
