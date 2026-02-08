/**
 * Ops Runner - HTTP Service
 * Executes approved actions via SSH with restricted keys
 */

import { createHmac } from 'crypto';
import { RunJobRequestSchema, type Action, type Job } from './types.js';
import { JobsDatabase } from './db.js';

// Environment configuration
const PORT = parseInt(process.env.PORT || '8080');
const SHARED_SECRET = process.env.OPS_RUNNER_SHARED_SECRET!;
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/app/keys/aiops';
const SSH_USER = process.env.SSH_USER || 'aiops';
const TARGET_WILLIAM_IP = process.env.TARGET_WILLIAM_IP || '100.70.173.74';
const TARGET_UBUNTU_IP = process.env.TARGET_UBUNTU_IP || '100.108.37.10';
const DEFAULT_TIMEOUT = parseInt(process.env.DEFAULT_TIMEOUT || '60');
const WEBHOOK_SECRET = process.env.OPS_RUNNER_WEBHOOK_SECRET || '';
const SSH_STRICT_HOST_KEY_CHECKING =
  process.env.SSH_STRICT_HOST_KEY_CHECKING || 'accept-new';

if (!SHARED_SECRET) {
  throw new Error('OPS_RUNNER_SHARED_SECRET required');
}

// Target IP mapping
const TARGET_IPS: Record<string, string> = {
  william: TARGET_WILLIAM_IP,
  'willy-ubuntu': TARGET_UBUNTU_IP,
};

// Initialize database
const db = new JobsDatabase();

// Validate SSH key exists
try {
  await Bun.file(SSH_KEY_PATH).stat();
  console.log(`✅ SSH key found: ${SSH_KEY_PATH}`);
} catch {
  console.error(`❌ SSH key not found: ${SSH_KEY_PATH}`);
  console.error("Generate with: ssh-keygen -t ed25519 -f keys/aiops -N ''");
  process.exit(1);
}

// ============================================================================
// HTTP Server
// ============================================================================

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Legacy run job endpoint
    if (url.pathname === '/run' && request.method === 'POST') {
      return handleRunJob(request);
    }

    // New dispatch endpoint (orchestrator -> runner)
    if (url.pathname === '/dispatch' && request.method === 'POST') {
      return handleDispatch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`🚀 Ops Runner listening on port ${PORT}`);
console.log(
  `   Targets: william (${TARGET_WILLIAM_IP}), willy-ubuntu (${TARGET_UBUNTU_IP})`,
);
console.log(`   SSH Key: ${SSH_KEY_PATH}`);
console.log(`   Webhook signing: ${WEBHOOK_SECRET ? 'enabled' : 'disabled'}`);

// ============================================================================
// Request Handlers
// ============================================================================

async function handleRunJob(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    // Validate request
    const parseResult = RunJobRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return jsonResponse(
        { success: false, error: 'Invalid request format' },
        400,
      );
    }

    const { jobId, sharedSecret } = parseResult.data;

    // Verify shared secret
    if (sharedSecret !== SHARED_SECRET) {
      console.error(`❌ Invalid shared secret for job ${jobId}`);
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    // Get job from database
    const job = db.getJob(jobId);
    if (!job) {
      return jsonResponse({ success: false, error: 'Job not found' }, 404);
    }

    // Verify job is approved
    if (job.status !== 'approved' && job.status !== 'executing') {
      return jsonResponse(
        {
          success: false,
          error: `Job status is ${job.status}, expected approved`,
        },
        400,
      );
    }

    console.log(`▶️ Executing job ${jobId}: ${job.plan.summary}`);

    // Execute actions
    const results = [];
    for (const action of job.plan.actions) {
      const result = await executeAction(action);
      results.push(result);

      // Stop on failure
      if (result.exitCode !== 0 && action.type === 'ssh') {
        console.error(`❌ Action failed with exit code ${result.exitCode}`);
        break;
      }
    }

    console.log(`✅ Job ${jobId} completed`);

    return jsonResponse({
      success: true,
      jobId,
      results,
    });
  } catch (error) {
    console.error('Error handling run job:', error);
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal error',
      },
      500,
    );
  }
}

