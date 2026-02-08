export type WebIntent = 'restaurant' | 'news' | 'ranking' | 'generic';

export function detectWebIntent(
  requestText: string | undefined,
  sourceUrl: string | null,
): WebIntent {
  const req = (requestText || '').toLowerCase();
  let host = '';
  if (sourceUrl) {
    try {
      host = new URL(sourceUrl).hostname.toLowerCase();
    } catch {
      host = '';
    }
  }

  if (
    /\b(restaurant|reservation|table|menu|eat|dining|venue|resy)\b/.test(req) ||
    host.includes('resy.com') ||
    host.includes('opentable.com')
  ) {
    return 'restaurant';
  }
  if (/\b(news|latest|headline|today|update|breaking|what happened)\b/.test(req)) {
    return 'news';
  }
  if (
    /\b(best|top|rank|ranking|chart|albums|songs|movies|list)\b/.test(req) ||
    host.includes('aoty.org')
  ) {
    return 'ranking';
  }
  return 'generic';
}

export function buildIntentFormatterRules(intent: WebIntent): string {
  if (intent === 'restaurant') {
    return [
      'Format exactly with these sections if data exists:',
      '### What It Is',
      '### What To Know',
      '### Booking Notes',
      'Prefer practical details: concept, cuisine/style, notable dishes, pricing signal, reservation timing.',
      'If details are uncertain, say "Not clearly shown on the page."',
    ].join('\n');
  }
  if (intent === 'news') {
    return [
      'Format exactly with these sections:',
      '### Key Updates',
      '### Why It Matters',
      '### What Is Unclear',
      'Use dated, concrete facts only when present in sources.',
    ].join('\n');
  }
  if (intent === 'ranking') {
    return [
      'Output a ranked list with as many high-confidence items as available (aim for 8-12).',
      'Use this format:',
      '### Top Items',
      '1. Item - one short supporting detail',
      'After the list add:',
      '### Quick Take',
      'Never stop at 3 unless only 3 were reliably extracted.',
    ].join('\n');
  }
  return [
    'Return a direct concise answer with short bullets if useful.',
    'Avoid generic filler and avoid saying you cannot browse.',
  ].join('\n');
}

export function isLowQualityWebAnswer(answer: string, intent: WebIntent): boolean {
  const text = answer.trim();
  const lower = text.toLowerCase();
  if (!text) return true;
  if (
    lower.includes("can't access external websites") ||
    lower.includes('cannot access external websites') ||
    lower.includes('provide the content') ||
    lower.includes('unable to retrieve')
  ) {
    return true;
  }
  if (/^(url|status|content-type|title|summary)\s*[:=]/im.test(text)) {
    return true;
  }

  if (intent === 'ranking') {
    const numbered = text.match(/^\s*\d+\.\s+/gm)?.length ?? 0;
    if (numbered < 5) return true;
  }

  if (intent === 'restaurant') {
    const hasSections =
      /what it is/i.test(text) && /what to know/i.test(text) && /booking notes/i.test(text);
    if (!hasSections && text.length < 280) return true;
  }

  return text.length < 140;
}
