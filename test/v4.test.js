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
  assert.deepEqual(Object.keys(m.session).sort(), ['allow', 'backOnTrack', 'driftsAsked', 'stuckUsed']);
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

// --- lookDue: the renderer decides when an unsolicited check look may happen ---
test('lookDue: a change after 90 s since the last look is due; sooner is not', () => {
  const t = 1e6;
  assert.equal(L.lookDue({ now: t + 89000, lastLookAt: t, changed: true }), false);
  assert.equal(L.lookDue({ now: t + 90000, lastLookAt: t, changed: true }), true);
});
test('lookDue: no change -> only the 6 min heartbeat fires', () => {
  const t = 1e6;
  assert.equal(L.lookDue({ now: t + 5 * 60000, lastLookAt: t, changed: false }), false);
  assert.equal(L.lookDue({ now: t + 6 * 60000, lastLookAt: t, changed: false }), true);
});
test('lookDue: never more than one look per 60 s, whatever the reason', () => {
  const t = 1e6;
  assert.equal(L.lookDue({ now: t + 30000, lastLookAt: t, changed: true }), false);
  assert.equal(L.lookDue({ now: t + 59000, lastLookAt: t, changed: false }), false);
});
test('lookDue: scaled by the time scale', () => {
  L.setTimeScale(60);
  assert.equal(L.lookDue({ now: 1500 + 1000, lastLookAt: 1000, changed: true }), true, '90 s / 60 = 1.5 s');
  L.setTimeScale(1);
});

// --- step 5: drift, speech cap, breakpoint priority, allow list ---
const sig = (o = {}) => ({ ts: 0, onWork: false, fgProcess: 'chrome', ...o });
const MINUTE = 60000;

test('driftStep: asks only after 2 min off the work window, then not again for 10 min', () => {
  let st = { since: null, lastAskAt: null };
  let r = L.driftStep(st, sig({ ts: 0 }), { allow: [], now: 0 });
  assert.equal(r.ask, false); st = r.state;
  r = L.driftStep(st, sig({ ts: 119000 }), { allow: [], now: 119000 });
  assert.equal(r.ask, false); st = r.state;
  r = L.driftStep(st, sig({ ts: 120000 }), { allow: [], now: 120000 });
  assert.equal(r.ask, true); st = r.state;
  r = L.driftStep(st, sig({ ts: 120000 + 5 * MINUTE }), { allow: [], now: 120000 + 5 * MINUTE });
  assert.equal(r.ask, false, 'inside the 10 min gap');
  r = L.driftStep(st, sig({ ts: 120000 + 12 * MINUTE }), { allow: [], now: 120000 + 12 * MINUTE });
  assert.equal(r.ask, true, 'after the gap, still drifting');
});
test('driftStep: back on the work window resets the clock', () => {
  let st = { since: null, lastAskAt: null };
  st = L.driftStep(st, sig({ ts: 0 }), { allow: [], now: 0 }).state;
  st = L.driftStep(st, sig({ ts: 60000, onWork: true }), { allow: [], now: 60000 }).state;
  assert.equal(st.since, null);
  st = L.driftStep(st, sig({ ts: 100000 }), { allow: [], now: 100000 }).state;
  assert.equal(L.driftStep(st, sig({ ts: 100000 + 119000 }), { allow: [], now: 100000 + 119000 }).ask, false);
});
test('driftStep: an allowed process never counts as drift', () => {
  const allow = [{ process: 'Chrome', note: 'research' }];
  let st = { since: null, lastAskAt: null };
  st = L.driftStep(st, sig({ ts: 0 }), { allow, now: 0 }).state;
  const r = L.driftStep(st, sig({ ts: 10 * MINUTE }), { allow, now: 10 * MINUTE });
  assert.equal(r.ask, false);
  assert.equal(r.state.since, null);
});
test('driftStep: unknown foreground process (null) is not drift', () => {
  let st = { since: null, lastAskAt: null };
  st = L.driftStep(st, sig({ ts: 0, fgProcess: null }), { allow: [], now: 0 }).state;
  assert.equal(L.driftStep(st, sig({ ts: 10 * MINUTE, fgProcess: null }), { allow: [], now: 10 * MINUTE }).ask, false);
});
test('driftStep: scaled by the time scale', () => {
  L.setTimeScale(60);
  let st = L.driftStep({ since: null, lastAskAt: null }, sig({ ts: 0 }), { allow: [], now: 0 }).state;
  assert.equal(L.driftStep(st, sig({ ts: 2000 }), { allow: [], now: 2000 }).ask, true, '2 min / 60 = 2 s');
  L.setTimeScale(1);
});

