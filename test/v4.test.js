// v4 pure logic: look validation + guards, quests v2, frame diff, migrate, progress v2, applyLook.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const look = (o = {}) => ({ onTask: true, confidence: 0.9, questDone: false, evidence: 'Doc with a Causes heading', nextStep: 'Type one sentence under Causes.', sayLine: 'Small step?', ...o });

// --- validateLook ---
test('validateLook: accepts a well-formed look and returns it', () => {
  assert.deepEqual(L.validateLook(look()), look());
});
test('validateLook: wrong types, missing fields, out-of-range confidence, non-objects -> null', () => {
  assert.equal(L.validateLook(null), null);
  assert.equal(L.validateLook('x'), null);
  assert.equal(L.validateLook(look({ onTask: 'yes' })), null);
  assert.equal(L.validateLook(look({ confidence: 1.5 })), null);
  assert.equal(L.validateLook(look({ confidence: -0.1 })), null);
  const { evidence, ...rest } = look();
  assert.equal(L.validateLook(rest), null);
});
test('validateLook: truncates long strings to 90 / 120 / 70', () => {
  const v = L.validateLook(look({ evidence: 'e'.repeat(300), nextStep: 'n'.repeat(300), sayLine: 's'.repeat(300) }));
  assert.equal(v.evidence.length, 90);
  assert.equal(v.nextStep.length, 120);
  assert.equal(v.sayLine.length, 70);
});
test('validateLook: a field with a link or contact detail is blanked, the rest survives', () => {
  const v = L.validateLook(look({ nextStep: 'Visit http://example.com now', evidence: 'mail me@x.com' }));
  assert.equal(v.nextStep, '');
  assert.equal(v.evidence, '');
  assert.equal(v.sayLine, 'Small step?');
});

