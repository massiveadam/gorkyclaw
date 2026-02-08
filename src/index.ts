import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import TelegramClient from './telegram-client.js';
import {
  ASSISTANT_NAME,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  STORE_DIR,
  TELEGRAM_ADMIN_CHAT_ID,
  TELEGRAM_BOT_TOKEN,
  TIMEZONE,
  TRIGGER_PATTERN,
  OBSIDIAN_VAULT_PATH,
  OBSIDIAN_MEMORY_DIRS,
  OBSIDIAN_MEMORY_MAX_SNIPPETS,
  OBSIDIAN_MEMORY_MAX_CHARS,
  ENABLE_APPROVED_EXECUTION,
} from './config.js';
import {
  AvailableGroup,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllChats,
  getAllTasks,
  getLastGroupSync,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  initDatabase,
  setLastGroupSync,
  storeChatMetadata,
  storeMessage,
  updateChatName,
} from './db.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { NewMessage, RegisteredGroup, Session } from './types.js';
import { loadJson, saveJson } from './utils.js';
import { buildUserPrompt } from './prompt.js';
import { buildObsidianMemoryHeader } from './obsidian-memory.js';
import { logger } from './logger.js';
import {
  EMPTY_PLAN,
  formatPlanBlock,
  parsePlanFromText,
  PLAN_SCHEMA_DESCRIPTION,
  type Plan,
} from './plan-contract.js';
import {
  decideActionProposal,
  enqueueActionProposal,
  getActionProposalById,
  getPendingActionProposals,
} from './action-queue.js';
import { executeApprovedActions } from './approved-executor.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let telegramClient: TelegramClient;
let lastTimestamp = '';
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
// Guards to prevent duplicate loops on reconnect
let messageLoopRunning = false;
let ipcWatcherRunning = false;
let groupSyncTimerStarted = false;

async function setTyping(chatId: string, isTyping: boolean): Promise<void> {
  try {
    await telegramClient.setTyping(chatId, isTyping);
  } catch (err) {
    logger.debug({ chatId, err }, 'Failed to update typing status');
  }
}

function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};
  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  registeredGroups = loadJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: lastTimestamp,
    last_agent_timestamp: lastAgentTimestamp,
  });
  saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
}