test('allowSpeak: one unsolicited line per 5 min; two dismissals silence the session', () => {
  assert.equal(L.allowSpeak({ lastSpokeAt: 0, dismissed: 0 }, 5 * MINUTE - 1), false);
  assert.equal(L.allowSpeak({ lastSpokeAt: 0, dismissed: 0 }, 5 * MINUTE), true);
  assert.equal(L.allowSpeak({ lastSpokeAt: 0, dismissed: 1 }, 99 * MINUTE), true);
  assert.equal(L.allowSpeak({ lastSpokeAt: 0, dismissed: 2 }, 99 * MINUTE), false);
  assert.equal(L.allowSpeak({ lastSpokeAt: null, dismissed: 0 }, 1), true, 'nothing spoken yet');
});

test('allowSpeak: the cap is a parameter (web demo uses a short one)', () => {
  assert.equal(L.allowSpeak({ lastSpokeAt: 0, dismissed: 0 }, 7000, 8000), false);
  assert.equal(L.allowSpeak({ lastSpokeAt: 0, dismissed: 0 }, 8000, 8000), true);
});

test('breakpoint: highest priority wins — windowLost > deadline > timebox > drift > stuck > idle', () => {
  assert.equal(L.breakpoint({}), null);
  assert.equal(L.breakpoint({ idle: true }), 'idle');
  assert.equal(L.breakpoint({ idle: true, stuck: true }), 'stuck');
  assert.equal(L.breakpoint({ idle: true, stuck: true, drift: true }), 'drift');
  assert.equal(L.breakpoint({ stuck: true, drift: true, timebox: true }), 'timebox');
  assert.equal(L.breakpoint({ drift: true, timebox: true, deadline: true }), 'deadline');
  assert.equal(L.breakpoint({ deadline: true, windowLost: true, idle: true }), 'windowLost');
});

test('allowMatches / addAllow: case-insensitive, capped at 8, no duplicates', () => {
  assert.equal(L.allowMatches([{ process: 'Chrome', note: 'x' }], 'chrome'), true);
  assert.equal(L.allowMatches([{ process: 'Chrome', note: 'x' }], 'winword'), false);
  assert.equal(L.allowMatches([], null), false);
  let a = [];
  a = L.addAllow(a, { process: 'chrome', note: 'research' });
  a = L.addAllow(a, { process: 'Chrome', note: 'lecture' });
  assert.equal(a.length, 1);
  assert.equal(a[0].note, 'lecture', 'newest note wins');
  for (let i = 0; i < 12; i++) a = L.addAllow(a, { process: `app${i}`, note: 'n' });
  assert.equal(a.length, 8);
  assert.equal(L.addAllow([], { process: '', note: 'x' }).length, 0, 'empty process ignored');
  assert.equal(L.addAllow([], { process: 'p', note: 'x'.repeat(200) })[0].note.length, 60, 'note cut to 60');
});

test('applyLook check: off-task at >= 0.7 asks with a LOCAL template, never model text; below the gate = silence', () => {
  const c = ctx({ auto: true });
  const off = L.applyLook({ ...c, purpose: 'check' }, look({ onTask: false, confidence: 0.9, sayLine: 'Stop watching cats!', evidence: 'cat videos', nextStep: 'go away' }));
  assert.equal(off.card.kind, 'ask');
  assert.equal(off.card.title, 'Still on "Write intro"?');
  assert.doesNotMatch(JSON.stringify(off.card), /cat|Stop|go away/);
  assert.equal(L.applyLook({ ...c, purpose: 'check' }, look({ onTask: false, confidence: 0.5 })).card, null);
  assert.equal(L.applyLook({ ...c, purpose: 'check' }, look({ onTask: true })).card, null);
});
test('applyLook check: questDone wins over off-task (propose done, do not ask)', () => {
  const r = L.applyLook({ ...ctx({ auto: true }), purpose: 'check' }, look({ onTask: false, questDone: true, confidence: 0.9 }));
  assert.equal(r.card.kind, 'confirm');
});

