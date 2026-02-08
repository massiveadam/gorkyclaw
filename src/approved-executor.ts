import { createHmac, randomUUID } from 'crypto';

import {
  APPROVED_ACTION_WEBHOOK_SECRET,
  APPROVED_ACTION_WEBHOOK_TIMEOUT_MS,
  APPROVED_ACTION_WEBHOOK_URL,
  ENABLE_APPROVED_EXECUTION,
  ENABLE_LOCAL_APPROVED_EXECUTION,
} from './config.js';
import type { Action } from './plan-contract.js';

const BLOCKED_META_CHARS = /[;&|`$<>{}\\]/;

const ALLOWED_READONLY_COMMANDS: RegExp[] = [
  /^uptime$/,
  /^whoami$/,
  /^id$/,
  /^hostname$/,
  /^date$/,
  /^ping -c \d+ [A-Za-z0-9._:-]+$/,
  /^ls(?:\s+-[a-zA-Z]+)?\s+\/[A-Za-z0-9._/-]+$/,
  /^uname(?:\s+-[a-zA-Z]+)?$/,
  /^free(?:\s+-[a-zA-Z]+)?$/,
  /^df(?:\s+-[a-zA-ZhT]+)*(?:\s+\/[A-Za-z0-9._/-]+)?$/,
  /^docker ps(?:\s+[-a-zA-Z0-9=:_./]+)*$/,
  /^docker stats --no-stream$/,
  /^systemctl status [a-zA-Z0-9_.@-]+(?:\s+--no-pager)?$/,
  /^journalctl -u [a-zA-Z0-9_.@-]+(?:\s+--no-pager)?(?:\s+-n\s+\d+)?$/,
];

export interface ExecutionResult {
  actionType: string;
  target?: string;
  command?: string;
  status: 'executed' | 'blocked' | 'failed' | 'skipped';
  output: string;
}

interface RunnerActionResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  executedAt?: string;
}

interface DispatchPayload {
  event: 'approved_actions.dispatch';
  dispatchId: string;
  dispatchedAt: string;
  source: 'nanoclaw-core';
  actions: Array<Extract<Action, { type: 'ssh' | 'web_fetch' }>>;
}

function buildWebhookSignature(timestamp: string, payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

export function isAllowedReadonlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (BLOCKED_META_CHARS.test(trimmed)) return false;
  return ALLOWED_READONLY_COMMANDS.some((pattern) => pattern.test(trimmed));
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.local')) return true;
  if (lower.endsWith('.internal')) return true;
  return false;
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
  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80:')) return true;
  return false;
}

export function isAllowedWebUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.trim();
  if (!host) return false;
  if (host === '169.254.169.254') return false;
  if (isPrivateHostname(host)) return false;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;
  return true;
}

async function dispatchApprovedActions(
  actions: Array<Extract<Action, { type: 'ssh' | 'web_fetch' }>>,
): Promise<{
  ok: boolean;
  output: string;
  actionResults?: RunnerActionResult[];
}> {
  if (!APPROVED_ACTION_WEBHOOK_URL) {
    return {
      ok: false,
      output:
        'No APPROVED_ACTION_WEBHOOK_URL configured. Action stayed queued/orchestrated only.',
    };
  }

  const payload: DispatchPayload = {
    event: 'approved_actions.dispatch',
    dispatchId: randomUUID(),
    dispatchedAt: new Date().toISOString(),
    source: 'nanoclaw-core',
    actions,
  };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-nanoclaw-dispatch-id': payload.dispatchId,
  };

  if (APPROVED_ACTION_WEBHOOK_SECRET) {
    const timestamp = `${Date.now()}`;
    headers['x-nanoclaw-signature-ts'] = timestamp;
    headers['x-nanoclaw-signature'] = `sha256=${buildWebhookSignature(
      timestamp,
      body,
      APPROVED_ACTION_WEBHOOK_SECRET,
    )}`;
  }

  try {
    const response = await fetch(APPROVED_ACTION_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(APPROVED_ACTION_WEBHOOK_TIMEOUT_MS),
    });

    const responseBody = (await response.text()).trim();
    if (!response.ok) {
      return {
        ok: false,
        output: `Webhook dispatch failed (HTTP ${response.status}): ${
          responseBody || '(empty body)'
        }`,
      };
    }

    let hasActionFailures = false;
    let actionResults: RunnerActionResult[] | undefined;
    try {
      const parsed = JSON.parse(responseBody) as {
        results?: RunnerActionResult[];
      };
      if (Array.isArray(parsed.results)) {
        actionResults = parsed.results;
        hasActionFailures = parsed.results.some((r) => (r.exitCode ?? 0) !== 0);
      }
    } catch {
      // Ignore parse errors and treat as dispatch success.
    }

    return {
      ok: !hasActionFailures,
      output: hasActionFailures
        ? `Runner executed with one or more action failures (dispatchId=${payload.dispatchId}, HTTP ${response.status}).`
        : `Dispatched ${actions.length} action(s) to webhook (dispatchId=${payload.dispatchId}, HTTP ${response.status}).`,
      actionResults,
    };
  } catch (err) {
    return {
      ok: false,
      output: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeApprovedActions(actions: Action[]): Promise<ExecutionResult[]> {
  if (ENABLE_LOCAL_APPROVED_EXECUTION) {
    return actions.map((action) => ({
      actionType: action.type,
      target: action.type === 'ssh' ? action.target : undefined,
      command:
        action.type === 'ssh'
          ? action.command
          : action.type === 'web_fetch'
            ? action.url
            : undefined,
      status: 'blocked',
      output: 'Local execution is disabled in core app; route through webhook dispatcher.',
    }));
  }

  const results: ExecutionResult[] = [];
  const dispatchableActions: Array<Extract<Action, { type: 'ssh' | 'web_fetch' }>> = [];

  for (const action of actions) {
    if (action.type !== 'ssh' && action.type !== 'web_fetch') {
      results.push({
        actionType: action.type,
        status: 'skipped',
        output: `Action type ${action.type} is not executable by external runner in this step.`,
      });
      continue;
    }

    if (action.type === 'ssh' && !isAllowedReadonlyCommand(action.command)) {
      results.push({
        actionType: 'ssh',
        target: action.target,
        command: action.command,
        status: 'blocked',
        output: 'Command blocked by readonly allowlist policy.',
      });
      continue;
    }

    if (action.type === 'web_fetch') {
      if (!isAllowedWebUrl(action.url)) {
        results.push({
          actionType: 'web_fetch',
          status: 'blocked',
          output: 'URL blocked by web-fetch safety policy.',
        });
        continue;
      }

      if (action.mode === 'browser' && !action.requiresApproval) {
        results.push({
          actionType: 'web_fetch',
          status: 'blocked',
          output: 'Browser mode requires approval. Set requiresApproval=true.',
        });
        continue;
      }
    }

    dispatchableActions.push(action);
  }

  if (!ENABLE_APPROVED_EXECUTION) {
    for (const action of dispatchableActions) {
      results.push({
        actionType: action.type,
        target: action.type === 'ssh' ? action.target : undefined,
        command: action.type === 'ssh' ? action.command : action.url,
        status: 'skipped',
        output: 'Approved execution is disabled (ENABLE_APPROVED_EXECUTION=false).',
      });
    }
    return results;
  }

  if (dispatchableActions.length === 0) {
    return results;
  }

  if (!APPROVED_ACTION_WEBHOOK_URL) {
    for (const action of dispatchableActions) {
      results.push({
        actionType: action.type,
        target: action.type === 'ssh' ? action.target : undefined,
        command: action.type === 'ssh' ? action.command : action.url,
        status: 'skipped',
        output:
          'No APPROVED_ACTION_WEBHOOK_URL configured. Action stayed queued/orchestrated only.',
      });
    }
    return results;
  }

  const dispatch = await dispatchApprovedActions(dispatchableActions);
  const status: ExecutionResult['status'] = dispatch.ok ? 'executed' : 'failed';

  for (let i = 0; i < dispatchableActions.length; i += 1) {
    const action = dispatchableActions[i];
    const runner = dispatch.actionResults?.[i];
    const runnerOut = [
      typeof runner?.exitCode === 'number' ? `exitCode=${runner.exitCode}` : '',
      typeof runner?.durationMs === 'number' ? `durationMs=${runner.durationMs}` : '',
      runner?.stdout ? `stdout:\n${runner.stdout}` : '',
      runner?.stderr ? `stderr:\n${runner.stderr}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    results.push({
      actionType: action.type,
      target: action.type === 'ssh' ? action.target : undefined,
      command: action.type === 'ssh' ? action.command : action.url,
      status,
      output: runnerOut || dispatch.output,
    });
  }

  return results;
}

export { buildWebhookSignature };