interface DispatchRequest {
  event: 'approved_actions.dispatch';
  dispatchId: string;
  dispatchedAt: string;
  source: 'nanoclaw-core';
  actions: Array<{
    type: string;
    target?: string;
    command?: string;
    url?: string;
    mode?: 'http' | 'browser';
    extract?: string;
    timeout?: number;
    id?: string;
  }>;
}

function buildSignature(timestamp: string, payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

function verifyDispatchSignature(request: Request, body: string): boolean {
  if (!WEBHOOK_SECRET) return true;
  const ts = request.headers.get('x-nanoclaw-signature-ts') || '';
  const signature = request.headers.get('x-nanoclaw-signature') || '';
  if (!ts || !signature.startsWith('sha256=')) return false;
  const actual = signature.slice('sha256='.length);
  const expected = buildSignature(ts, body, WEBHOOK_SECRET);
  return actual === expected;
}

async function handleDispatch(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text();
    if (!verifyDispatchSignature(request, rawBody)) {
      return jsonResponse({ success: false, error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody) as DispatchRequest;
    if (
      body.event !== 'approved_actions.dispatch' ||
      !body.dispatchId ||
      !Array.isArray(body.actions)
    ) {
      return jsonResponse({ success: false, error: 'Invalid dispatch payload' }, 400);
    }

    console.log(`▶️ Dispatch ${body.dispatchId}: ${body.actions.length} action(s)`);

    const results: ExecutionResult[] = [];
    for (const action of body.actions) {
      if (action.type === 'ssh') {
        results.push(
          await executeSSHAction(
            action as Extract<Action, { type: 'ssh' }>,
            Date.now(),
            new Date().toISOString(),
          ),
        );
        continue;
      }

      if (action.type === 'web_fetch') {
        results.push(
          await executeWebFetchAction(
            action as DispatchWebFetchAction,
            Date.now(),
            new Date().toISOString(),
          ),
        );
        continue;
      }

      if (action.type !== 'ssh') {
        results.push({
          actionId: action.id || 'unknown',
          stdout: '',
          stderr: `Unsupported action type: ${action.type}`,
          exitCode: 1,
          executedAt: new Date().toISOString(),
          durationMs: 0,
        });
        continue;
      }
    }

    return jsonResponse({
      success: true,
      dispatchId: body.dispatchId,
      results,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal error',
      },
      500,
    );
  }
}

// ============================================================================
// Action Execution
// ============================================================================

interface ExecutionResult {
  actionId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  executedAt: string;
  durationMs: number;
}

interface DispatchWebFetchAction {
  id?: string;
  type: 'web_fetch';
  url?: string;
  mode?: 'http' | 'browser';
  extract?: string;
  timeout?: number;
}

const WEB_FETCH_ALLOWLIST = (process.env.WEB_FETCH_ALLOWLIST || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower === 'metadata.google.internal'
  );
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;
  const [a, b] = hostname.split('.').map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
}

function isAllowedWebUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === '169.254.169.254') return false;
  if (isPrivateHostname(host)) return false;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;

  if (WEB_FETCH_ALLOWLIST.length > 0) {
    const allowed = WEB_FETCH_ALLOWLIST.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!allowed) return false;
  }

  return true;
}

async function executeAction(action: Action): Promise<ExecutionResult> {
  const startTime = Date.now();
  const executedAt = new Date().toISOString();

  if (action.type === 'ssh') {
    return executeSSHAction(action, startTime, executedAt);
  }
  if (action.type === 'web_fetch') {
    return executeWebFetchAction(action, startTime, executedAt);
  }
  if (action.type === 'obsidian_write') {
    return executeObsidianAction(action, startTime, executedAt);
  }
  if (action.type === 'notify') {
    return executeNotifyAction(action, startTime, executedAt);
  }

  return {
    actionId: 'unknown',
    stdout: '',
    stderr: 'Unsupported action type',
    exitCode: 1,
    executedAt,
    durationMs: Date.now() - startTime,
  };
}

