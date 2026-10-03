// Polish night: window placement, docking, size steps, settings validation. Written before the code (watched failing first).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const wa = { x: 0, y: 0, width: 1920, height: 1040 };

test('placeWindow: bottom dock grows up from its bottom edge, centred on cx', () => {
  const r = L.placeWindow({ anchor: { cx: 960, y: 1028, dock: 'bottom' }, w: 404, h: 128, wa });
  assert.deepEqual(r, { x: 758, y: 900, w: 404, h: 128 });
  const tall = L.placeWindow({ anchor: { cx: 960, y: 1028, dock: 'bottom' }, w: 404, h: 600, wa });
  assert.equal(tall.y + tall.h, 1028, 'the bottom edge stays put when the window grows');
});
test('placeWindow: top dock grows down from its top edge', () => {
  const r = L.placeWindow({ anchor: { cx: 960, y: 12, dock: 'top' }, w: 404, h: 128, wa });
  assert.equal(r.y, 12);
  assert.equal(L.placeWindow({ anchor: { cx: 960, y: 12, dock: 'top' }, w: 404, h: 600, wa }).y, 12, 'the top edge stays put when the window grows');
});
test('placeWindow: clamps inside the work area on every edge', () => {
  assert.equal(L.placeWindow({ anchor: { cx: -500, y: 500, dock: 'bottom' }, w: 404, h: 128, wa }).x, 0, 'left');
  assert.equal(L.placeWindow({ anchor: { cx: 5000, y: 500, dock: 'bottom' }, w: 404, h: 128, wa }).x, 1920 - 404, 'right');
  assert.equal(L.placeWindow({ anchor: { cx: 960, y: 20, dock: 'bottom' }, w: 404, h: 128, wa }).y, 0, 'top');
  assert.equal(L.placeWindow({ anchor: { cx: 960, y: 5000, dock: 'top' }, w: 404, h: 128, wa }).y, 1040 - 128, 'bottom');
});
test('placeWindow: second monitor at negative x', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  const r = L.placeWindow({ anchor: { cx: -960, y: 1068, dock: 'bottom' }, w: 404, h: 128, wa: left });
  assert.equal(r.x, -960 - 202);
  assert.equal(L.placeWindow({ anchor: { cx: -5000, y: 500, dock: 'top' }, w: 404, h: 128, wa: left }).x, -1920);
});
test('placeWindow: taller than the work area -> cut to it, never off-screen', () => {
  const r = L.placeWindow({ anchor: { cx: 960, y: 1028, dock: 'bottom' }, w: 404, h: 5000, wa });
  assert.equal(r.h, 1040);
  assert.equal(r.y, 0);
});
test('placeWindow: wider than the work area -> cut to it', () => {
  const r = L.placeWindow({ anchor: { cx: 100, y: 500, dock: 'top' }, w: 404, h: 128, wa: { x: 0, y: 0, width: 300, height: 600 } });
  assert.equal(r.w, 300);
  assert.equal(r.x, 0);
});

test('dockFor: cursor above the work-area midpoint docks top, else bottom', () => {
  assert.equal(L.dockFor(100, wa), 'top');
  assert.equal(L.dockFor(520, wa), 'bottom');
  assert.equal(L.dockFor(900, wa), 'bottom');
});
test('anchorFrom: centre x, and the edge the dock grows away from', () => {
  assert.deepEqual(L.anchorFrom({ x: 100, y: 50, w: 400, h: 200 }, 'top'), { cx: 300, y: 50, dock: 'top' });
  assert.deepEqual(L.anchorFrom({ x: 100, y: 50, w: 400, h: 200 }, 'bottom'), { cx: 300, y: 250, dock: 'bottom' });
});
test('defaultAnchor: bottom-centre of the work area, 12 px above its edge', () => {
  assert.deepEqual(L.defaultAnchor(wa), { cx: 960, y: 1028, dock: 'bottom' });
});

test('SIZES / stepSize: S < M < L, wheel steps clamp at the ends', () => {
  assert.ok(L.SIZES.S < L.SIZES.M && L.SIZES.M < L.SIZES.L);
  assert.equal(L.stepSize('M', 'in'), 'L');
  assert.equal(L.stepSize('L', 'in'), 'L');
  assert.equal(L.stepSize('M', 'out'), 'S');
  assert.equal(L.stepSize('S', 'out'), 'S');
  assert.equal(L.stepSize('nope', 'in'), 'L', 'unknown size counts as M');
});

test('sanitizeSettings: valid file passes through', () => {
  const s = { anchor: { cx: 960, y: 1028, dock: 'bottom' }, size: 'L', theme: 'dark' };
  assert.deepEqual(L.sanitizeSettings(s, [wa]), s);
});
test('sanitizeSettings: junk falls back to defaults field by field', () => {
  const r = L.sanitizeSettings({ anchor: { cx: NaN, y: 5, dock: 'bottom' }, size: 'XL', theme: 'neon' }, [wa]);
  assert.deepEqual(r, { anchor: null, size: 'M', theme: 'system' });
  assert.deepEqual(L.sanitizeSettings(null, [wa]), { anchor: null, size: 'M', theme: 'system' });
  assert.equal(L.sanitizeSettings({ anchor: { cx: 1, y: 2, dock: 'sideways' } }, [wa]).anchor, null);
});
test('sanitizeSettings: an anchor on an unplugged monitor is dropped', () => {
  const gone = { cx: -960, y: 1028, dock: 'bottom' };
  assert.equal(L.sanitizeSettings({ anchor: gone }, [wa]).anchor, null);
  assert.deepEqual(L.sanitizeSettings({ anchor: gone }, [wa, { x: -1920, y: 0, width: 1920, height: 1080 }]).anchor, gone);
});

// --- the glance: leaving the work window turns the pet curious at once (no text, no model) ---
const base = { celebrating: false, looking: false, quietLook: false, cardKind: null, sessionOn: true, hasTask: true, breakMode: false, windowLost: false, away: false, busy: false, offWork: false };
test('petStep: offWork -> curious, below windowLost / away / break / cards / celebrate, above working', () => {
  assert.equal(L.petStep({ ...base, offWork: true }), 'curious');
  assert.equal(L.petStep({ ...base, offWork: true, windowLost: true }), 'asleep');
  assert.equal(L.petStep({ ...base, offWork: true, away: true }), 'sleepy');
  assert.equal(L.petStep({ ...base, offWork: true, breakMode: true }), 'sleepy');
  assert.equal(L.petStep({ ...base, offWork: true, sessionOn: false }), 'sleepy', 'paused: no glance');
  assert.equal(L.petStep({ ...base, offWork: true, cardKind: 'step' }), 'helper');
  assert.equal(L.petStep({ ...base, offWork: true, looking: true }), 'thinking');
  assert.equal(L.petStep({ ...base, offWork: true, celebrating: true }), 'celebrate');
  assert.equal(L.petStep({ ...base, offWork: false }), 'working');
});
