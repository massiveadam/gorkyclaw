const PLAN_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)```/i;

type Target = 'william' | 'willy-ubuntu';

type BaseAction = {
  type: string;
  reason?: string;
};

type ExecutionHints = {
  executionMode?: 'foreground' | 'background';
  parallelGroup?: string;
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
} & ExecutionHints;

type ObsidianWriteAction = {
  type: 'obsidian_write';
  path: string;
  patch: string;
  requiresApproval: boolean;
  reason: string;
} & ExecutionHints;

type WebFetchMode = 'http' | 'browser';

type WebFetchAction = {
  type: 'web_fetch';
  url: string;
  mode: WebFetchMode;
  requiresApproval: boolean;
  reason: string;
  extract?: string;
} & ExecutionHints;

type ImageToTextAction = {
  type: 'image_to_text';
  imageUrl: string;
  requiresApproval: boolean;
  reason: string;
  prompt?: string;
} & ExecutionHints;

type VoiceToTextAction = {
  type: 'voice_to_text';
  audioUrl: string;
  requiresApproval: boolean;
  reason: string;
  language?: string;
} & ExecutionHints;

type OpencodeServeAction = {
  type: 'opencode_serve';
  task: string;
  requiresApproval: boolean;
  reason: string;
  cwd?: string;
  timeout?: number;
} & ExecutionHints;

type AddonInstallAction = {
  type: 'addon_install';
  addon: string;
  requiresApproval: boolean;
  reason: string;
} & ExecutionHints;

type AddonCreateAction = {
  type: 'addon_create';
  addon: string;
  purpose: string;
  requiresApproval: boolean;
  reason: string;
} & ExecutionHints;

type AddonRunAction = {
  type: 'addon_run';
  addon: string;
  input?: string;
  requiresApproval: boolean;
  reason: string;
} & ExecutionHints;

export type Action =
  | ReplyAction
  | QuestionAction
  | SshAction
  | ObsidianWriteAction
  | WebFetchAction
  | ImageToTextAction
  | VoiceToTextAction
  | OpencodeServeAction
  | AddonInstallAction
  | AddonCreateAction
  | AddonRunAction;

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

  const hints = parseExecutionHints(value);

  return {
    type: 'ssh',
    command,
    target: target as Target,
    requiresApproval,
    reason,
    ...hints,
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

  const hints = parseExecutionHints(value);

  return {
    type: 'obsidian_write',
    path,
    patch,
    requiresApproval,
    reason,
    ...hints,
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

  const hints = parseExecutionHints(value);

  return {
    type: 'web_fetch',
    url,
    mode,
    requiresApproval,
    reason,
    ...(extract ? { extract } : {}),
    ...hints,
  };
}

function validateReplyAction(): ReplyAction {
  return { type: 'reply' };
}

function validateImageToTextAction(value: Record<string, unknown>): ImageToTextAction | null {
  const imageUrl = typeof value.imageUrl === 'string' ? value.imageUrl.trim() : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const requiresApproval =
    typeof value.requiresApproval === 'boolean' ? value.requiresApproval : true;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : undefined;

  if (!imageUrl || !reason) return null;
  try {
    const parsed = new URL(imageUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  const hints = parseExecutionHints(value);

  return {
    type: 'image_to_text',
    imageUrl,
    reason,
    requiresApproval,
    ...(prompt ? { prompt } : {}),
    ...hints,
  };
}

function validateVoiceToTextAction(value: Record<string, unknown>): VoiceToTextAction | null {
  const audioUrl = typeof value.audioUrl === 'string' ? value.audioUrl.trim() : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const requiresApproval =
    typeof value.requiresApproval === 'boolean' ? value.requiresApproval : true;
  const language = typeof value.language === 'string' ? value.language.trim() : undefined;

  if (!audioUrl || !reason) return null;
  try {
    const parsed = new URL(audioUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  const hints = parseExecutionHints(value);

  return {
    type: 'voice_to_text',
    audioUrl,
    reason,
    requiresApproval,
    ...(language ? { language } : {}),
    ...hints,
  };
}

function validateOpencodeServeAction(value: Record<string, unknown>): OpencodeServeAction | null {
  const task = typeof value.task === 'string' ? value.task.trim() : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const requiresApproval =
    typeof value.requiresApproval === 'boolean' ? value.requiresApproval : true;
  const cwd = typeof value.cwd === 'string' ? value.cwd.trim() : undefined;
  const timeout = typeof value.timeout === 'number' && Number.isFinite(value.timeout)
    ? Math.max(1, Math.min(600, Math.floor(value.timeout)))
    : undefined;

  if (!task || !reason) return null;
  const hints = parseExecutionHints(value);

  return {
    type: 'opencode_serve',
    task,
    reason,
    requiresApproval,
    ...(cwd ? { cwd } : {}),
    ...(typeof timeout === 'number' ? { timeout } : {}),
    ...hints,
  };
}

function validateAddonInstallAction(value: Record<string, unknown>): AddonInstallAction | null {
  const addon = typeof value.addon === 'string' ? value.addon.trim() : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const requiresApproval =
    typeof value.requiresApproval === 'boolean' ? value.requiresApproval : true;

  if (!addon || !reason || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(addon)) {
    return null;
  }

  const hints = parseExecutionHints(value);

  return {
    type: 'addon_install',
    addon,
    reason,
    requiresApproval,
    ...hints,
  };
}

function validateAddonCreateAction(value: Record<string, unknown>): AddonCreateAction | null {
  const addon = typeof value.addon === 'string' ? value.addon.trim() : '';
  const purpose = typeof value.purpose === 'string' ? value.purpose.trim() : '';
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const requiresApproval =
    typeof value.requiresApproval === 'boolean' ? value.requiresApproval : true;

  if (!addon || !purpose || !reason || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(addon)) {
    return null;
  }

  const hints = parseExecutionHints(value);

  return {
    type: 'addon_create',
    addon,
    purpose,
    reason,
    requiresApproval,
    ...hints,
  };
}

function validateAddonRunAction(value: Record<string, unknown>): AddonRunAction | null {
  const addon = typeof value.addon === 'string' ? value.addon.trim() : '';
  const input = typeof value.input === 'string' ? value.input.trim() : undefined;
  const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
  const requiresApproval =
    typeof value.requiresApproval === 'boolean' ? value.requiresApproval : true;

  if (!addon || !reason || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(addon)) {
    return null;
  }

  const hints = parseExecutionHints(value);

  return {
    type: 'addon_run',
    addon,
    ...(input ? { input } : {}),
    reason,
    requiresApproval,
    ...hints,
  };
}

function parseExecutionHints(value: Record<string, unknown>): ExecutionHints {
  const executionMode =
    value.executionMode === 'background' ? 'background' : undefined;
  const parallelGroup =
    typeof value.parallelGroup === 'string' ? value.parallelGroup.trim() : '';
  return {
    ...(executionMode ? { executionMode } : {}),
    ...(parallelGroup ? { parallelGroup } : {}),
  };
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
    case 'image_to_text':
      return validateImageToTextAction(value);
    case 'voice_to_text':
      return validateVoiceToTextAction(value);
    case 'opencode_serve':
      return validateOpencodeServeAction(value);
    case 'addon_install':
      return validateAddonInstallAction(value);
    case 'addon_create':
      return validateAddonCreateAction(value);
    case 'addon_run':
      return validateAddonRunAction(value);
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
Each action must correspond to one of: reply, question, ssh, obsidian_write, web_fetch, image_to_text, voice_to_text, opencode_serve, addon_install, addon_create, addon_run.
SSH actions require target (william|willy-ubuntu), command, reason, and requiresApproval (true/false).
Obsidian writes require path, patch, reason, requiresApproval.
Web fetch actions require url, reason, requiresApproval, and optional mode ("http"|"browser") plus optional extract instructions.
Image-to-text actions require imageUrl, reason, requiresApproval, and optional prompt.
Voice-to-text actions require audioUrl, reason, requiresApproval, and optional language.
OpenCode serve actions require task, reason, requiresApproval, and optional cwd/timeout.
Addon install actions require addon, reason, requiresApproval.
Addon create actions require addon, purpose, reason, requiresApproval.
Addon run actions require addon, reason, requiresApproval, and optional input.
Executable actions may include optional executionMode ("foreground"|"background") and parallelGroup for concurrent execution lanes.
Questions must include question text. Reply actions have no extra fields.`;
