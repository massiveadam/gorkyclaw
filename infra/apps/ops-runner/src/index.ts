/**
 * Ops Runner - HTTP Service
 * Executes approved actions via SSH with restricted keys
 */

import { createHmac, randomUUID } from 'crypto';
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
const IMAGE_TO_TEXT_URL = process.env.IMAGE_TO_TEXT_URL || '';
const IMAGE_TO_TEXT_TOKEN = process.env.IMAGE_TO_TEXT_TOKEN || '';
const VOICE_TO_TEXT_URL = process.env.VOICE_TO_TEXT_URL || '';
const VOICE_TO_TEXT_TOKEN = process.env.VOICE_TO_TEXT_TOKEN || '';
const OPENCODE_SERVE_URL = process.env.OPENCODE_SERVE_URL || '';
const OPENCODE_SERVE_TOKEN = process.env.OPENCODE_SERVE_TOKEN || '';
const DISPATCH_MAX_PARALLEL = parseInt(
  process.env.DISPATCH_MAX_PARALLEL || '4',
);

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
const backgroundRunAbortControllers = new Map<string, AbortController>();

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

    if (url.pathname === '/runs' && request.method === 'GET') {
      return handleListRuns(request);
    }

    const runMatch = url.pathname.match(/^\/runs\/([A-Za-z0-9-]+)$/);
    if (runMatch && request.method === 'GET') {
      return handleGetRun(request, runMatch[1]);
    }

    const cancelMatch = url.pathname.match(/^\/runs\/([A-Za-z0-9-]+)\/cancel$/);
    if (cancelMatch && request.method === 'POST') {
      return handleCancelRun(request, cancelMatch[1]);
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
    imageUrl?: string;
    audioUrl?: string;
    task?: string;
    cwd?: string;
    prompt?: string;
    language?: string;
    mode?: 'http' | 'browser';
    extract?: string;
    timeout?: number;
    executionMode?: 'foreground' | 'background';
    parallelGroup?: string;
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

function verifyRunnerApiSecret(request: Request): boolean {
  const secret = request.headers.get('x-ops-runner-secret') || '';
  return Boolean(secret) && secret === SHARED_SECRET;
}

function runRowToApi(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    actionType: String(row.action_type),
    status: String(row.status),
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    summary: row.summary ? String(row.summary) : null,
    result: row.result_text ? String(row.result_text) : null,
    error: row.error_text ? String(row.error_text) : null,
    cancelRequested: Boolean(row.cancel_requested),
  };
}

async function handleListRuns(request: Request): Promise<Response> {
  if (!verifyRunnerApiSecret(request)) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  const limit = Math.max(
    1,
    Math.min(100, parseInt(new URL(request.url).searchParams.get('limit') || '20', 10) || 20),
  );
  const runs = db.listRuns(limit).map(runRowToApi);
  return jsonResponse({ success: true, runs });
}

async function handleGetRun(request: Request, runId: string): Promise<Response> {
  if (!verifyRunnerApiSecret(request)) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  const run = db.getRun(runId);
  if (!run) return jsonResponse({ success: false, error: 'Run not found' }, 404);
  return jsonResponse({ success: true, run: runRowToApi(run) });
}

async function handleCancelRun(request: Request, runId: string): Promise<Response> {
  if (!verifyRunnerApiSecret(request)) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  const existing = db.getRun(runId);
  if (!existing) return jsonResponse({ success: false, error: 'Run not found' }, 404);
  db.updateRun(runId, { cancelRequested: true });
  const controller = backgroundRunAbortControllers.get(runId);
  if (controller) {
    controller.abort();
    db.updateRun(runId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
      errorText: 'Cancelled by operator request.',
    });
    backgroundRunAbortControllers.delete(runId);
  }
  return jsonResponse({ success: true, runId, cancelled: Boolean(controller) });
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

    const results = await executeDispatchActions(body.actions);

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

