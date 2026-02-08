#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ALLOWED_TYPES = new Set([
  'capability',
  'integration',
  'workflow',
  'ops',
  'knowledge',
  'other',
]);

const REQUIRED_SECTIONS = [
  'Name',
  'Purpose',
  'What It Changes',
  'Required Environment Variables',
  'Install',
  'Safety Notes',
];

function normalizeHeading(heading) {
  return heading.trim().toLowerCase();
}

function parseSections(markdown) {
  const sections = new Map();
  let current = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      current = normalizeHeading(match[1]);
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) {
      sections.get(current).push(rawLine);
    }
  }
  return sections;
}

function sectionContent(lines) {
  return lines.join('\n').trim();
}

function extractBacktickedValue(text) {
  const match = /`([^`]+)`/.exec(text);
  return match ? match[1].trim() : '';
}

function validateEnvExample(envPath, errors) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [key] = line.split('=', 1);
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push(`Invalid env key in env.example: "${rawLine}"`);
    }
  }
}

function validateManifest(addonDir, errors) {
  const manifestPath = path.join(addonDir, 'addon.json');
  const folderName = path.basename(addonDir);
  if (!fs.existsSync(manifestPath)) {
    errors.push('addon.json missing');
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    errors.push(`addon.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const required = ['schemaVersion', 'name', 'title', 'description', 'type', 'version', 'entrypoints'];
  for (const field of required) {
    if (!(field in manifest)) {
      errors.push(`addon.json missing required field: ${field}`);
    }
  }

  if (manifest.schemaVersion !== 1) {
    errors.push('addon.json schemaVersion must be 1');
  }

  if (typeof manifest.name !== 'string' || !NAME_RE.test(manifest.name)) {
    errors.push('addon.json name must match ^[a-z0-9][a-z0-9-]{0,63}$');
  } else if (manifest.name !== folderName) {
    errors.push(`addon.json name must match folder name ("${folderName}")`);
  }

  if (typeof manifest.title !== 'string' || manifest.title.trim().length < 3) {
    errors.push('addon.json title must be a non-empty string');
  }

  if (typeof manifest.description !== 'string' || manifest.description.trim().length < 10) {
    errors.push('addon.json description must be at least 10 characters');
  }

  if (!ALLOWED_TYPES.has(manifest.type)) {
    errors.push(`addon.json type must be one of: ${Array.from(ALLOWED_TYPES).join(', ')}`);
  }

  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    errors.push('addon.json version must be semver (e.g. 1.0.0)');
  }

  if (typeof manifest.requiresApprovalByDefault !== 'boolean') {
    errors.push('addon.json requiresApprovalByDefault must be boolean');
  }

  const entrypoints = manifest.entrypoints;
  if (typeof entrypoints !== 'object' || !entrypoints) {
    errors.push('addon.json entrypoints must be an object');
  } else {
    if (typeof entrypoints.install !== 'string' || entrypoints.install.trim().length === 0) {
      errors.push('addon.json entrypoints.install must be a non-empty string');
    } else {
      const installPath = path.join(addonDir, entrypoints.install);
      if (!fs.existsSync(installPath)) {
        errors.push(`entrypoints.install file missing: ${entrypoints.install}`);
      }
    }

    if (entrypoints.docs && typeof entrypoints.docs !== 'string') {
      errors.push('addon.json entrypoints.docs must be a string when provided');
    } else if (typeof entrypoints.docs === 'string') {
      const docsPath = path.join(addonDir, entrypoints.docs);
      if (!fs.existsSync(docsPath)) {
        errors.push(`entrypoints.docs file missing: ${entrypoints.docs}`);
      }
    }

    if (entrypoints.envExample && typeof entrypoints.envExample !== 'string') {
      errors.push('addon.json entrypoints.envExample must be a string when provided');
    } else if (typeof entrypoints.envExample === 'string') {
      const envPath = path.join(addonDir, entrypoints.envExample);
      if (!fs.existsSync(envPath)) {
        errors.push(`entrypoints.envExample file missing: ${entrypoints.envExample}`);
      }
    }

    if (entrypoints.run && typeof entrypoints.run !== 'string') {
      errors.push('addon.json entrypoints.run must be a string when provided');
    } else if (typeof entrypoints.run === 'string') {
      const runPath = path.join(addonDir, entrypoints.run);
      if (!fs.existsSync(runPath)) {
        errors.push(`entrypoints.run file missing: ${entrypoints.run}`);
      }
    }
  }

  if (manifest.env !== undefined) {
    if (!Array.isArray(manifest.env)) {
      errors.push('addon.json env must be an array when provided');
    } else {
      for (const item of manifest.env) {
        if (typeof item !== 'object' || !item) {
          errors.push('addon.json env entries must be objects');
          continue;
        }
        if (typeof item.key !== 'string' || !ENV_KEY_RE.test(item.key)) {
          errors.push(`addon.json env key is invalid: ${String(item.key)}`);
        }
        if (typeof item.required !== 'boolean') {
          errors.push(`addon.json env "${String(item.key)}" required must be boolean`);
        }
      }
    }
  }

  if (manifest.capabilities !== undefined && !Array.isArray(manifest.capabilities)) {
    errors.push('addon.json capabilities must be an array when provided');
  }
}

export function validateAddonDir(addonDir) {
  const errors = [];
  const resolved = path.resolve(addonDir);
  const addonMdPath = path.join(resolved, 'ADDON.md');

  validateManifest(resolved, errors);

  if (!fs.existsSync(addonMdPath)) {
    errors.push('ADDON.md missing');
    return { ok: false, errors };
  }

  const addonMd = fs.readFileSync(addonMdPath, 'utf8');
  const sections = parseSections(addonMd);

  for (const section of REQUIRED_SECTIONS) {
    const key = normalizeHeading(section);
    const lines = sections.get(key);
    if (!lines) {
      errors.push(`Missing section: "${section}"`);
      continue;
    }
    if (!sectionContent(lines)) {
      errors.push(`Section "${section}" is empty`);
    }
  }

  const nameLines = sections.get('name');
  if (nameLines) {
    const nameValue = extractBacktickedValue(sectionContent(nameLines));
    if (!nameValue) {
      errors.push('Name section must include backticked addon name');
    } else if (nameValue !== path.basename(resolved)) {
      errors.push(`Name section must match folder name ("${path.basename(resolved)}")`);
    }
  }

  validateEnvExample(path.join(resolved, 'env.example'), errors);

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const addonDir = process.argv[2];
  if (!addonDir) {
    console.error('Usage: addon-validate <addon-dir>');
    process.exit(1);
  }
  const result = validateAddonDir(addonDir);
  if (!result.ok) {
    console.error('Addon schema validation failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
}

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  runCli();
}