function registerGroup(chatId: string, group: RegisteredGroup): void {
  registeredGroups[chatId] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { chatId, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Sync group metadata from Telegram.
 * In Telegram, groups are discovered through messages, so this is minimal.
 * Called on startup, daily, and on-demand via IPC.
 */
async function syncGroupMetadata(force = false): Promise<void> {
  // Check if we need to sync (skip if synced recently, unless forced)
  if (!force) {
    const lastSync = getLastGroupSync();
    if (lastSync) {
      const lastSyncTime = new Date(lastSync).getTime();
      const now = Date.now();
      if (now - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
        logger.debug({ lastSync }, 'Skipping group sync - synced recently');
        return;
      }
    }
  }

  try {
    logger.info('Syncing group metadata from Telegram...');
    // In Telegram, we rely on messages to discover chats
    // This is a no-op but maintains interface compatibility
    const chats = getAllChats();

    let count = 0;
    for (const chat of chats) {
      if (chat.name) {
        updateChatName(chat.jid, chat.name);
        count++;
      }
    }

    setLastGroupSync();
    logger.info({ count }, 'Group metadata synced');
  } catch (err) {
    logger.error({ err }, 'Failed to sync group metadata');
  }
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__')
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

async function processMessage(msg: NewMessage): Promise<void> {
  const group = registeredGroups[msg.chat_jid];
  if (!group) return;

  const content = msg.content.trim();
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // Main group responds to all messages; other groups require trigger prefix
  if (!isMainGroup && !TRIGGER_PATTERN.test(content)) return;

  const sinceTimestamp = lastAgentTimestamp[msg.chat_jid] || '';
  const missedMessages = getMessagesSince(
    msg.chat_jid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  const userPrompt = buildUserPrompt(missedMessages);
  const memoryHeader = buildObsidianMemoryHeader({
    vaultPath: OBSIDIAN_VAULT_PATH,
    memoryDirs: OBSIDIAN_MEMORY_DIRS,
    query: userPrompt,
    maxSnippets: OBSIDIAN_MEMORY_MAX_SNIPPETS,
    maxChars: OBSIDIAN_MEMORY_MAX_CHARS,
  });
  const prompt = `${memoryHeader}${userPrompt}`.trim();

  if (!prompt) return;

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing message',
  );

  await setTyping(msg.chat_jid, true);
  const response = await runAgent(group, prompt, msg.chat_jid);
  await setTyping(msg.chat_jid, false);

  if (response) {
    const fallbackWebFetch = buildFallbackWebFetchAction(content);
    const hasWebFetchAction = response.plan.actions.some((action) => action.type === 'web_fetch');
    if (fallbackWebFetch && !hasWebFetchAction) {
      response.plan.actions.push(fallbackWebFetch);
      logger.info(
        {
          group: group.name,
          inferredUrl: fallbackWebFetch.url,
          inferredMode: fallbackWebFetch.mode,
        },
        'Injected fallback web_fetch action from user message URL/domain',
      );
    }

    const proposal = enqueueActionProposal({
      groupFolder: group.folder,
      chatJid: msg.chat_jid,
      plan: response.plan,
      requestText: content,
    });
    if (proposal) {
      logger.info(
        {
          proposalId: proposal.id,
          group: group.name,
          actionCount: proposal.actions.length,
        },
        'Queued proposed actions for approval-only workflow',
      );
      await telegramClient.sendApprovalButtons(
        msg.chat_jid,
        `Approval needed\nProposal: ${proposal.id}\n\n${summarizeProposalActions(
          proposal.actions,
        )}\n\nChoose: Approve, Deny, or Other reason.`,
        proposal.id,
      );
    }

    lastAgentTimestamp[msg.chat_jid] = msg.timestamp;
    const assistantText = stripPlainPlanJson(response.reply.trim());
    const isKnownFallback =
      assistantText.includes('I could not generate a complete answer. Please retry.');
    const isWebRefusal =
      /can't access external websites|cannot access external websites|can(?:not|'t) browse/i.test(
        assistantText,
      );
    const hasWebProposal = Boolean(
      proposal && proposal.actions.some((action) => action.type === 'web_fetch'),
    );
    if (assistantText.length > 0) {
      if (!(proposal && (isKnownFallback || isWebRefusal || hasWebProposal))) {
        await sendMessage(msg.chat_jid, assistantText);
      }
    } else if (!proposal) {
      await sendMessage(msg.chat_jid, 'I could not generate a complete answer. Please retry.');
    }
    if (response.planErrors.length > 0) {
      logger.warn(
        { errors: response.planErrors, group: group.name },
        'Plan required repair',
      );
    }
  }
}

function summarizeProposalActions(actions: Plan['actions']): string {
  return actions
    .map((action, index) => {
      switch (action.type) {
        case 'ssh':
          return `${index + 1}. SSH on ${action.target}\nCommand: ${action.command}\nReason: ${action.reason}`;
        case 'web_fetch':
          return `${index + 1}. Web fetch (${action.mode})\nURL: ${action.url}\nReason: ${action.reason}`;
        case 'question':
          return `${index + 1}. Ask question\n${action.question}`;
        case 'obsidian_write':
          return `${index + 1}. Write note\nPath: ${action.path}`;
        case 'reply':
          return `${index + 1}. Send reply`;
        default:
          return `${index + 1}. Unknown action`;
      }
    })
    .join('\n\n');
}

async function formatExecutionResults(
  proposalId: string,
  requestText: string | undefined,
  results: Awaited<ReturnType<typeof executeApprovedActions>>,
): Promise<string> {
  const rewrittenWeb = await rewriteWebResults(requestText, results);
  const webOnly = results.every((r) => r.actionType === 'web_fetch');

  if (webOnly) {
    const answer = rewrittenWeb.filter(Boolean).join('\n\n');
    if (answer.trim().length > 0) {
      return answer.trim();
    }
  }

  const summary = results
    .map((r, idx) => {
      const target = r.target ? `Target: ${r.target}\n` : '';
      const output =
        r.actionType === 'web_fetch'
          ? rewrittenWeb[idx] || summarizeWebFetchOutput(r.output)
          : r.output.slice(0, 500);
      const command = r.command ? `Command: ${r.command}\n` : '';
      if (r.actionType === 'web_fetch') {
        return `- ${r.status.toUpperCase()}\n${output}`;
      }
      return `- ${r.status.toUpperCase()}\n${target}${command}${output}`;
    })
    .join('\n\n');

  return `Execution results (${proposalId})\n\n${summary}`;
}

async function rewriteWebResults(
  requestText: string | undefined,
  results: Awaited<ReturnType<typeof executeApprovedActions>>,
): Promise<string[]> {
  const rewritten: string[] = [];

  for (const result of results) {
    if (result.actionType !== 'web_fetch' || result.status !== 'executed') {
      rewritten.push('');
      continue;
    }

    const baseSummary = summarizeWebFetchOutput(result.output);
    const context = extractWebContext(result.output);
    const sourceUrl = extractWebSourceUrl(result.output);
    const mirrorText = await fetchReadableMirrorText(sourceUrl, context.isDynamicShell);
    const researchContext = await buildResearchContext(requestText, sourceUrl, context.title);
    const prompt = [
      'You are a web summarizer. Produce a direct, useful answer for the user request.',
      'Do not include scraper metadata (URL, HTTP status, content type, command).',
      'Use plain markdown with short sections and bullets when helpful.',
      'Focus on exactly what the user asked for.',
      'If the page appears JS-rendered or incomplete, explicitly say that and suggest browser mode.',
      'If list extraction exists (like albums), include as many high-confidence items as available.',
      '',
      `User request: ${requestText || 'Summarize the page content'}`,
      '',
      `Page title: ${context.title || '(none)'}`,
      `Page description: ${context.description || '(none)'}`,
      `Dynamic-page signal: ${context.isDynamicShell ? 'yes' : 'no'}`,
      context.listItems.length > 0 ? `Detected list items:\n${context.listItems.join('\n')}` : '',
      mirrorText ? `Readable mirror text:\n${mirrorText.slice(0, 8000)}` : '',
      researchContext ? `Supporting sources:\n${researchContext}` : '',
      '',
      'Extracted page text (truncated):',
      context.cleanText.slice(0, 6000),
      '',
      'Fallback summary from parser:',
      baseSummary,
      '',
      'Write a direct final answer with helpful detail and no boilerplate.',
      'Return only the final user-facing answer.',
    ].join('\n');

    const rewrittenText = await runDirectSummaryAgent(prompt);
    const cleaned = sanitizeWebAnswer(rewrittenText || baseSummary);
    rewritten.push(cleaned.trim() || baseSummary);
  }

  return rewritten;
}

function extractWebSourceUrl(raw: string): string | null {
  const url = raw.match(/(?:^|\n)url=(.+)/)?.[1]?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchReadableMirrorText(
  sourceUrl: string | null,
  shouldTryMirror: boolean,
): Promise<string> {
  if (!sourceUrl || !shouldTryMirror) return '';
  try {
    const withoutProtocol = sourceUrl.replace(/^https?:\/\//i, '');
    const mirrorUrl = `https://r.jina.ai/http://${withoutProtocol}`;
    const resp = await fetch(mirrorUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'user-agent': 'nanoclaw-web-summary/1.0',
      },
    });
    if (!resp.ok) return '';
    const text = (await resp.text()).trim();
    if (!text) return '';
    return text.slice(0, 12000);
  } catch {
    return '';
  }
}

function decodeDuckDuckGoRedirect(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'duckduckgo.com') return url;
    const target = parsed.searchParams.get('uddg');
    if (!target) return url;
    return decodeURIComponent(target);
  } catch {
    return url;
  }
}