// --- step 6: re-entry ---
test('reentryTrigger: back from away, or back on the work window after >= 3 min off it', () => {
  assert.equal(L.reentryTrigger({ wasAway: true, away: false, onWork: false, offForMs: 0 }), true);
  assert.equal(L.reentryTrigger({ wasAway: true, away: true, onWork: false, offForMs: 0 }), false, 'still away');
  assert.equal(L.reentryTrigger({ wasAway: false, away: false, onWork: true, offForMs: 3 * MINUTE }), true);
  assert.equal(L.reentryTrigger({ wasAway: false, away: false, onWork: true, offForMs: 3 * MINUTE - 1 }), false);
  assert.equal(L.reentryTrigger({ wasAway: false, away: false, onWork: false, offForMs: 99 * MINUTE }), false, 'not back yet');
});
test('reentryTrigger: scaled by the time scale', () => {
  L.setTimeScale(60);
  assert.equal(L.reentryTrigger({ wasAway: false, away: false, onWork: true, offForMs: 3000 }), true, '3 min / 60 = 3 s');
  L.setTimeScale(1);
});

test('freshFrame: a held frame is usable for 10 min, then gone', () => {
  const slot = { at: 1000, jpegBase64: 'AAA' };
  assert.equal(L.freshFrame(slot, 1000 + 10 * MINUTE - 1), 'AAA');
  assert.equal(L.freshFrame(slot, 1000 + 10 * MINUTE), null);
  assert.equal(L.freshFrame(null, 5), null);
});

test('applyLook reentry: confident -> reentry card built from the model evidence + next step', () => {
  const r = L.applyLook({ ...ctx(), purpose: 'reentry' }, look({ evidence: 'You were on the intro paragraph', nextStep: 'Next: write the first body sentence.' }));
  assert.equal(r.card.kind, 'reentry');
  assert.equal(r.card.title, 'Welcome back');
  assert.equal(r.card.body, 'You were on the intro paragraph Next: write the first body sentence.');
});
test('applyLook reentry: below the gate, error, links or bad tone -> local template with the starter on a fresh quest', () => {
  const fresh = { ...ctx(), purpose: 'reentry', starter: 'Open the doc and type one ugly sentence.', activeMs: 0 };
  for (const v of [look({ confidence: 0.2 }), null, look({ nextStep: 'Next: you should visit http://x.com' }), look({ evidence: '' })]) {
    const r = L.applyLook(fresh, v);
    assert.equal(r.card.kind, 'reentry');
    assert.equal(r.card.body, 'You were on "Write intro". Next: Open the doc and type one ugly sentence.');
  }
});
test('applyLook reentry: template uses the first words of the finish line once the quest has active time', () => {
  const r = L.applyLook({ ...ctx(), purpose: 'reentry', starter: 'Open the doc.', activeMs: 5 * MINUTE }, null);
  assert.equal(r.card.body, 'You were on "Write intro". Next: intro exists');
});

// --- step 7: countdown label ---
test('mmss: whole seconds rounded up, m:ss', () => {
  assert.equal(L.mmss(61000), '1:01');
  assert.equal(L.mmss(60000), '1:00');
  assert.equal(L.mmss(59001), '1:00');
  assert.equal(L.mmss(1), '0:01');
  assert.equal(L.mmss(0), '0:00');
  assert.equal(L.mmss(-5), '0:00');
  assert.equal(L.mmss(120000), '2:00');
});
test('mmss: shows the unscaled time while the engine runs at N x', () => {
  L.setTimeScale(60);
  assert.equal(L.mmss(1000), '1:00', '1 s of engine time = 60 s on the label');
  L.setTimeScale(1);
});

