// UI v2 logic: fit meter, pet busy/hopping, per-quest stats. Written before the code (watched failing first).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const MIN = 60000;
const q = (minutes, done = false) => ({ title: 't', finish: 'f', minutes, done });

// --- fit meter ---
test('fitSummary: open work vs time left, spare = left - work', () => {
  const now = 1_000_000;
  const r = L.fitSummary([q(4), q(15), q(20), q(15)], now + 130 * MIN, now);
  assert.equal(r.workMin, 54);
  assert.equal(r.leftMin, 130);
  assert.equal(r.spareMin, 76);
  assert.equal(r.short, false);
  assert.ok(Math.abs(r.ratio - 54 / 130) < 1e-9);
});
test('fitSummary: done quests are not work; negative spare = short', () => {
  const now = 0;
  const r = L.fitSummary([q(30, true), q(40), q(30)], now + 50 * MIN, now);
  assert.equal(r.workMin, 70);
  assert.equal(r.spareMin, -20);
  assert.equal(r.short, true);
  assert.equal(r.ratio, 1, 'the bar is full, never above 1');
});
test('fitSummary: past or unusable deadline never throws', () => {
  const past = L.fitSummary([q(10)], 0, 5 * MIN);
  assert.equal(past.leftMin, 0);
  assert.equal(past.short, true);
  const bad = L.fitSummary([q(10)], NaN, 5);
  assert.equal(bad.leftMin, null);
  assert.equal(bad.spareMin, null);
  assert.equal(bad.short, false);
  assert.equal(L.fitSummary([], 100 * MIN, 0).ratio, 0);
});
test('fmtMin: 54m, 1h 16m, 2h', () => {
  assert.equal(L.fmtMin(54), '54m');
  assert.equal(L.fmtMin(76), '1h 16m');
  assert.equal(L.fmtMin(120), '2h');
  assert.equal(L.fmtMin(0), '0m');
});

// --- pet: busy (quests being made) and hopping (quest just confirmed) ---
const base = { celebrating: false, looking: false, quietLook: false, cardKind: null, sessionOn: true, hasTask: true, breakMode: false, windowLost: false, away: false };
test('petStep: busy (making quests) -> thinking, even with no session and no task', () => {
  assert.equal(L.petStep({ ...base, busy: true, sessionOn: false, hasTask: false }), 'thinking');
  assert.equal(L.petStep({ ...base, busy: true, celebrating: true }), 'celebrate', 'celebrate still wins');
});
test('petStep: hopping -> idle (the app forces variant c), over the base states but under cards and celebrate', () => {
  assert.equal(L.petStep({ ...base, hopping: true }), 'idle');
  assert.equal(L.petStep({ ...base, hopping: true, sessionOn: false }), 'idle', 'paused: still hops');
  assert.equal(L.petStep({ ...base, hopping: true, cardKind: 'step' }), 'helper', 'a card is more urgent than the hop');
  assert.equal(L.petStep({ ...base, hopping: true, celebrating: true }), 'celebrate');
  assert.equal(L.petStep({ ...base, hopping: false }), 'working');
});
test('petStep: still only PET_STATES names with the new flags', () => {
  for (const busy of [false, true]) for (const hopping of [false, true]) for (const cardKind of [null, 'ask', 'step']) {
    assert.ok(L.PET_STATES.includes(L.petStep({ ...base, busy, hopping, cardKind })));
  }
});

// --- per-quest stats ---
test('bumpStat: counts per quest, immutable, defaults to zero', () => {
  const a = {};
  const b = L.bumpStat(a, 0, 'drifts');
  const c = L.bumpStat(L.bumpStat(b, 1, 'stuck'), 0, 'drifts');
  assert.deepEqual(a, {}, 'input untouched');
  assert.deepEqual(L.statsFor(c, 0), { drifts: 2, back: 0, stuck: 0 });
  assert.deepEqual(L.statsFor(c, 1), { drifts: 0, back: 0, stuck: 1 });
  assert.deepEqual(L.statsFor(c, 9), { drifts: 0, back: 0, stuck: 0 });
  assert.deepEqual(L.statsFor(undefined, 0), { drifts: 0, back: 0, stuck: 0 });
});
test('migrate: old state without questStats gets {}; existing questStats survive', () => {
  const s = { text: 'x', quests: [{ title: 'a' }] };
  assert.deepEqual(L.migrate(s).questStats, {});
  const kept = L.migrate({ ...s, questStats: { 0: { drifts: 1, back: 1, stuck: 0 } } });
  assert.deepEqual(kept.questStats, { 0: { drifts: 1, back: 1, stuck: 0 } });
  assert.deepEqual(L.migrate(L.migrate(s)).questStats, {}, 'idempotent');
  assert.deepEqual(L.migrate({ ...s, questStats: 'junk' }).questStats, {});
});
test('recap: per-quest stats sum to exactly the session totals', () => {
  // the app bumps both at every event; replay a session
  let qs = {};
  const session = { driftsAsked: 0, backOnTrack: 0, stuckUsed: 0 };
  const ev = [[0, 'drifts'], [0, 'back'], [1, 'drifts'], [1, 'drifts'], [1, 'stuck'], [2, 'back'], [2, 'stuck'], [2, 'stuck']];
  for (const [i, k] of ev) {
    qs = L.bumpStat(qs, i, k);
    session[{ drifts: 'driftsAsked', back: 'backOnTrack', stuck: 'stuckUsed' }[k]]++;
  }
  const r = L.recap({ quests: [q(5, true), q(5, true), q(5, true)].map((x, i) => ({ ...x, title: 'T' + i })), activeMs: { 0: MIN, 1: 2 * MIN }, session, questStats: qs });
  assert.equal(r.drifts, session.driftsAsked);
  assert.equal(r.backOnTrack, session.backOnTrack);
  assert.equal(r.stuck, session.stuckUsed);
  assert.equal(r.drifts, 3);
});
test('recap: without questStats (older callers) it falls back to the session counters', () => {
  const r = L.recap({ quests: [{ title: 'a', done: true }], activeMs: {}, session: { driftsAsked: 2, backOnTrack: 1, stuckUsed: 4 } });
  assert.deepEqual([r.drifts, r.backOnTrack, r.stuck], [2, 1, 4]);
});
test('fmtActive: <1m, 6m, 1h 5m', () => {
  assert.equal(L.fmtActive(0), '0m');
  assert.equal(L.fmtActive(20000), '<1m');
  assert.equal(L.fmtActive(6 * MIN + 10000), '6m');
  assert.equal(L.fmtActive(65 * MIN), '1h 5m');
});

// --- window picker labels ---
test('windowLabel: "title - App" splits into app + title; no separator = the title is the app', () => {
  assert.deepEqual(L.windowLabel('YouTube - Google Chrome'), { app: 'Google Chrome', title: 'YouTube' });
  assert.deepEqual(L.windowLabel('Bio notes - Word'), { app: 'Word', title: 'Bio notes' });
  assert.deepEqual(L.windowLabel('Clade map - Figma - Figma'), { app: 'Figma', title: 'Clade map - Figma' });
  assert.deepEqual(L.windowLabel('Discord'), { app: 'Discord', title: '' });
  assert.deepEqual(L.windowLabel(''), { app: 'window', title: '' });
  assert.deepEqual(L.windowLabel(undefined), { app: 'window', title: '' });
});
