export type AddonWizardField =
  | 'name'
  | 'purpose'
  | 'inputs'
  | 'source'
  | 'auth'
  | 'targetHost'
  | 'targetPath'
  | 'successCriteria'
  | 'safety';

export type AddonWizardData = Partial<Record<AddonWizardField, string>>;

export const ADDON_REQUIRED_FIELDS: AddonWizardField[] = [
  'name',
  'purpose',
  'inputs',
  'source',
  'auth',
  'targetHost',
  'targetPath',
  'successCriteria',
  'safety',
];

export function parseAddonName(text: string): string | undefined {
  const match =
    text.match(/\baddon(?: named)?\s+([a-z0-9][a-z0-9-]{1,63})\b/i) ||
    text.match(/\b(?:called|named)\s+([a-z0-9][a-z0-9-]{1,63})\b/i) ||
    text.match(/\b([a-z0-9][a-z0-9-]{1,63})\s+addon\b/i) ||
    text.match(/^\s*([a-z0-9][a-z0-9-]{1,63})\s*$/i);
  const candidate = match?.[1]?.toLowerCase();
  if (!candidate) return undefined;
  const banned = new Set([
    'that',
    'this',
    'which',
    'what',
    'where',
    'when',
    'who',
    'whose',
    'to',
    'for',
    'from',
    'and',
    'the',
    'a',
    'an',
    'new',
  ]);
  if (banned.has(candidate)) return undefined;
  return candidate;
}

export function parseIndexedAnswers(text: string): Record<number, string> {
  const answers: Record<number, string> = {};
  const lines = text.split('\n');
  let foundLineMarkers = false;
  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s*[\).:-]\s*(.+?)\s*$/);
    if (!match) continue;
    const idx = Number(match[1]);
    const value = match[2]?.trim();
    if (!Number.isFinite(idx) || idx <= 0 || !value) continue;
    answers[idx] = value;
    foundLineMarkers = true;
  }

  // Compact two-answer form on one line:
  // "1 answer text 2. second answer text"
  // Keep marker #2 punctuation-required so nested "1 that, 2 that..." lists
  // inside an answer are not split accidentally.
  if (!foundLineMarkers) {
    const compact = text.match(/^\s*1\s*[\).:-]?\s*(.+?)\s+2[\).:-]\s+(.+)\s*$/is);
    if (compact) {
      const first = compact[1]?.trim();
      const second = compact[2]?.trim();
      if (first) answers[1] = first;
      if (second) answers[2] = second;
    }
  }

  return answers;
}