// --- step 8: pet state machine ---
const base = { celebrating: false, looking: false, quietLook: false, cardKind: null, sessionOn: true, hasTask: true, breakMode: false, windowLost: false, away: false };
test('PET_STATES / IDLE_VARIANTS: exactly the names the design contract uses', () => {
  assert.deepEqual(L.PET_STATES, ['idle', 'working', 'curious', 'thinking', 'helper', 'celebrate', 'sleepy', 'asleep']);
  assert.deepEqual(L.IDLE_VARIANTS, ['a', 'b', 'c', 'd']);
});
test('petStep: base states', () => {
  assert.equal(L.petStep(base), 'working');
  assert.equal(L.petStep({ ...base, sessionOn: false, hasTask: false }), 'idle');
  assert.equal(L.petStep({ ...base, sessionOn: false }), 'sleepy', 'paused / waiting to start');
  assert.equal(L.petStep({ ...base, breakMode: true }), 'sleepy');
  assert.equal(L.petStep({ ...base, away: true }), 'sleepy');
  assert.equal(L.petStep({ ...base, windowLost: true }), 'asleep');
  assert.equal(L.petStep({ ...base, windowLost: true, away: true }), 'asleep', 'a lost window beats away');
});
test('petStep: transient states override the base, in priority order', () => {
  assert.equal(L.petStep({ ...base, cardKind: 'ask' }), 'curious');
  for (const k of ['confirm', 'reentry', 'starter', 'timebox']) assert.equal(L.petStep({ ...base, cardKind: k }), 'curious', k);
  assert.equal(L.petStep({ ...base, cardKind: 'step' }), 'helper');
  assert.equal(L.petStep({ ...base, cardKind: 'step', looking: true }), 'thinking', 'a call in flight beats the card');
  assert.equal(L.petStep({ ...base, looking: true, cardKind: 'ask', celebrating: true }), 'celebrate', 'celebrate beats everything');
});
test('petStep: an unsolicited (quiet) look never flashes thinking', () => {
  assert.equal(L.petStep({ ...base, looking: true, quietLook: true }), 'working');
});
test('petStep: only names from PET_STATES, for any combination of flags', () => {
  const flags = Object.keys(base);
  for (let m = 0; m < 1 << flags.length; m++) {
    const c = {};
    flags.forEach((f, i) => { c[f] = f === 'cardKind' ? ((m >> i) & 1 ? 'step' : null) : !!((m >> i) & 1); });
    assert.ok(L.PET_STATES.includes(L.petStep(c)), JSON.stringify(c));
  }
});

test('pickIdle: never the same variant twice in a row, all four reachable', () => {
  const seen = new Set();
  for (const prev of L.IDLE_VARIANTS) {
    for (let i = 0; i < 40; i++) {
      const v = L.pickIdle(prev, i / 40);
      assert.notEqual(v, prev);
      assert.ok(L.IDLE_VARIANTS.includes(v));
      seen.add(v);
    }
  }
  assert.equal(seen.size, 4);
  assert.ok(L.IDLE_VARIANTS.includes(L.pickIdle(undefined, 0.5)), 'no previous variant');
});
test('idleDelay / idleSpeed: 7-16 s and 0.85-1.15, scaled delay', () => {
  assert.equal(L.idleDelay(0), 7000);
  assert.equal(L.idleDelay(0.999999) <= 16000, true);
  assert.equal(L.idleSpeed(0), 0.85);
  assert.ok(Math.abs(L.idleSpeed(1) - 1.15) < 1e-9);
  L.setTimeScale(10);
  assert.equal(L.idleDelay(0), 700);
  L.setTimeScale(1);
});

