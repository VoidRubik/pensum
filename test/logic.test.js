// node --test test/logic.test.js — zero deps, pure-function coverage for Phase 1.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeProgress, validateVerdict, questFallback } = require('../logic.js');

// --- computeProgress ---

test('computeProgress: 0 quests done, 0% estimate on first of 4 quests', () => {
  const p = computeProgress({ questsDone: 0, total: 4, currentEstimate: 0 });
  assert.equal(p, 0);
});

test('computeProgress: 2 of 4 quests done, no partial estimate', () => {
  const p = computeProgress({ questsDone: 2, total: 4, currentEstimate: 0 });
  assert.equal(p, 0.5);
});

test('computeProgress: 2 of 4 done plus 50% into the current quest', () => {
  const p = computeProgress({ questsDone: 2, total: 4, currentEstimate: 50 });
  // (2 + 0.5) / 4 = 0.625
  assert.equal(p, 0.625);
});

test('computeProgress: all quests done is 1 regardless of estimate', () => {
  const p = computeProgress({ questsDone: 4, total: 4, currentEstimate: 100 });
  assert.equal(p, 1);
});

test('computeProgress: never moves backwards — clamps to previous when estimate regresses', () => {
  const first = computeProgress({ questsDone: 1, total: 4, currentEstimate: 80 });
  const second = computeProgress({ questsDone: 1, total: 4, currentEstimate: 20, previous: first });
  assert.equal(second, first);
});

test('computeProgress: rejects a total of 0 (division by zero)', () => {
  assert.throws(() => computeProgress({ questsDone: 0, total: 0, currentEstimate: 0 }));
});

// --- validateVerdict ---

test('validateVerdict: accepts a well-formed verdict', () => {
  const v = {
    on_task: true,
    quest_done: false,
    progress_estimate: 42,
    pet_line: 'good hop!',
    reason: 'code visible, editor focused',
  };
  assert.equal(validateVerdict(v), true);
});

test('validateVerdict: rejects malformed JSON — missing field', () => {
  const v = { on_task: true, quest_done: false, progress_estimate: 42, pet_line: 'hi' };
  assert.equal(validateVerdict(v), false);
});

test('validateVerdict: rejects wrong types', () => {
  const v = {
    on_task: 'yes',
    quest_done: false,
    progress_estimate: 42,
    pet_line: 'hi',
    reason: 'x',
  };
  assert.equal(validateVerdict(v), false);
});

test('validateVerdict: rejects progress_estimate out of 0-100 range', () => {
  const v = {
    on_task: true,
    quest_done: false,
    progress_estimate: 142,
    pet_line: 'hi',
    reason: 'x',
  };
  assert.equal(validateVerdict(v), false);
});

test('validateVerdict: rejects non-object input (e.g. a parse failure fallback)', () => {
  assert.equal(validateVerdict(null), false);
  assert.equal(validateVerdict('not json'), false);
  assert.equal(validateVerdict(undefined), false);
});

// --- questFallback ---

test('questFallback: returns exactly 3 generic quests with title + finish', () => {
  const qs = questFallback();
  assert.equal(qs.length, 3);
  for (const q of qs) {
    assert.equal(typeof q.title, 'string');
    assert.ok(q.title.length > 0);
    assert.equal(typeof q.finish, 'string');
    assert.ok(q.finish.length > 0);
  }
});