function normalizeFieldValue(field: AddonWizardField, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (field === 'targetHost') {
    const hostMatch = trimmed.match(/\b(william|willy[- ]ubuntu)\b/i);
    if (hostMatch) {
      const host = hostMatch[1].toLowerCase().replace(/\s+/, '-');
      return host === 'willy-ubuntu' ? 'willy-ubuntu' : 'william';
    }
  }

  if (field === 'auth') {
    if (/\b(no login|doesn['’]?t require.*login|public|no auth|free site)\b/i.test(trimmed)) {
      return 'none';
    }
  }

  if (field === 'targetPath') {
    const pathMatch = trimmed.match(/\b(\/[A-Za-z0-9._/-]+)\b/);
    if (pathMatch) return pathMatch[1];
  }

  return trimmed;
}

export function extractAddonWizardData(text: string): AddonWizardData {
  const lower = text.toLowerCase();
  const data: AddonWizardData = {};

  const name = parseAddonName(text);
  if (name) data.name = name;

  if (
    /\b(purpose|goal|capability|should|job is|system for|build a|create|make|develop)\b/i.test(
      text,
    )
  ) {
    data.purpose = text.trim();
  }

  if (/\b(input|query|prompt|search|request|parameters?|args?)\b/i.test(lower)) {
    data.inputs = text.trim();
  }

  const sourceMatch =
    text.match(/\b(https?:\/\/[^\s]+)\b/i) ||
    text.match(/\b([a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?)\b/i);
  if (sourceMatch) {
    const raw = sourceMatch[1];
    data.source = raw.startsWith('http') ? raw : `https://${raw}`;
  }

  if (/\b(no login|doesn['’]?t require.*login|public|no auth|free site)\b/i.test(lower)) {
    data.auth = 'none';
  } else if (/\b(login|auth|api key|token|cookie)\b/i.test(lower)) {
    data.auth = text.trim();
  }

  const hostMatch = text.match(/\b(william|willy[- ]ubuntu)\b/i);
  if (hostMatch) {
    const host = hostMatch[1].toLowerCase().replace(/\s+/, '-');
    data.targetHost = host === 'willy-ubuntu' ? 'willy-ubuntu' : 'william';
  }

  const pathMatch = text.match(/\b(\/[A-Za-z0-9._/-]+)\b/);
  if (pathMatch) data.targetPath = pathMatch[1];

  if (/\b(import|done when|success|result|output|verify)\b/i.test(lower)) {
    data.successCriteria = text.trim();
  }

  if (/\b(approval|safe|safety|limit|retry|timeout|dry run|readonly)\b/i.test(lower)) {
    data.safety = text.trim();
  }

  return data;
}

export function mergeAddonWizardData(
  current: AddonWizardData,
  incoming: AddonWizardData,
): AddonWizardData {
  const merged: AddonWizardData = { ...current };
  for (const key of Object.keys(incoming) as AddonWizardField[]) {
    const value = incoming[key]?.trim();
    if (value) merged[key] = value;
  }
  return merged;
}

export function missingAddonWizardFields(data: AddonWizardData): AddonWizardField[] {
  return ADDON_REQUIRED_FIELDS.filter((f) => !data[f] || data[f]!.trim().length === 0);
}

export function applyIndexedAnswers(
  data: AddonWizardData,
  indexedAnswers: Record<number, string>,
): AddonWizardData {
  const next = { ...data };
  const unanswered = missingAddonWizardFields(next);
  for (const [idxRaw, value] of Object.entries(indexedAnswers)) {
    const idx = Number(idxRaw);
    const targetField = unanswered[idx - 1];
    if (!targetField || !value) continue;
    if (targetField === 'name') {
      const parsedName = parseAddonName(value);
      if (parsedName) next.name = parsedName;
      continue;
    }
    next[targetField] = normalizeFieldValue(targetField, value);
  }
  return next;
}

export function applyIndexedAnswersToFields(
  data: AddonWizardData,
  indexedAnswers: Record<number, string>,
  fields: AddonWizardField[],
): AddonWizardData {
  const next = { ...data };
  for (const [idxRaw, value] of Object.entries(indexedAnswers)) {
    const idx = Number(idxRaw);
    const targetField = fields[idx - 1];
    if (!targetField || !value) continue;
    if (targetField === 'name') {
      const parsedName = parseAddonName(value);
      if (parsedName) next.name = parsedName;
      continue;
    }
    next[targetField] = normalizeFieldValue(targetField, value);
  }
  return next;
}

export function addonWizardQuestion(field: AddonWizardField): string {
  switch (field) {
    case 'name':
      return 'What should the addon be called? (lowercase-hyphen name)';
    case 'purpose':
      return 'What exact capability should this addon provide?';
    case 'inputs':
      return 'What inputs should it accept (for example query terms, URLs, files, or commands)?';
    case 'source':
      return 'What source URL/site or API should it use?';
    case 'auth':
      return 'What authentication does it require (none / token / cookies / login)?';
    case 'targetHost':
      return 'Which target host should it run against (`william` or `willy-ubuntu`)?';
    case 'targetPath':
      return 'What absolute target path should outputs be written to?';
    case 'successCriteria':
      return 'How do we verify success (for example command/output expectation)?';
    case 'safety':
      return 'Any safety rules (approval requirements, retries/timeouts, dry-run constraints)?';
    default:
      return 'Please provide the next missing configuration detail.';
  }
}
