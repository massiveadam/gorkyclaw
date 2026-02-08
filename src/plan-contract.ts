const PLAN_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)```/i;

type Target = 'william' | 'willy-ubuntu';

type BaseAction = {
  type: string;
  reason?: string;
};

type ReplyAction = {
  type: 'reply';
};

type QuestionAction = {
  type: 'question';
  question: string;
};

type SshAction = {
  type: 'ssh';
  target: Target;
  command: string;
  requiresApproval: boolean;
  reason: string;
};

type ObsidianWriteAction = {
  type: 'obsidian_write';
  path: string;
  patch: string;
  requiresApproval: boolean;
  reason: string;
};

type WebFetchMode = 'http' | 'browser';

type WebFetchAction = {
  type: 'web_fetch';
  url: string;
  mode: WebFetchMode;
  requiresApproval: boolean;
  reason: string;
  extract?: string;
};

export type Action =
  | ReplyAction
  | QuestionAction
  | SshAction
  | ObsidianWriteAction
  | WebFetchAction;

export interface Plan {
  actions: Action[];
}

export const EMPTY_PLAN: Plan = { actions: [] };

export interface PlanParseResult {
  plan: Plan | null;
  errors: string[];
  rawJson?: string;
}

const ALLOWED_TARGETS: Target[] = ['william', 'willy-ubuntu'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateSshAction(value: Record<string, unknown>): SshAction | null {
  const command = typeof value.command === 'string' ? value.command.trim() : '';
  const target = typeof value.target === 'string' ? value.target : '';
  const requiresApproval = typeof value.requiresApproval === 'boolean'
    ? value.requiresApproval
    : true;
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';

  if (!command || !reason || !ALLOWED_TARGETS.includes(target as Target)) {
    return null;
  }

  return {
    type: 'ssh',
    command,
    target: target as Target,
    requiresApproval,
    reason,
  };
}

function validateObsidianWriteAction(
  value: Record<string, unknown>,
): ObsidianWriteAction | null {
  const path = typeof value.path === 'string' ? value.path.trim() : '';
  const patch = typeof value.patch === 'string' ? value.patch.trim() : '';
  const requiresApproval = typeof value.requiresApproval === 'boolean'
    ? value.requiresApproval
    : true;
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';

  if (!path || !patch || !reason) {
    return null;
  }

  return {
    type: 'obsidian_write',
    path,
    patch,
    requiresApproval,
    reason,
  };
}

function validateQuestionAction(value: Record<string, unknown>): QuestionAction | null {
  const question = typeof value.question === 'string' ? value.question.trim() : '';
  if (!question) return null;
  return { type: 'question', question };
}

function validateWebFetchAction(value: Record<string, unknown>): WebFetchAction | null {
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const modeCandidate = typeof value.mode === 'string' ? value.mode.trim() : '';
  const mode: WebFetchMode = modeCandidate === 'browser' ? 'browser' : 'http';
  const requiresApproval = typeof value.requiresApproval === 'boolean'
    ? value.requiresApproval
    : mode === 'browser';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const extract = typeof value.extract === 'string' ? value.extract.trim() : undefined;

  if (!url || !reason) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    type: 'web_fetch',
    url,
    mode,
    requiresApproval,
    reason,
    ...(extract ? { extract } : {}),
  };
}

function validateReplyAction(): ReplyAction {
  return { type: 'reply' };
}

function validateAction(value: unknown): Action | null {
  if (!isObject(value)) return null;
  const type = typeof value.type === 'string' ? value.type : '';

  switch (type) {
    case 'reply':
      return validateReplyAction();
    case 'question':
      return validateQuestionAction(value);
    case 'ssh':
      return validateSshAction(value);
    case 'obsidian_write':
      return validateObsidianWriteAction(value);
    case 'web_fetch':
      return validateWebFetchAction(value);
    default:
      return null;
  }
}

export function extractPlanBlock(text: string): string | null {
  const match = text.match(PLAN_BLOCK_REGEX);
  if (!match) return null;
  return match[1].trim();
}

export function formatPlanBlock(plan: Plan): string {
  return '```json\n' + JSON.stringify(plan, null, 2) + '\n```';
}

export function parsePlanJson(jsonText: string): Plan | null {
  try {
    const parsed = JSON.parse(jsonText);
    if (!isObject(parsed)) return null;
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const validated: Action[] = [];

    for (const action of actions) {
      const validatedAction = validateAction(action);
      if (!validatedAction) return null;
      validated.push(validatedAction);
    }

    return { actions: validated };
  } catch {
    return null;
  }
}

export function parsePlanFromText(text: string): PlanParseResult {
  const block = extractPlanBlock(text);
  if (!block) {
    // Fallback: accept raw JSON output in case model omitted fences.
    const candidate = text.trim().replace(/^json\s*/i, '').trim();
    const planFromRaw = parsePlanJson(candidate);
    if (planFromRaw) {
      return { plan: planFromRaw, errors: [], rawJson: candidate };
    }
    return { plan: null, errors: ['Missing JSON plan block in response'] };
  }

  const plan = parsePlanJson(block);
  if (!plan) {
    return {
      plan: null,
      errors: ['Plan block exists but JSON failed to parse or schema validation failed'],
      rawJson: block,
    };
  }

  return { plan, errors: [], rawJson: block };
}

export const PLAN_SCHEMA_DESCRIPTION = `The plan block must be a fenced JSON object like:
{\n  "actions": [ ... ]\n}
Each action must correspond to one of: reply, question, ssh, obsidian_write, web_fetch.
SSH actions require target (william|willy-ubuntu), command, reason, and requiresApproval (true/false).
Obsidian writes require path, patch, reason, requiresApproval.
Web fetch actions require url, reason, requiresApproval, and optional mode ("http"|"browser") plus optional extract instructions.
Questions must include question text. Reply actions have no extra fields.`;