async function executeDispatchActions(actions: DispatchRequest['actions']): Promise<ExecutionResult[]> {
  const indexed = actions.map((action, index) => ({ action, index }));
  const results: ExecutionResult[] = new Array(actions.length);

  // Default behavior remains serial; only actions with parallelGroup run concurrently.
  const serial = indexed.filter(({ action }) => !action.parallelGroup);
  for (const { action, index } of serial) {
    results[index] = await executeDispatchAction(action);
  }

  const groupedMap = new Map<string, Array<{ action: DispatchRequest['actions'][number]; index: number }>>();
  for (const item of indexed) {
    if (!item.action.parallelGroup) continue;
    const key = item.action.parallelGroup;
    const list = groupedMap.get(key) || [];
    list.push(item);
    groupedMap.set(key, list);
  }

  const grouped = [...groupedMap.values()].flat();
  if (grouped.length > 0) {
    let cursor = 0;
    while (cursor < grouped.length) {
      const batch = grouped.slice(cursor, cursor + Math.max(1, DISPATCH_MAX_PARALLEL));
      const batchResults = await Promise.all(
        batch.map(({ action }) => executeDispatchAction(action)),
      );
      batch.forEach((item, idx) => {
        results[item.index] = batchResults[idx];
      });
      cursor += Math.max(1, DISPATCH_MAX_PARALLEL);
    }
  }

  return results;
}