async function fetchSearchResultsText(query: string): Promise<string> {
  if (!query.trim()) return '';
  try {
    const searchUrl = `https://r.jina.ai/http://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(searchUrl, {
      signal: AbortSignal.timeout(12000),
      headers: { 'user-agent': 'nanoclaw-web-research/1.0' },
    });
    if (!resp.ok) return '';
    return (await resp.text()).slice(0, 18000);
  } catch {
    return '';
  }
}

function extractSupportingLinks(searchText: string, sourceUrl: string | null): string[] {
  const matches = [...searchText.matchAll(/\[[^\]]+\]\((https?:\/\/[^\)]+)\)/g)];
  const urls: string[] = [];
  const sourceHost = sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, '') : '';

  for (const match of matches) {
    const raw = match[1];
    const decoded = decodeDuckDuckGoRedirect(raw);
    try {
      const parsed = new URL(decoded);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const host = parsed.hostname.replace(/^www\./, '');
      if (!host) continue;
      if (sourceHost && host === sourceHost) continue;
      if (host.includes('duckduckgo.com')) continue;
      if (/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf)$/i.test(parsed.pathname)) continue;
      if (!urls.includes(parsed.toString())) urls.push(parsed.toString());
      if (urls.length >= 3) break;
    } catch {
      continue;
    }
  }
  return urls;
}

async function fetchSupportingSourceSnippets(urls: string[]): Promise<string> {
  if (urls.length === 0) return '';
  const snippets = await Promise.all(
    urls.map(async (url) => {
      try {
        const mirror = await fetch(`https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`, {
          signal: AbortSignal.timeout(9000),
          headers: { 'user-agent': 'nanoclaw-web-research/1.0' },
        });
        if (!mirror.ok) return '';
        const text = (await mirror.text()).replace(/\s+/g, ' ').trim();
        if (!text) return '';
        return `- ${url}\n  ${text.slice(0, 700)}`;
      } catch {
        return '';
      }
    }),
  );
  return snippets.filter(Boolean).join('\n');
}

function buildResearchQuery(
  requestText: string | undefined,
  sourceUrl: string | null,
  title: string,
): string {
  const req = (requestText || '').trim();
  if (req.length > 0 && req.length < 180) return req;
  if (title && sourceUrl) return `${title} ${new URL(sourceUrl).hostname}`;
  if (title) return title;
  if (sourceUrl) return sourceUrl;
  return '';
}

async function buildResearchContext(
  requestText: string | undefined,
  sourceUrl: string | null,
  title: string,
): Promise<string> {
  if (process.env.WEB_RESEARCH_ENRICHMENT?.toLowerCase() === 'false') return '';
  const query = buildResearchQuery(requestText, sourceUrl, title);
  if (!query) return '';
  const searchText = await fetchSearchResultsText(query);
  if (!searchText) return '';
  const links = extractSupportingLinks(searchText, sourceUrl);
  if (links.length === 0) return '';
  return await fetchSupportingSourceSnippets(links);
}

function sanitizeWebAnswer(text: string): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter(
      (line) =>
        !/^url:/i.test(line) &&
        !/^url=/i.test(line) &&
        !/^http:/i.test(line) &&
        !/^https:/i.test(line) &&
        !/^content-type:/i.test(line) &&
        !/^contentType=/i.test(line) &&
        !/^status=/i.test(line) &&
        !/^summary:/i.test(line) &&
        !/^web summary$/i.test(line),
    )
    .join('\n');
  return cleaned.trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function cleanHtmlToText(body: string): string {
  return decodeHtmlEntities(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function cleanAotyName(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  const navTerms = [
    'Best Albums',
    'Discover',
    'New Releases',
    'Lists',
    'Genres',
    'News',
    'Community',
    'Sign In',
    'View All Albums',
    'Albums',
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const term of navTerms) {
      const re = new RegExp(`^${term}\\s+`, 'i');
      if (re.test(text)) {
        text = text.replace(re, '').trim();
        changed = true;
      }
    }
  }

  // If a noisy prefix still exists, keep a concise tail that usually contains artist + album.
  const words = text.split(/\s+/);
  if (words.length > 8) {
    text = words.slice(-8).join(' ');
  }
  return text;
}

function extractAotyItems(text: string): string[] {
  const items: string[] = [];
  const re =
    /([A-Z][A-Za-z0-9'&.,\- ]{1,90}?)\s+(\d{2})\s+critic score\s+\(\d+\)\s+(\d{2})\s+user score/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && items.length < 12) {
    const name = cleanAotyName(match[1]);
    if (!name) continue;
    items.push(`${name} (critic ${match[2]}, user ${match[3]})`);
  }
  return [...new Set(items)];
}

function pickKeySentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 220)
    .filter((s) => !/[{}]|ng-app|skip_to_main|upgrade your browser/i.test(s));
  const unique: string[] = [];
  for (const sentence of sentences) {
    if (!unique.includes(sentence)) unique.push(sentence);
    if (unique.length >= 2) break;
  }
  return unique;
}

function summarizeWebFetchOutput(raw: string): string {
  const url = raw.match(/(?:^|\n)url=(.+)/)?.[1]?.trim() || '';
  const extractHint = raw.match(/(?:^|\n)extract_hint=(.+)/)?.[1]?.trim() || '';

  const htmlStart = raw.search(/<!doctype|<html/i);
  const body = htmlStart >= 0 ? raw.slice(htmlStart) : raw;

  const title = decodeHtmlEntities(
    body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '',
  );

  const description = decodeHtmlEntities(
    body
      .match(
        /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)["']/i,
      )?.[1]
      ?.replace(/\s+/g, ' ')
      .trim() || '',
  );

  const cleanedText = cleanHtmlToText(body).replace(/\bextract_hint=.*$/i, '').trim();
  const isDynamicShell =
    /{{|ng-app|skip_to_main|resy uses the latest technology|enable javascript/i.test(
      `${body} ${cleanedText}`,
    );

  const lines: string[] = [];

  if (/resy\.com/i.test(url)) {
    const venueMatch = cleanedText.match(/Book Your\s+(.+?)\s+Reservation Now on Resy/i);
    const descriptorMatch = cleanedText.match(
      /seasonal italian restaurant from the team behind the four horsemen\.?/i,
    );
    const venueName = venueMatch?.[1]?.trim() || '';
    if (venueName || descriptorMatch) {
      if (venueName) {
        lines.push(`${venueName} is a restaurant listed on Resy.`);
      }
      if (descriptorMatch) {
        lines.push('- Seasonal Italian restaurant from the Four Horsemen team.');
      }
      lines.push('- Reservation availability appears to be managed directly on Resy.');
      return lines.join('\n');
    }
  }

  if (/aoty\.org/i.test(url)) {
    const topItems = extractAotyItems(cleanedText);
    if (topItems.length > 0) {
      lines.push('Best new albums:');
      for (const [idx, item] of topItems.slice(0, 10).entries()) {
        lines.push(`${idx + 1}. ${item}`);
      }
      return lines.join('\n');
    }
  }

  const keySentences = pickKeySentences(cleanedText);
  if (keySentences.length > 0) {
    if (extractHint) {
      lines.push(`${extractHint}:`);
    }
    for (const sentence of keySentences.slice(0, 3)) {
      lines.push(`- ${sentence}`);
    }
  } else if (isDynamicShell) {
    lines.push('Could not extract reliable content in HTTP mode; this page is JS-rendered.');
    lines.push('Use browser mode to get a proper summary.');
  } else if (cleanedText) {
    lines.push(`${cleanedText.slice(0, 420)}${cleanedText.length > 420 ? '...' : ''}`);
  } else {
    lines.push('No readable page content returned.');
  }

  if (lines.length === 0 && title) {
    lines.push(title);
    if (description) lines.push(description);
  }

  return lines.join('\n');
}

function extractWebContext(raw: string): {
  title: string;
  description: string;
  cleanText: string;
  listItems: string[];
  isDynamicShell: boolean;
} {
  const htmlStart = raw.search(/<!doctype|<html/i);
  const body = htmlStart >= 0 ? raw.slice(htmlStart) : raw;
  const title = decodeHtmlEntities(
    body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '',
  );
  const description = decodeHtmlEntities(
    body
      .match(
        /<meta[^>]+(?:name=["']description["']|property=["']og:description["'])[^>]+content=["']([^"']+)["']/i,
      )?.[1]
      ?.replace(/\s+/g, ' ')
      .trim() || '',
  );
  const cleanText = cleanHtmlToText(body).replace(/\bextract_hint=.*$/i, '').trim();
  const isDynamicShell =
    /{{|ng-app|skip_to_main|resy uses the latest technology|enable javascript/i.test(
      `${body} ${cleanText}`,
    );

  const url = raw.match(/(?:^|\n)url=(.+)/)?.[1]?.trim() || '';
  const listItems = /aoty\.org/i.test(url)
    ? extractAotyItems(cleanText).map((v) => `- ${v}`)
    : [];

  return { title, description, cleanText, listItems, isDynamicShell };
}

async function handleApprovalCommand(chatId: string, rawText: string): Promise<boolean> {
  const text = rawText.trim();

  if (/^\/approvals(?:@\w+)?$/i.test(text)) {
    const pending = getPendingActionProposals(chatId).slice(0, 5);
    if (pending.length === 0) {
      await sendMessage(chatId, 'No pending action proposals.');
      return true;
    }

    const lines = pending.map(
      (item) => `- ${item.id}: ${item.actions.length} action(s) pending`,
    );
    await sendMessage(
      chatId,
      `Pending proposals:\n${lines.join('\n')}`,
    );
    return true;
  }

  const approveMatch = text.match(/^\/approve(?:@\w+)?\s+([A-Za-z0-9-]+)/i);
  if (approveMatch) {
    const id = approveMatch[1];
    const record = decideActionProposal(id, 'approved');
    if (!record) {
      const existing = getActionProposalById(id);
      if (existing && existing.status === 'approved') {
        await sendMessage(chatId, `Proposal ${id} is already approved.`);
        return true;
      }
      if (existing && existing.status === 'denied') {
        await sendMessage(chatId, `Proposal ${id} is already denied.`);
        return true;
      }
      await sendMessage(
        chatId,
        `Could not approve ${id}. Proposal not found.`,
      );
      return true;
    }
    await sendMessage(
      chatId,
      `Approved ${record.id}.`,
    );
    const results = await executeApprovedActions(record.actions);
    await sendMessage(
      chatId,
      await formatExecutionResults(record.id, record.requestText, results),
    );
    return true;
  }

  const denyMatch = text.match(/^\/deny(?:@\w+)?\s+([A-Za-z0-9-]+)(?:\s+(.+))?$/i);
  if (denyMatch) {
    const id = denyMatch[1];
    const reason = denyMatch[2]?.trim() || undefined;
    const record = decideActionProposal(id, 'denied', reason);
    if (!record) {
      const existing = getActionProposalById(id);
      if (existing && existing.status === 'denied') {
        await sendMessage(chatId, `Proposal ${id} is already denied.`);
        return true;
      }
      if (existing && existing.status === 'approved') {
        await sendMessage(chatId, `Proposal ${id} is already approved.`);
        return true;
      }
      await sendMessage(
        chatId,
        `Could not deny ${id}. Proposal not found.`,
      );
      return true;
    }
    await sendMessage(chatId, `Denied ${record.id}.`);
    return true;
  }

  return false;
}

async function handleApprovalCallback(chatId: string, data: string): Promise<void> {
  const approveMatch = data.match(/^approve:([A-Za-z0-9-]+)$/i);
  if (approveMatch) {
    const id = approveMatch[1];
    const record = decideActionProposal(id, 'approved');
    if (!record) {
      const existing = getActionProposalById(id);
      if (existing && existing.status === 'approved') {
        await sendMessage(chatId, `Proposal ${id} is already approved.`);
        return;
      }
      if (existing && existing.status === 'denied') {
        await sendMessage(chatId, `Proposal ${id} is already denied.`);
        return;
      }
      await sendMessage(chatId, `Could not approve ${id}. Proposal not found.`);
      return;
    }
    await sendMessage(chatId, `Approved ${record.id}.`);
    const results = await executeApprovedActions(record.actions);
    await sendMessage(
      chatId,
      await formatExecutionResults(record.id, record.requestText, results),
    );
    return;
  }

  const denyMatch = data.match(/^deny:([A-Za-z0-9-]+)$/i);
  if (denyMatch) {
    const id = denyMatch[1];
    const record = decideActionProposal(id, 'denied');
    if (!record) {
      const existing = getActionProposalById(id);
      if (existing && existing.status === 'denied') {
        await sendMessage(chatId, `Proposal ${id} is already denied.`);
        return;
      }
      if (existing && existing.status === 'approved') {
        await sendMessage(chatId, `Proposal ${id} is already approved.`);
        return;
      }
      await sendMessage(chatId, `Could not deny ${id}. Proposal not found.`);
      return;
    }
    await sendMessage(chatId, `Denied ${record.id}.`);
    return;
  }

  const reasonMatch = data.match(/^reason:([A-Za-z0-9-]+)$/i);
  if (reasonMatch) {
    const id = reasonMatch[1];
    await sendMessage(chatId, `Send your reason with: /deny ${id} <your reason>`);
  }
}

function stripPlanBlock(text: string): string {
  return text.replace(/```(?:json)?\s*[\s\S]*?```/i, '').trim();
}

function stripPlainPlanJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const candidate = trimmed.replace(/^json\s*/i, '').trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(candidate) as { actions?: unknown };
    if (Array.isArray(parsed.actions)) {
      return '';
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

function buildPlanRepairPrompt(): string {
  return (
    'The previous response did not include a valid JSON plan block. ' +
    'Please reply with ONLY the fenced JSON plan block that matches the schema below; do not include any additional prose.\n\n' +
    PLAN_SCHEMA_DESCRIPTION
  );
}

interface AgentResponse {
  reply: string;
  plan: Plan;
  planErrors: string[];
  newSessionId?: string;
}

function extractUrlCandidate(text: string): string | null {
  const urlMatch = text.match(/\bhttps?:\/\/[^\s)]+/i);
  if (urlMatch) return urlMatch[0];

  const bareDomain = text.match(/\b([a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i);
  if (!bareDomain) return null;
  return `https://${bareDomain[0]}`;
}

function inferWebFetchMode(text: string, url?: string): 'http' | 'browser' {
  const browserDomains = ['resy.com', 'aoty.org', 'nytimes.com', 'instagram.com'];
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (browserDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
        return 'browser';
      }
    } catch {
      // ignore
    }
  }
  if (/\b(open|browse|website|site)\b/i.test(text)) {
    return 'browser';
  }
  return 'http';
}

