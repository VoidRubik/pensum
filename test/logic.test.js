// node --test test/logic.test.js — zero deps, pure-function coverage for Phase 1.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

// --- Phase 2 rules ---
const { isStale, nudgeDue, summarizeUsage, nextInterval } = require('../logic.js');

test('isStale: epoch or idx mismatch drops the verdict', () => {
  assert.equal(isStale({ idx: 1, epoch: 2 }, { idx: 1, epoch: 2 }), false);
  assert.equal(isStale({ idx: 1, epoch: 1 }, { idx: 1, epoch: 2 }), true);
  assert.equal(isStale({ idx: 0, epoch: 2 }, { idx: 1, epoch: 2 }), true);
});

const MIN = 60000;
test('nudgeDue: 8-min window never gets the 10-min nudge', () => {
  const startedAt = 0, deadline = 8 * MIN;
  const r = nudgeDue({ startedAt, deadline, now: 7 * MIN, progress: 0, fired: [] });
  assert.notEqual(r.speak, '10min');
});

test('nudgeDue: 30-min window, 0% progress speaks the 10-min-left nudge at 20:00 elapsed', () => {
  const r = nudgeDue({ startedAt: 0, deadline: 30 * MIN, now: 20 * MIN, progress: 0, fired: [] });
  assert.equal(r.speak, 'left10');
});

test('nudgeDue: crossed checkpoints all marked fired, only latest spoken, once', () => {
  const args = { startedAt: 0, deadline: 100 * MIN, now: 80 * MIN, progress: 0, fired: [] };
  const r = nudgeDue(args);
  assert.equal(r.speak, '25');
  assert.deepEqual(r.fired.sort(), ['25', '50']);
  const again = nudgeDue({ ...args, fired: r.fired });
  assert.equal(again.speak, null);
});

test('nudgeDue: silent when ahead of schedule', () => {
  const r = nudgeDue({ startedAt: 0, deadline: 100 * MIN, now: 55 * MIN, progress: 0.9, fired: [] });
  assert.equal(r.speak, null);
  assert.deepEqual(r.fired, ['50']);
});

test('nudgeDue: invalid window -> nothing', () => {
  assert.equal(nudgeDue({ startedAt: 5, deadline: 5, now: 9, progress: 0, fired: [] }).speak, null);
  assert.equal(nudgeDue({ startedAt: NaN, deadline: 5, now: 9, progress: 0, fired: [] }).speak, null);
});

test('summarizeUsage: counts only today, checks = check calls, tokens summed', () => {
  const day = (h) => new Date(2026, 8, 28, h).getTime();
  const lines = [
    { ts: day(9), kind: 'check', auto: true, promptTokens: 100, outputTokens: 10 },
    { ts: day(10), kind: 'check', auto: false, promptTokens: 50, outputTokens: 5, thoughtsTokens: 5 },
    { ts: day(11), kind: 'quests', promptTokens: 20, outputTokens: 20 },
    { ts: new Date(2026, 8, 27, 23).getTime(), kind: 'check', auto: true, promptTokens: 999, outputTokens: 1 },
  ];
  const s = summarizeUsage(lines, '2026-09-28');
  assert.equal(s.checks, 2);
  assert.equal(s.autoChecks, 1);
  assert.equal(s.tokens, 210);
});

test('nextInterval: 429 per-day stops, per-minute backs off (>=2x, cap 15min), else base', () => {
  assert.equal(nextInterval(180000, {}), 180000);
  assert.equal(nextInterval(180000, { status: 429, perDay: true }), null);
  assert.equal(nextInterval(180000, { status: 429, retryDelayMs: 1000 }), 360000);
  assert.equal(nextInterval(180000, { status: 429, retryDelayMs: 500000 }), 500000);
  assert.equal(nextInterval(180000, { status: 429, retryDelayMs: 9e9 }), 900000);
});

// --- v3: propose + confirm ---

test('doneStep is gone (auto-complete replaced by proposals)', () => {
  assert.equal(L.doneStep, undefined);
});

test('proposeStep: quest_done on an unsuppressed quest proposes it', () => {
  const r = L.proposeStep({ suppress: {} }, { idx: 1, questDone: true, auto: true });
  assert.equal(r.propose, true);
});

test('proposeStep: not quest_done never proposes', () => {
  assert.equal(L.proposeStep({ suppress: {} }, { idx: 1, questDone: false, auto: true }).propose, false);
});

test('proposeStep: notYet suppresses the next 2 auto checks for that quest only', () => {
  let st = L.notYet({ suppress: {} }, 1);
  let r = L.proposeStep(st, { idx: 1, questDone: true, auto: true });
  assert.equal(r.propose, false);
  assert.equal(L.proposeStep(r.state, { idx: 2, questDone: true, auto: true }).propose, true, 'other quest unaffected');
  r = L.proposeStep(r.state, { idx: 1, questDone: true, auto: true });
  assert.equal(r.propose, false);
  r = L.proposeStep(r.state, { idx: 1, questDone: true, auto: true });
  assert.equal(r.propose, true, 'third auto check proposes again');
});