async function executeSSHAction(
  action: Extract<Action, { type: 'ssh' }>,
  startTime: number,
  executedAt: string,
): Promise<ExecutionResult> {
  if (!action.target) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'SSH action missing target',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  const targetIp = TARGET_IPS[action.target];
  if (!targetIp) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: `Unknown target: ${action.target}`,
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  const timeout = action.timeout || DEFAULT_TIMEOUT;

  try {
    console.log(`  🔹 SSH ${action.target}: ${action.command}`);

    // Build SSH command with restricted options
    const sshCmd = [
      'ssh',
      '-i',
      SSH_KEY_PATH,
      '-o',
      `StrictHostKeyChecking=${SSH_STRICT_HOST_KEY_CHECKING}`,
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=5',
      '-o',
      'ServerAliveCountMax=3',
      '-T', // No pseudo-terminal
      '-n', // No stdin
      `${SSH_USER}@${targetIp}`,
      action.command,
    ];

    // Execute with timeout using Bun's shell
    const proc = Bun.spawn(sshCmd, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeout * 1000);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    clearTimeout(timeoutId);

    return {
      actionId: action.id || 'unknown',
      stdout: stdout.slice(0, 100000), // Limit output size
      stderr: stderr.slice(0, 10000),
      exitCode,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: error instanceof Error ? error.message : 'SSH execution failed',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }
}

async function executeWebFetchAction(
  action: DispatchWebFetchAction,
  startTime: number,
  executedAt: string,
): Promise<ExecutionResult> {
  const url = (action.url || '').trim();
  const mode = action.mode === 'browser' ? 'browser' : 'http';
  const timeoutMs = (action.timeout || DEFAULT_TIMEOUT) * 1000;

  if (!url) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'web_fetch action missing url',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  if (!isAllowedWebUrl(url)) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'URL blocked by web fetch safety policy',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    if (mode === 'browser') {
      const browserText = await executeBrowserFetch(url, timeoutMs);
      return {
        actionId: action.id || 'unknown',
        stdout: browserText,
        stderr: '',
        exitCode: 0,
        executedAt,
        durationMs: Date.now() - startTime,
      };
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: {
        'user-agent': 'nanoclaw-ops-runner/1.0',
      },
    });
    const body = (await response.text()).slice(0, 12000);
    const stdout = [
      `url=${url}`,
      `status=${response.status}`,
      `contentType=${response.headers.get('content-type') || 'unknown'}`,
      '',
      body,
      action.extract ? `\n\nextract_hint=${action.extract}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      actionId: action.id || 'unknown',
      stdout,
      stderr: '',
      exitCode: response.ok ? 0 : 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: error instanceof Error ? error.message : 'Web fetch failed',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }
}

async function executeBrowserFetch(url: string, timeoutMs: number): Promise<string> {
  try {
    const dynamicImport = new Function(
      'moduleName',
      'return import(moduleName);',
    ) as (moduleName: string) => Promise<any>;
    const playwright = await dynamicImport('playwright');
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const title = await page.title();
      const text = await page.evaluate(() => document.body?.innerText || '');
      return [`url=${url}`, `title=${title}`, '', text.slice(0, 12000)].join('\n');
    } finally {
      await browser.close();
    }
  } catch {
    // Fallback: readable mirror mode when Playwright is unavailable.
    const mirrorUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
    const resp = await fetch(mirrorUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'nanoclaw-ops-runner/1.0',
      },
    });
    if (!resp.ok) {
      throw new Error(
        'Browser fetch failed and readable mirror fallback was unavailable.',
      );
    }
    const text = (await resp.text()).slice(0, 12000);
    return [`url=${url}`, `mode=browser-fallback`, '', text].join('\n');
  }
}

async function executeObsidianAction(
  action: Extract<Action, { type: 'obsidian_write' }>,
  startTime: number,
  executedAt: string,
): Promise<ExecutionResult> {
  // Obsidian writes are handled by the gateway
  // This is a placeholder for future Obsidian API integration
  return {
    actionId: action.id || 'unknown',
    stdout: 'Obsidian write handled by gateway',
    stderr: '',
    exitCode: 0,
    executedAt,
    durationMs: Date.now() - startTime,
  };
}

async function executeNotifyAction(
  action: Extract<Action, { type: 'notify' }>,
  startTime: number,
  executedAt: string,
): Promise<ExecutionResult> {
  // Notifications are handled by the gateway
  return {
    actionId: action.id || 'unknown',
    stdout: `Notification: ${action.message}`,
    stderr: '',
    exitCode: 0,
    executedAt,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  server.stop();
  db.close();
});

process.once('SIGTERM', () => {
  server.stop();
  db.close();
});
