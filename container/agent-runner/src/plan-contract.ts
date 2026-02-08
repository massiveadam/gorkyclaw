const PLAN_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)```/i;

export function extractPlanBlock(text: string): string | null {
  const match = text.match(PLAN_BLOCK_REGEX);
  if (!match) return null;
  return match[1].trim();
}

export function hasValidPlan(text: string): boolean {
  const jsonText = extractPlanBlock(text);
  if (!jsonText) return false;
  try {
    const parsed = JSON.parse(jsonText) as { actions?: unknown[] };
    return Array.isArray(parsed.actions);
  } catch {
    return false;
  }
}

export function ensurePlanBlock(text: string): string {
  if (hasValidPlan(text)) return text;
  const suffix = '```json\n{ "actions": [] }\n```';
  if (!text || text.trim().length === 0) return suffix;
  return `${text.trim()}\n\n${suffix}`;
}