test('proposeStep: manual checks do not use up suppression', () => {
  let st = L.notYet({ suppress: {} }, 0);
  let r = L.proposeStep(st, { idx: 0, questDone: true, auto: false });
  assert.equal(r.propose, false);
  assert.equal(r.state.suppress[0], 2);
});

test('currentIdx: explicit current if not done, else first not-done, -1 when all done', () => {
  assert.equal(L.currentIdx({ current: 2, done: [false, false, false] }), 2);
  assert.equal(L.currentIdx({ current: 2, done: [false, false, true] }), 0);
  assert.equal(L.currentIdx({ current: null, done: [true, false, false] }), 1);
  assert.equal(L.currentIdx({ current: 0, done: [true, true] }), -1);
});

// --- v3: signals ---

test('redactTitle: drops private browsing, password managers, banking words', () => {
  assert.equal(L.redactTitle('chrome', 'News - Incognito'), null);
  assert.equal(L.redactTitle('msedge', 'Docs [InPrivate]'), null);
  assert.equal(L.redactTitle('KeePass', 'Database'), null);
  assert.equal(L.redactTitle('chrome', 'Mi banco - Inicio'), null);
  assert.equal(L.redactTitle('WINWORD', 'Essay.docx - Word'), 'Essay.docx - Word');
});

test('focusSummary: clips to [since, now], sums per window, longest first', () => {
  const ev = [
    { ts: 0, process: 'chrome', title: 'YouTube' },
    { ts: 100000, process: 'WINWORD', title: 'Essay.docx' },
    { ts: 260000, process: 'chrome', title: 'YouTube' },
  ];
  const s = L.focusSummary(ev, 90000, 280000);
  assert.equal(s, "WINWORD 'Essay.docx' 2m40s · chrome 'YouTube' 30s");
});

test('focusSummary: titles off sends process name only; empty when no events', () => {
  const ev = [{ ts: 0, process: 'WINWORD', title: 'Secret.docx' }];
  assert.equal(L.focusSummary(ev, 0, 60000, { titles: false }), 'WINWORD 1m');
  assert.equal(L.focusSummary([], 0, 60000), '');
});

test('shouldSkip: locked, or idle >= max(interval, 5 min)', () => {
  assert.equal(L.shouldSkip(0, true, 180000), true);
  assert.equal(L.shouldSkip(299, false, 180000), false);
  assert.equal(L.shouldSkip(300, false, 180000), true);
  assert.equal(L.shouldSkip(300, false, 600000), false, 'interval longer than 5 min raises the bar');
});

test('artifactDigest: word count, markdown headings, last 800 chars', () => {
  const text = '# Title\nintro words here\n## Part two\n' + 'x'.repeat(1000);
  const d = L.artifactDigest(text);
  assert.equal(d.words, 9);
  assert.deepEqual(d.headings, ['# Title', '## Part two']);
  assert.equal(d.tail.length, 800);
  assert.deepEqual(L.artifactDigest(''), { words: 0, headings: [], tail: '' });
});

// --- review fix: long documents keep their head AND their tail ---

test('capMiddle: short text untouched; long text keeps head + tail, so "where it stopped" survives', () => {
  assert.equal(L.capMiddle('short', 100), 'short');
  const t = 'H'.repeat(50) + 'M'.repeat(1000) + 'T'.repeat(50);
  const c = L.capMiddle(t, 100);
  assert.ok(c.length <= 100 + 60, String(c.length));
  assert.ok(c.startsWith('H'.repeat(20)));
  assert.ok(c.endsWith('T'.repeat(50)), 'the end of the document must be kept');
});

test('summarizeUsage: calls counts every model kind so the daily cap trips', () => {
  const t = new Date(2026, 8, 28, 9).getTime();
  const lines = [{ ts: t, kind: 'quests' }, { ts: t, kind: 'look:stuck' }, { ts: t, kind: 'look:check', auto: true }, { ts: t, kind: 'check' }];
  const s = summarizeUsage(lines, '2026-09-28');
  assert.equal(s.calls, 4);
});

test('rateGate: allows perMin calls inside 60 s, blocks the next with a retry time, frees after the window', () => {
  let stamps = [];
  for (let i = 0; i < 3; i++) {
    const r = L.rateGate(stamps, 1000 + i, { perMin: 3 });
    assert.equal(r.ok, true);
    stamps = r.stamps;
  }
  const blocked = L.rateGate(stamps, 5000, { perMin: 3 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryMs, 1000 + 60000 - 5000);
  assert.equal(blocked.stamps.length, 3, 'a blocked call is not recorded');
  assert.equal(L.rateGate(stamps, 1000 + 60001, { perMin: 3 }).ok, true);
});