// --- safeText / toneOk / freshLine / gateLook ---
test('safeText: rejects urls, www, ://, @, backtick, angle brackets and over-length', () => {
  for (const bad of ['see https://a.b', 'go www.a.com', 'x://y', 'a@b', 'run `rm`', '<b>x</b>', 'a > b']) assert.equal(L.safeText(bad, 90), '', bad);
  assert.equal(L.safeText('x'.repeat(91), 90), '');
  assert.equal(L.safeText('  Type one sentence.  ', 90), 'Type one sentence.');
});
test('toneOk: rejects must/should/failed/lazy/"again?"', () => {
  for (const bad of ['You must write', 'you should start', 'You failed', 'so lazy', 'Writing again?']) assert.equal(L.toneOk(bad), false, bad);
  assert.equal(L.toneOk('Want a tiny next step?'), true);
  assert.equal(L.toneOk('Shoulder to shoulder'), true, 'word boundary');
});
test('freshLine: drops a normalized repeat of the last 30 lines, keeps new ones', () => {
  const hist = ['Want a tiny step?'];
  assert.equal(L.freshLine('want a TINY step', hist), null);
  assert.equal(L.freshLine('A different line', hist), 'A different line');
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`);
  assert.equal(L.freshLine('first old', ['first old', ...long]), 'first old', 'older than 30 is forgotten');
});
test('gateLook: null below the confidence gate, passes at/above', () => {
  assert.equal(L.gateLook(look({ confidence: 0.69 }), 0.7), null);
  assert.ok(L.gateLook(look({ confidence: 0.7 }), 0.7));
  assert.equal(L.gateLook(null, 0.7), null);
});

// --- quests v2 ---
const q = (title, minutes = 15) => ({ title, finish: `${title} is visible`, minutes });
test('validateQuests: clamps minutes 10-25, quest 1 <= 5, cuts title 60 / starter 80, max 5 quests', () => {
  const r = L.validateQuests({ deadline_iso: '2026-10-02T10:00:00Z', starter: 's'.repeat(200), quests: [q('t'.repeat(100), 30), q('B', 1), q('C'), q('D'), q('E'), q('F')] });
  assert.equal(r.quests.length, 5);
  assert.equal(r.quests[0].title.length, 60);
  assert.equal(r.quests[0].minutes, 5);
  assert.equal(r.quests[1].minutes, 10);
  assert.equal(r.starter.length, 80);
  const big = L.validateQuests({ deadline_iso: 'x', starter: 'go', quests: [q('A'), q('B', 99), q('C')] });
  assert.equal(big.quests[1].minutes, 25);
});
test('validateQuests: fewer than 3 quests, no deadline, or bad shape -> null; missing starter gets a default', () => {
  assert.equal(L.validateQuests({ deadline_iso: 'x', starter: 'go', quests: [q('A'), q('B')] }), null);
  assert.equal(L.validateQuests({ starter: 'go', quests: [q('A'), q('B'), q('C')] }), null);
  assert.equal(L.validateQuests(null), null);
  assert.equal(L.validateQuests({ deadline_iso: 'x', quests: [q('A'), { title: 1 }, q('C')] }), null);
  assert.ok(L.validateQuests({ deadline_iso: 'x', quests: [q('A'), q('B'), q('C')] }).starter.length > 0);
});
test('questFallback: v2 — a starter plus 3 quests with title, finish, minutes (first <= 5)', () => {
  const f = L.questFallback();
  assert.ok(f.starter.length > 0 && f.starter.length <= 80);
  assert.equal(f.quests.length, 3);
  assert.ok(f.quests[0].minutes <= 5);
  for (const x of f.quests) assert.ok(x.title && x.finish && x.minutes >= 2 && x.minutes <= 25);
});

// --- frame diff ---
test('diffFraction: share of pixels moved more than the threshold; size mismatch = 1', () => {
  const a = new Uint8Array(100).fill(100);
  const b = new Uint8Array(100).fill(100);
  assert.equal(L.diffFraction(a, b), 0);
  for (let i = 0; i < 5; i++) b[i] = 200;
  assert.equal(L.diffFraction(a, b), 0.05);
  b[10] = 110; // under 24: noise
  assert.equal(L.diffFraction(a, b), 0.05);
  assert.equal(L.diffFraction(a, new Uint8Array(50)), 1);
});

// --- time scale ---
test('dur: divides by the time scale; invalid scale falls back to 1', () => {
  assert.equal(L.dur(60000), 60000);
  L.setTimeScale(60);
  assert.equal(L.dur(60000), 1000);
  L.setTimeScale(0);
  assert.equal(L.dur(60000), 60000);
  L.setTimeScale(1);
});

// --- migrate ---
test('migrate: v1 state gets minutes, starter, session defaults; existing fields survive', () => {
  const v1 = { text: 'essay', quests: [{ title: 'A', finish: 'f', done: true }, { title: 'B', finish: 'g', done: false }], current: null, deadline_iso: 'd', progress: 0.3 };
  const m = L.migrate(v1);
  assert.equal(m.text, 'essay');
  assert.equal(m.quests[0].done, true);
  assert.equal(m.quests[0].minutes, 5);
  assert.ok(m.quests[1].minutes >= 10);
  assert.ok(m.starter.length > 0);
  assert.deepEqual(Object.keys(m.session).sort(), ['allow', 'backOnTrack', 'driftsAsked']);
  assert.deepEqual(L.migrate(m), m, 'idempotent');
});
test('migrate: invalid state -> null', () => {
  for (const bad of [null, 'x', 5, {}, { quests: [] }, { text: 'a', quests: [{ title: 5 }] }]) assert.equal(L.migrate(bad), null, JSON.stringify(bad));
});

// --- progress v2 ---
test('computeProgress v2: plan segment pre-filled, active quest adds up to 0.9 of its segment', () => {
  assert.equal(L.computeProgress({ done: 0, total: 4, activeMs: 0, minutes: 10 }), 1 / 5);
  assert.equal(L.computeProgress({ done: 2, total: 4, activeMs: 0, minutes: 10 }), 3 / 5);
  assert.ok(Math.abs(L.computeProgress({ done: 1, total: 4, activeMs: 300000, minutes: 10 }) - 2.5 / 5) < 1e-9);
  assert.ok(Math.abs(L.computeProgress({ done: 1, total: 4, activeMs: 99 * 60000, minutes: 10 }) - 2.9 / 5) < 1e-9, 'capped at 0.9');
  assert.equal(L.computeProgress({ done: 4, total: 4, activeMs: 0, minutes: 10 }), 1);
});
test('computeProgress v2: never backwards; total 0 throws', () => {
  assert.equal(L.computeProgress({ done: 1, total: 4, activeMs: 0, minutes: 10, previous: 0.9 }), 0.9);
  assert.throws(() => L.computeProgress({ done: 0, total: 0, activeMs: 0, minutes: 10 }));
});

// --- applyLook: the model may propose; it can never change quest state ---
const quests = () => [{ title: 'Write intro', finish: 'intro exists', done: false, minutes: 5 }, { title: 'Body', finish: 'body exists', done: false, minutes: 15 }];
const ctx = (o = {}) => ({ quests: quests(), idx: 0, sup: { suppress: {} }, auto: false, ...o });

test('applyLook: questDone with confidence 1 leaves every quest not done (structural guard)', () => {
  for (const purpose of ['done', 'check', 'stuck', 'reentry']) {
    const c = ctx({ auto: purpose === 'check' });
    const r = L.applyLook({ ...c, purpose }, look({ questDone: true, confidence: 1 }));
    assert.deepEqual(c.quests.map((x) => x.done), [false, false], purpose);
    assert.deepEqual(r.quests.map((x) => x.done), [false, false], purpose);
  }
});
test('applyLook done: always a confirm card; evidence from the model when confident', () => {
  const r = L.applyLook({ ...ctx(), purpose: 'done' }, look({ questDone: true, confidence: 0.9, evidence: 'Intro has 4 sentences' }));
  assert.equal(r.card.kind, 'confirm');
  assert.equal(r.card.idx, 0);
  assert.equal(r.card.evidence, 'Intro has 4 sentences');
});
test('applyLook done: below the gate or null look -> local template, still a confirm card', () => {
  for (const v of [look({ confidence: 0.3, questDone: true }), null]) {
    const r = L.applyLook({ ...ctx(), purpose: 'done' }, v);
    assert.equal(r.card.kind, 'confirm');
    assert.match(r.card.body, /can't tell from here/);
  }
});
test('applyLook done: model says not done but the check was clicked -> still asks, with its evidence', () => {
  const r = L.applyLook({ ...ctx(), purpose: 'done' }, look({ questDone: false, confidence: 0.9, evidence: 'Intro is empty' }));
  assert.equal(r.card.kind, 'confirm');
  assert.equal(r.card.evidence, 'Intro is empty');
});
test('applyLook stuck: step card from nextStep when confident; template naming the quest otherwise', () => {
  const ok = L.applyLook({ ...ctx(), purpose: 'stuck' }, look({ nextStep: 'Type one sentence under Causes.' }));
  assert.equal(ok.card.kind, 'step');
  assert.equal(ok.card.body, 'Type one sentence under Causes.');
  for (const v of [look({ confidence: 0.2 }), null, look({ nextStep: 'You must go to http://x.com' })]) {
    const t = L.applyLook({ ...ctx(), purpose: 'stuck' }, v);
    assert.equal(t.card.kind, 'step');
    assert.equal(t.card.body, "Tiny step: write one rough sentence for 'Write intro'.");
  }
});
test('applyLook stuck: a tone-violating model step falls back to the template', () => {
  const r = L.applyLook({ ...ctx(), purpose: 'stuck' }, look({ nextStep: 'You should write more' }));
  assert.match(r.card.body, /^Tiny step:/);
});
test('applyLook check (unsolicited): questDone >= 0.7 proposes; below gate or not done = silence; suppression honoured', () => {
  const c = ctx({ auto: true });
  const yes = L.applyLook({ ...c, purpose: 'check' }, look({ questDone: true, confidence: 0.8 }));
  assert.equal(yes.card.kind, 'confirm');
  assert.equal(L.applyLook({ ...c, purpose: 'check' }, look({ questDone: true, confidence: 0.5 })).card, null);
  assert.equal(L.applyLook({ ...c, purpose: 'check' }, look({ questDone: false })).card, null);
  const sup = L.notYet({ suppress: {} }, 0);
  assert.equal(L.applyLook({ ...c, sup, purpose: 'check' }, look({ questDone: true, confidence: 1 })).card, null);
});