async function executeDispatchAction(
  action: DispatchRequest['actions'][number],
): Promise<ExecutionResult> {
  if (action.type === 'ssh') {
    return executeSSHAction(
      action as Extract<Action, { type: 'ssh' }>,
      Date.now(),
      new Date().toISOString(),
    );
  }
  if (action.type === 'web_fetch') {
    return executeWebFetchAction(
      action as DispatchWebFetchAction,
      Date.now(),
      new Date().toISOString(),
    );
  }
  if (action.type === 'image_to_text') {
    return executeImageToTextAction(
      action as DispatchImageToTextAction,
      Date.now(),
      new Date().toISOString(),
    );
  }
  if (action.type === 'voice_to_text') {
    return executeVoiceToTextAction(
      action as DispatchVoiceToTextAction,
      Date.now(),
      new Date().toISOString(),
    );
  }
  if (action.type === 'opencode_serve') {
    return executeOpencodeServeAction(
      action as DispatchOpencodeServeAction,
      Date.now(),
      new Date().toISOString(),
    );
  }
  return {
    actionId: action.id || 'unknown',
    stdout: '',
    stderr: `Unsupported action type: ${action.type}`,
    exitCode: 1,
    executedAt: new Date().toISOString(),
    durationMs: 0,
  };
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

interface DispatchImageToTextAction {
  id?: string;
  type: 'image_to_text';
  imageUrl?: string;
  prompt?: string;
  timeout?: number;
}

interface DispatchVoiceToTextAction {
  id?: string;
  type: 'voice_to_text';
  audioUrl?: string;
  language?: string;
  timeout?: number;
}

interface DispatchOpencodeServeAction {
  id?: string;
  type: 'opencode_serve';
  task?: string;
  cwd?: string;
  timeout?: number;
  executionMode?: 'foreground' | 'background';
  parallelGroup?: string;
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

async function executeJsonRunnerCall(
  runnerName: string,
  endpoint: string,
  token: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: boolean; output: string }> {
  if (!endpoint) {
    return {
      ok: false,
      output: `${runnerName} is not configured on this instance.`,
    };
  }

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: signal || AbortSignal.timeout(timeoutMs),
    });
    const text = (await resp.text()).slice(0, 12000);
    return {
      ok: resp.ok,
      output: text || `HTTP ${resp.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : 'Runner call failed',
    };
  }
}

async function executeImageToTextAction(
  action: DispatchImageToTextAction,
  startTime: number,
  executedAt: string,
): Promise<ExecutionResult> {
  const imageUrl = (action.imageUrl || '').trim();
  if (!imageUrl) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'image_to_text action missing imageUrl',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }
  if (!isAllowedWebUrl(imageUrl)) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'Image URL blocked by safety policy',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  const timeoutMs = (action.timeout || DEFAULT_TIMEOUT) * 1000;
  const result = await executeJsonRunnerCall(
    'image_to_text runner',
    IMAGE_TO_TEXT_URL,
    IMAGE_TO_TEXT_TOKEN,
    {
      imageUrl,
      prompt: action.prompt || 'Describe this image in detail.',
    },
    timeoutMs,
  );

  return {
    actionId: action.id || 'unknown',
    stdout: result.ok ? result.output : '',
    stderr: result.ok ? '' : result.output,
    exitCode: result.ok ? 0 : 1,
    executedAt,
    durationMs: Date.now() - startTime,
  };
}

async function executeVoiceToTextAction(
  action: DispatchVoiceToTextAction,
  startTime: number,
  executedAt: string,
): Promise<ExecutionResult> {
  const audioUrl = (action.audioUrl || '').trim();
  if (!audioUrl) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'voice_to_text action missing audioUrl',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }
  if (!isAllowedWebUrl(audioUrl)) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'Audio URL blocked by safety policy',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  const timeoutMs = (action.timeout || DEFAULT_TIMEOUT) * 1000;
  const result = await executeJsonRunnerCall(
    'voice_to_text runner',
    VOICE_TO_TEXT_URL,
    VOICE_TO_TEXT_TOKEN,
    {
      audioUrl,
      language: action.language || 'auto',
    },
    timeoutMs,
  );

  return {
    actionId: action.id || 'unknown',
    stdout: result.ok ? result.output : '',
    stderr: result.ok ? '' : result.output,
    exitCode: result.ok ? 0 : 1,
    executedAt,
    durationMs: Date.now() - startTime,
  };
}

async function executeOpencodeServeAction(
  action: DispatchOpencodeServeAction,
  startTime: number,
  executedAt: string,
): Promise<ExecutionResult> {
  const task = (action.task || '').trim();
  if (!task) {
    return {
      actionId: action.id || 'unknown',
      stdout: '',
      stderr: 'opencode_serve action missing task',
      exitCode: 1,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  const timeoutMs = (action.timeout || DEFAULT_TIMEOUT) * 1000;
  const payload = {
    task,
    cwd: action.cwd || '/home/adam/nanoclaw',
    executionMode: action.executionMode || 'foreground',
  };

  if (action.executionMode === 'background') {
    if (!OPENCODE_SERVE_URL) {
      return {
        actionId: action.id || 'unknown',
        stdout: '',
        stderr: 'opencode_serve runner is not configured on this instance.',
        exitCode: 1,
        executedAt,
        durationMs: Date.now() - startTime,
      };
    }
    const runId = `run-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    db.createRun({
      id: runId,
      actionType: 'opencode_serve',
      status: 'queued',
      createdAt,
      summary: task.slice(0, 240),
    });

    const controller = new AbortController();
    backgroundRunAbortControllers.set(runId, controller);
    void (async () => {
      db.updateRun(runId, {
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      const res = await executeJsonRunnerCall(
        'opencode_serve runner',
        OPENCODE_SERVE_URL,
        OPENCODE_SERVE_TOKEN,
        payload,
        timeoutMs,
        controller.signal,
      );
      if (controller.signal.aborted) {
        db.updateRun(runId, {
          status: 'cancelled',
          completedAt: new Date().toISOString(),
          errorText: 'Cancelled by operator request.',
        });
        backgroundRunAbortControllers.delete(runId);
        return;
      }
      db.updateRun(runId, {
        status: res.ok ? 'completed' : 'failed',
        completedAt: new Date().toISOString(),
        ...(res.ok ? { resultText: res.output } : { errorText: res.output }),
      });
      backgroundRunAbortControllers.delete(runId);
    })();
    return {
      actionId: action.id || 'unknown',
      stdout: `Background subagent started.\nrunId=${runId}\nUse /run ${runId} for status.`,
      stderr: '',
      exitCode: 0,
      executedAt,
      durationMs: Date.now() - startTime,
    };
  }

  const result = await executeJsonRunnerCall(
    'opencode_serve runner',
    OPENCODE_SERVE_URL,
    OPENCODE_SERVE_TOKEN,
    payload,
    timeoutMs,
  );

  return {
    actionId: action.id || 'unknown',
    stdout: result.ok ? result.output : '',
    stderr: result.ok ? '' : result.output,
    exitCode: result.ok ? 0 : 1,
    executedAt,
    durationMs: Date.now() - startTime,
  };
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
