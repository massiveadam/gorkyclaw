import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDON_REQUIRED_FIELDS,
  applyIndexedAnswers,
  applyIndexedAnswersToFields,
  extractAddonWizardData,
  missingAddonWizardFields,
  parseAddonName,
  parseIndexedAnswers,
} from '../src/addon-wizard.js';

test('parseAddonName accepts plain lowercase-hyphen value', () => {
  assert.equal(parseAddonName('squid-music-downloader'), 'squid-music-downloader');
});

test('parseAddonName supports "called <name>" phrasing', () => {
  assert.equal(
    parseAddonName('it should be called squid-music-downloader'),
    'squid-music-downloader',
  );
});

test('parseAddonName rejects stopword captures like "addon that"', () => {
  assert.equal(parseAddonName('create a new addon that downloads things'), undefined);
});

test('applyIndexedAnswers maps 1/2 lines to next missing fields', () => {
  const initial = {
    source: 'https://tidal.squid.wtf/',
  };
  const indexed = parseIndexedAnswers(
    '1. squid-music-downloader\n2. basic query by album title and download tracker',
  );
  const merged = applyIndexedAnswers(initial, indexed);
  assert.equal(merged.name, 'squid-music-downloader');
  assert.match(merged.purpose || '', /basic query/i);
});

test('parseIndexedAnswers supports compact inline numbered format', () => {
  const indexed = parseIndexedAnswers(
    '1 should need no auth, free site 2. downloader should run on willy ubuntu',
  );
  assert.match(indexed[1] || '', /no auth/i);
  assert.match(indexed[2] || '', /willy ubuntu/i);
});

test('parseIndexedAnswers does not split nested lists inside first answer', () => {
  const indexed = parseIndexedAnswers(
    '1. verification steps: 1 that album is found, 2 that album is downloaded, 3 moved, 4 imported',
  );
  assert.match(indexed[1] || '', /verification steps/i);
  assert.equal(indexed[2], undefined);
});

test('wizard fields stay domain-agnostic for varied addon intents', () => {
  const imageIntent = extractAddonWizardData(
    'Build a system for OCR on uploaded images and return extracted text.',
  );
  const codeIntent = extractAddonWizardData(
    'Create a workflow tool to run code analysis from URLs and summarize findings.',
  );

  assert.match(imageIntent.purpose || '', /ocr/i);
  assert.match(codeIntent.purpose || '', /workflow tool/i);

  const missingImage = missingAddonWizardFields(imageIntent);
  for (const field of ADDON_REQUIRED_FIELDS) {
    if (field === 'purpose') continue;
    assert.ok(missingImage.includes(field));
  }
});

test('indexed answers map to explicitly asked fields without clobbering purpose', () => {
  const state = {
    name: 'squid-music-downloader',
    purpose: 'Download albums and import to beets',
    inputs: 'Album title query',
    source: 'https://tidal.squid.wtf/',
    auth: 'none',
  };
  const asked: Array<'targetHost' | 'safety'> = ['targetHost', 'safety'];
  const indexed = parseIndexedAnswers(
    '1. downloader runs on willy-ubuntu\n2. require approval for writes; never delete existing music',
  );
  const merged = applyIndexedAnswersToFields(state, indexed, asked);
  assert.equal(merged.purpose, state.purpose);
  assert.equal(merged.targetHost, 'willy-ubuntu');
  assert.match(merged.safety || '', /never delete/i);
});
