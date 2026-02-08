import fs from 'fs';
import path from 'path';
import {
  OBSIDIAN_MEMORY_CACHE_MS,
  OBSIDIAN_MEMORY_MAX_FILES,
} from './config.js';

type IndexedFile = {
  file: string;
  rel: string;
  mtimeMs: number;
  size: number;
};

type FileContentCache = {
  mtimeMs: number;
  text: string;
  tokens: Set<string>;
};

type IndexCache = {
  key: string;
  createdAt: number;
  files: IndexedFile[];
};

let indexCache: IndexCache | null = null;
const contentCache = new Map<string, FileContentCache>();
const MAX_SCAN_DEPTH = 8;
const MAX_FILE_BYTES = 1024 * 1024; // 1MB cap to keep retrieval fast and predictable.
const MAX_SNIPPETS_LIMIT = 20;
const MAX_SNIPPET_CHARS_LIMIT = 4000;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function toTokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

function scoreTokenOverlap(queryTokens: Set<string>, tokens: Set<string>): number {
  if (queryTokens.size === 0 || tokens.size === 0) return 0;
  let score = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) score += 2;
  }
  return score;
}

function scoreFilename(queryTokens: Set<string>, filename: string): number {
  const tokens = toTokenSet(filename);
  let score = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) score += 1;
  }
  return score;
}

function listMarkdownFiles(
  dir: string,
  root: string,
  maxFiles: number,
  maxDepth: number,
  depth: number,
  results: IndexedFile[],
): void {
  if (results.length >= maxFiles) return;
  if (depth > maxDepth) return;
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (results.length >= maxFiles) return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listMarkdownFiles(
        fullPath,
        root,
        maxFiles,
        maxDepth,
        depth + 1,
        results,
      );
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        results.push({
          file: fullPath,
          rel: path.relative(root, fullPath),
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      } catch {
        // Ignore unreadable files.
      }
    }
  }
}

function excerpt(text: string, maxChars: number, queryTokens: Set<string>): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;

  let matchPos = -1;
  for (const token of queryTokens) {
    const idx = cleaned.toLowerCase().indexOf(token);
    if (idx !== -1 && (matchPos === -1 || idx < matchPos)) {
      matchPos = idx;
    }
  }

  if (matchPos === -1) {
    return `${cleaned.slice(0, maxChars)}...`;
  }

  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, matchPos - half);
  const end = Math.min(cleaned.length, start + maxChars);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < cleaned.length ? '...' : '';
  return `${prefix}${cleaned.slice(start, end)}${suffix}`;
}

function getCachedIndex(
  vaultPath: string,
  memoryDirs: string[],
  maxFiles: number,
  cacheMs: number,
): IndexedFile[] {
  const key = `${vaultPath}::${memoryDirs.join(',')}::${maxFiles}`;
  const now = Date.now();
  if (indexCache && indexCache.key === key && now - indexCache.createdAt < cacheMs) {
    return indexCache.files;
  }

  const files: IndexedFile[] = [];
  for (const dir of memoryDirs) {
    listMarkdownFiles(dir, vaultPath, maxFiles, MAX_SCAN_DEPTH, 0, files);
    if (files.length >= maxFiles) break;
  }

  indexCache = { key, createdAt: now, files };
  return files;
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveMemoryDirs(vaultPath: string, memoryDirs: string[]): string[] {
  const resolvedVault = path.resolve(vaultPath);
  const safeDirs = new Set<string>();

  for (const rawDir of memoryDirs) {
    const trimmed = rawDir.trim();
    if (!trimmed) continue;
    const resolvedDir = path.resolve(resolvedVault, trimmed);
    if (!isPathInside(resolvedVault, resolvedDir)) continue;
    safeDirs.add(resolvedDir);
  }

  return Array.from(safeDirs).sort((a, b) => a.localeCompare(b));
}

function seemsBinary(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, Math.min(buffer.length, 4096));
  return probe.includes(0);
}

function getContentAndTokens(file: IndexedFile): { text: string; tokens: Set<string> } | null {
  const cached = contentCache.get(file.file);
  if (cached && cached.mtimeMs === file.mtimeMs) {
    return { text: cached.text, tokens: cached.tokens };
  }

  try {
    if (file.size > MAX_FILE_BYTES) return null;
    const raw = fs.readFileSync(file.file);
    if (seemsBinary(raw)) return null;
    const text = raw.toString('utf-8');
    const tokens = toTokenSet(text);
    contentCache.set(file.file, { mtimeMs: file.mtimeMs, text, tokens });
    return { text, tokens };
  } catch {
    return null;
  }
}

function recencyBoost(mtimeMs: number): number {
  const days = Math.max(0, (Date.now() - mtimeMs) / (24 * 60 * 60 * 1000));
  if (days <= 1) return 3;
  if (days <= 7) return 2;
  if (days <= 30) return 1;
  return 0;
}

export function buildObsidianMemoryHeader(opts: {
  vaultPath: string;
  memoryDirs: string[];
  query: string;
  maxSnippets: number;
  maxChars: number;
}): string {
  const { vaultPath, memoryDirs, query, maxSnippets, maxChars } = opts;
  if (!vaultPath || memoryDirs.length === 0) return '';
  const safeMaxSnippets = Math.max(1, Math.min(maxSnippets, MAX_SNIPPETS_LIMIT));
  const safeMaxChars = Math.max(1, Math.min(maxChars, MAX_SNIPPET_CHARS_LIMIT));
  const resolvedVault = path.resolve(vaultPath);
  const safeMemoryDirs = resolveMemoryDirs(resolvedVault, memoryDirs);
  if (safeMemoryDirs.length === 0) return '';

  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return '';

  const files = getCachedIndex(
    resolvedVault,
    safeMemoryDirs,
    OBSIDIAN_MEMORY_MAX_FILES,
    OBSIDIAN_MEMORY_CACHE_MS,
  );

  const scored: Array<{ file: string; rel: string; score: number; snippet: string }> = [];
  for (const file of files) {
    const content = getContentAndTokens(file);
    if (!content) continue;
    const tokenScore = scoreTokenOverlap(queryTokens, content.tokens);
    const filenameScore = scoreFilename(queryTokens, file.rel);
    const relevanceScore = tokenScore + filenameScore;
    if (relevanceScore <= 0) continue;
    const score = relevanceScore + recencyBoost(file.mtimeMs);
    if (score > 0) {
      scored.push({
        file: file.file,
        rel: file.rel,
        score,
        snippet: excerpt(content.text, safeMaxChars, queryTokens),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  const top = scored.slice(0, safeMaxSnippets);
  if (top.length === 0) return '';

  const lines = top.map((item) => {
    return `- ${item.rel}: ${item.snippet}`;
  });

  return `Memory Context (from Obsidian, for your internal use only; do not mention unless asked):\n${lines.join('\n')}\n\n`;
}
