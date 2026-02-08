import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIntentFormatterRules,
  detectWebIntent,
  isLowQualityWebAnswer,
} from '../src/web-summary.js';

test('detectWebIntent classifies ranking request', () => {
  const intent = detectWebIntent(
    'Can you summarize the best new albums on aoty?',
    'https://aoty.org',
  );
  assert.equal(intent, 'ranking');
});

test('detectWebIntent classifies restaurant request', () => {
  const intent = detectWebIntent(
    'Summarize this restaurant page and booking info',
    'https://resy.com/cities/new-york-ny/venues/i-cavallini',
  );
  assert.equal(intent, 'restaurant');
});

test('formatter rules include ranking structure', () => {
  const rules = buildIntentFormatterRules('ranking');
  assert.match(rules, /Top Items/);
  assert.match(rules, /Quick Take/);
});

test('isLowQualityWebAnswer rejects short ranking list', () => {
  const low = isLowQualityWebAnswer(
    '1. Album A\n2. Album B\n3. Album C',
    'ranking',
  );
  assert.equal(low, true);
});

test('isLowQualityWebAnswer accepts structured restaurant answer', () => {
  const answer = [
    '### What It Is',
    '- I Cavallini is a seasonal Italian-leaning restaurant in Williamsburg.',
    '### What To Know',
    '- The page emphasizes bookings through Resy and high demand.',
    '### Booking Notes',
    '- Check evening inventory early and monitor openings close to date.',
  ].join('\n');
  const low = isLowQualityWebAnswer(answer, 'restaurant');
  assert.equal(low, false);
});