// --- step 9: time disc + timebox ---
test('discLeft: 1 -> 0 as active time runs toward the timebox, clamped', () => {
  assert.equal(L.discLeft({ activeMs: 0, minutes: 10 }), 1);
  assert.equal(L.discLeft({ activeMs: 5 * MINUTE, minutes: 10 }), 0.5);
  assert.equal(L.discLeft({ activeMs: 10 * MINUTE, minutes: 10 }), 0);
  assert.equal(L.discLeft({ activeMs: 99 * MINUTE, minutes: 10 }), 0);
  assert.equal(L.discLeft({ activeMs: -5, minutes: 10 }), 1);
  assert.equal(L.discLeft({ activeMs: 5, minutes: 0 }), 0, 'no timebox = empty ring, no division by zero');
});
test('timeboxDue: fires once when the minutes are used up; again only after the minutes change', () => {
  assert.equal(L.timeboxDue({ activeMs: 10 * MINUTE - 1, minutes: 10, firedAt: undefined }), false);
  assert.equal(L.timeboxDue({ activeMs: 10 * MINUTE, minutes: 10, firedAt: undefined }), true);
  assert.equal(L.timeboxDue({ activeMs: 11 * MINUTE, minutes: 10, firedAt: 10 }), false, 'already fired for 10');
  assert.equal(L.timeboxDue({ activeMs: 11 * MINUTE, minutes: 20, firedAt: 10 }), false, 'extended to 20, not used up yet');
  assert.equal(L.timeboxDue({ activeMs: 20 * MINUTE, minutes: 20, firedAt: 10 }), true, 'fires again at the new end');
});
test('nextQuestIdx: next open quest after this one, wrapping; -1 when no other is open', () => {
  assert.equal(L.nextQuestIdx([false, false, false], 0), 1);
  assert.equal(L.nextQuestIdx([false, true, false], 0), 2);
  assert.equal(L.nextQuestIdx([false, true, true], 2), 0, 'wraps');
  assert.equal(L.nextQuestIdx([false, true, true], 0), -1);
  assert.equal(L.nextQuestIdx([true, true], 0), -1);
});
test('migrate: timeboxFired defaults to {}', () => {
  assert.deepEqual(L.migrate({ text: 'a', quests: [{ title: 'A' }] }).timeboxFired, {});
});

// --- step 10: recap ---
const rq = (title, done) => ({ title, finish: 'f', minutes: 10, done });
const sess = (o = {}) => ({ allow: [], driftsAsked: 0, backOnTrack: 0, stuckUsed: 0, ...o });
test('recap: planned vs done, minutes on quest, counters, and a specific praise line', () => {
  const r = L.recap({
    quests: [rq('Outline the essay', true), rq('Write the intro', true), rq('Write causes', true), rq('Write effects', false), rq('Conclude', false)],
    activeMs: { 0: 10 * MINUTE, 1: 20 * MINUTE, 2: 12 * MINUTE + 29000, 3: 0 },
    session: sess({ driftsAsked: 2, backOnTrack: 2, stuckUsed: 3 }),
  });
  assert.equal(r.planned, 5);
  assert.equal(r.done, 3);
  assert.equal(r.minutes, 42);
  assert.equal(r.drifts, 2);
  assert.equal(r.backOnTrack, 2);
  assert.equal(r.stuck, 3);
  assert.equal(r.praise, '3 of 5 done: write the intro and write causes.');
  assert.deepEqual(r.doneTitles, ['Outline the essay', 'Write the intro', 'Write causes']);
});
test('recap: praise for 1 done, none done, all done', () => {
  const one = L.recap({ quests: [rq('Outline the essay', true), rq('B', false)], activeMs: {}, session: sess() });
  assert.equal(one.praise, '1 of 2 done: outline the essay.');
  const none = L.recap({ quests: [rq('A', false), rq('B', false)], activeMs: {}, session: sess() });
  assert.equal(none.praise, 'You made a plan and showed up. That counts.');
  const all = L.recap({ quests: [rq('A one', true), rq('B two', true)], activeMs: {}, session: sess() });
  assert.equal(all.praise, 'All 2 done: a one and b two. Nice.');
});
test('recap: long titles are cut, missing counters/activeMs are zero, never throws', () => {
  const r = L.recap({ quests: [rq('X'.repeat(100), true)], activeMs: undefined, session: undefined });
  assert.ok(r.praise.length < 90, r.praise);
  assert.equal(r.minutes, 0);
  assert.equal(r.drifts, 0);
  assert.equal(r.stuck, 0);
});
test('migrate: session also carries stuckUsed', () => {
  assert.deepEqual(Object.keys(L.migrate({ text: 'a', quests: [{ title: 'A' }] }).session).sort(), ['allow', 'backOnTrack', 'driftsAsked', 'stuckUsed']);
});