function buildFallbackWebFetchAction(userText: string): Extract<Plan['actions'][number], { type: 'web_fetch' }> | null {
  const url = extractUrlCandidate(userText);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }

  const mode = inferWebFetchMode(userText, url);
  return {
    type: 'web_fetch',
    url,
    mode,
    requiresApproval: true,
    reason: 'User requested web content retrieval and summary.',
  };
}

function resolveFreeModel(model: string | undefined): string | null {
  const candidate = (model || '').trim();
  if (!candidate) return 'google/gemma-3-27b-it:free';
  if (candidate === 'openrouter/free' || candidate.includes(':free')) {
    return candidate;
  }
  return null;
}

async function runDirectFallbackAgent(prompt: string): Promise<string | null> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) return null;
  const model = resolveFreeModel(process.env.COMPLETION_MODEL);
  if (!model) {
    return (
      'Planner configuration error: COMPLETION_MODEL must be an OpenRouter free model ' +
      '(for example `google/gemma-3-27b-it:free`).'
    );
  }

  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const guidance =
    'You are the assistant speaking directly to the user. ' +
    'Do not mention transport metadata. Respond concisely, then include a fenced JSON block: ```json { \"actions\": [] } ```.';

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `${guidance}\n\nUser message:\n${prompt}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      logger.warn(
        { status: resp.status, errorText },
        'Direct fallback agent request failed',
      );
      if (/Free model publication/i.test(errorText)) {
        return (
          'OpenRouter blocked this free-model request due to account privacy policy. ' +
          'Enable Free model publication in https://openrouter.ai/settings/privacy and retry.'
        );
      }
      return null;
    }

    const data = (await resp.json()) as {
      content?: Array<{ text?: string }>;
    };
    const text = data.content?.map((c) => c.text || '').join('\n').trim();
    return text || null;
  } catch (err) {
    logger.warn({ err }, 'Direct fallback agent request errored');
    return null;
  }
}

async function runDirectSummaryAgent(prompt: string): Promise<string | null> {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) return null;

  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const preferred = resolveFreeModel(process.env.COMPLETION_MODEL) || 'google/gemma-3-27b-it:free';
  const candidates = [...new Set([
    preferred,
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
  ])];

  for (const model of candidates) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1100,
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!resp.ok) {
        continue;
      }

      const data = (await resp.json()) as {
        content?: Array<{ text?: string }>;
      };
      const text = data.content?.map((c) => c.text || '').join('\n').trim();
      if (!text) continue;
      if (isWeakWebSummary(text)) continue;
      return text;
    } catch {
      continue;
    }
  }
  return null;
}

function isWeakWebSummary(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    lower.includes("can't access external websites") ||
    lower.includes('cannot access external websites') ||
    lower.includes('provide the content') ||
    lower.includes('unable to retrieve data')
  ) {
    return true;
  }
  if (text.length < 90) return true;
  return false;
}

async function runDirectPlanRepair(): Promise<Plan | null> {
  const directReply = await runDirectFallbackAgent(buildPlanRepairPrompt());
  if (!directReply) return null;
  const parsed = parsePlanFromText(directReply);
  return parsed.plan;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
): Promise<AgentResponse | null> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  let sessionId: string | undefined = sessions[group.folder];
  if (sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    logger.warn(
      { group: group.name, sessionId },
      'Ignoring non-UUID session id for Claude Code resume',
    );
    sessionId = undefined;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  try {
    const invokeAgent = (resumeSessionId?: string) =>
      runContainerAgent(group, {
        prompt,
        sessionId: resumeSessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
      });

    let output = await invokeAgent(sessionId);

    // Bad/expired resume sessions can cause immediate Claude SDK exits.
    // If resume fails, retry once with a fresh session.
    if (output.status === 'error' && sessionId) {
      logger.warn(
        { group: group.name, sessionId, error: output.error },
        'Agent run failed with resumed session, retrying without session',
      );
      delete sessions[group.folder];
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
      output = await invokeAgent(undefined);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      const directReply = await runDirectFallbackAgent(prompt);
      if (!directReply) {
        return null;
      }
      const directParse = parsePlanFromText(directReply);
      let directPlan = directParse.plan ?? EMPTY_PLAN;
      let directErrors = [...directParse.errors];
      if (!directParse.plan) {
        const repairedPlan = await runDirectPlanRepair();
        if (repairedPlan) {
          directPlan = repairedPlan;
          directErrors = [];
        }
      }
      return {
        reply: stripPlanBlock(directReply),
        plan: directPlan,
        planErrors: directErrors,
        newSessionId: sessionId,
      };
    }

    let finalSessionId = output.newSessionId ?? sessionId;
    let rawReply = output.result || '';
    if (
      !rawReply.trim() ||
      rawReply.includes('I could not generate a complete answer. Please retry.')
    ) {
      const directReply = await runDirectFallbackAgent(prompt);
      if (directReply) {
        rawReply = directReply;
      }
    }
    const replyText = stripPlanBlock(rawReply);

    const firstParse = parsePlanFromText(rawReply);
    let plan = firstParse.plan ?? EMPTY_PLAN;
    let planErrors = [...firstParse.errors];

    if (!firstParse.plan) {
      logger.warn(
        { group: group.name, errors: firstParse.errors },
        'Invalid or missing plan block from agent, requesting JSON-only repair',
      );

      const repairOutput = await runContainerAgent(group, {
        prompt: buildPlanRepairPrompt(),
        sessionId: finalSessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
      });

      finalSessionId = repairOutput.newSessionId ?? finalSessionId;

      if (repairOutput.status === 'success' && repairOutput.result) {
        const repairedParse = parsePlanFromText(repairOutput.result);
        if (repairedParse.plan) {
          plan = repairedParse.plan;
        } else {
          planErrors = planErrors.concat(repairedParse.errors);
        }
      } else {
        planErrors.push(
          repairOutput.error || 'Plan repair request failed unexpectedly',
        );
        const directPlan = await runDirectPlanRepair();
        if (directPlan) {
          plan = directPlan;
          planErrors = [];
        }
      }
    }

    if (finalSessionId) {
      sessions[group.folder] = finalSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    return {
      reply: replyText,
      plan,
      planErrors,
      newSessionId: finalSessionId,
    };
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return null;
  }
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  try {
    await telegramClient.sendMessage(chatId, text);
    logger.info({ chatId, length: text.length }, 'Message sent');
  } catch (err) {
    logger.error({ chatId, err }, 'Failed to send message');
  }
}

function startIpcWatcher(): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await sendMessage(
                    data.chatJid,
                    data.text,
                  );
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
): Promise<void> {
  // Import db functions dynamically to avoid circular deps
  const {
    createTask,
    updateTask,
    deleteTask,
    getTaskById: getTask,
  } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.groupFolder
      ) {
        // Authorization: non-main groups can only schedule for themselves
        const targetGroup = data.groupFolder;
        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetGroup },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        // Resolve the correct chat ID for the target group (don't trust IPC payload)
        const targetChatId = Object.entries(registeredGroups).find(
          ([, group]) => group.folder === targetGroup,
        )?.[0];

        if (!targetChatId) {
          logger.warn(
            { targetGroup },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetGroup,
          chat_jid: targetChatId,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetGroup, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = getAvailableGroups();
        const { writeGroupsSnapshot: writeGroups } =
          await import('./container-runner.js');
        writeGroups(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

async function connectTelegram(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) {
    logger.error(
      'TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID environment variables must be set',
    );
    process.exit(1);
  }

  telegramClient = new TelegramClient({
    token: TELEGRAM_BOT_TOKEN,
    adminChatId: TELEGRAM_ADMIN_CHAT_ID,
  });

  logger.info(
    { enabled: ENABLE_APPROVED_EXECUTION },
    'Approved action dispatch mode',
  );

  // Register message handler
  telegramClient.onMessage(async (chatId, text, from, timestamp) => {
    const handledApproval = await handleApprovalCommand(chatId, text);
    if (handledApproval) {
      return;
    }

    // Store chat metadata for discovery
    storeChatMetadata(chatId, timestamp.toISOString());

    // Only store full message content for registered groups
    if (registeredGroups[chatId]) {
      // Create a message object compatible with storeMessage
      // storeMessage expects a WhatsApp proto message, but we can provide minimal data
      const messageData = {
        key: {
          remoteJid: chatId,
          fromMe: false,
          id: `telegram-${chatId}-${timestamp.getTime()}`,
        },
        message: {
          conversation: text,
        },
        messageTimestamp: Math.floor(timestamp.getTime() / 1000),
        pushName: from,
      };

      storeMessage(messageData as any, chatId, false, from);
    }
  });

  telegramClient.onCallbackQuery(async (chatId, data) => {
    await handleApprovalCallback(chatId, data);
  });

  // Sync group metadata on startup
  await syncGroupMetadata().catch((err) =>
    logger.error({ err }, 'Initial group sync failed'),
  );

  // Set up daily sync timer (only once)
  if (!groupSyncTimerStarted) {
    groupSyncTimerStarted = true;
    setInterval(() => {
      syncGroupMetadata().catch((err) =>
        logger.error({ err }, 'Periodic group sync failed'),
      );
    }, GROUP_SYNC_INTERVAL_MS);
  }

  startSchedulerLoop({
    sendMessage,
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
  });

  startIpcWatcher();
  startMessageLoop();

  logger.info('Connected to Telegram');
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;
  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const chatIds = Object.keys(registeredGroups);
      const { messages } = getNewMessages(chatIds, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0)
        logger.info({ count: messages.length }, 'New messages');
      for (const msg of messages) {
        try {
          await processMessage(msg);
          // Only advance timestamp after successful processing for at-least-once delivery
          lastTimestamp = msg.timestamp;
          saveState();
        } catch (err) {
          logger.error(
            { err, msg: msg.id },
            'Error processing message, will retry',
          );
          // Stop processing this batch - failed message will be retried next loop
          break;
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

function ensureDockerRunning(): void {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 10000 });
    logger.debug('Docker daemon is running');
  } catch {
    logger.error('Docker daemon is not running');
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║  FATAL: Docker is not running                                  ║');
    console.error('║                                                                ║');
    console.error('║  Agents cannot run without Docker. To fix:                     ║');
    console.error('║  macOS: Start Docker Desktop                                   ║');
    console.error('║  Linux: sudo systemctl start docker                            ║');
    console.error('║                                                                ║');
    console.error('║  Install from: https://docker.com/products/docker-desktop      ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');
    throw new Error('Docker is required but not running');
  }

  // Clean up stopped NanoClaw containers from previous runs
  try {
    const output = execSync('docker ps -a --format {{.Names}}', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const stale = output
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.startsWith('nanoclaw-'));
    if (stale.length > 0) {
      execSync(`docker rm ${stale.join(' ')}`, { stdio: 'pipe' });
      logger.info({ count: stale.length }, 'Cleaned up stopped containers');
    }
  } catch {
    // No stopped containers or ls/rm not supported
  }
}

async function main(): Promise<void> {
  ensureDockerRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  await connectTelegram();
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start NanoClaw');
  process.exit(1);
});
