const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../remote.js');
test('aiMode: mock flag wins; own key next; TEST without PENSUM_API is mock (never hits production)', () => {
  assert.equal(R.aiMode({ PENSUM_MOCK: '1', GEMINI_API_KEY: 'k' }, {}), 'mock');
  assert.equal(R.aiMode({ GEMINI_API_KEY: 'k' }, {}), 'own-key');
  assert.equal(R.aiMode({}, { test: true }), 'mock');
  assert.equal(R.aiMode({ PENSUM_API: 'http://127.0.0.1:9' }, { test: true }), 'live');
  assert.equal(R.aiMode({}, {}), 'live');
});
test('toBody: look maps purpose->mode, drops document text, caps fields', () => {
  const b = R.toBody('look', { purpose: 'done', jpegBase64: 'AAAA', quest: { title: 'T', finish: 'F' }, ctx: { task: 'G', quests: [{ title: 'T', done: false }], windowTitle: 'Doc', text: 'SECRET DOC', digest: { words: 1 } } });
  assert.deepEqual(Object.keys(b).sort(), ['goal', 'mode', 'quest', 'quests', 'screenshot', 'windowTitle']);
  assert.equal(b.mode, 'confirm'); assert.doesNotMatch(JSON.stringify(b), /SECRET DOC/);
  assert.equal(R.toBody('look', { purpose: 'check', jpegBase64: 'A', quest: { title: 'T', finish: '' }, ctx: { task: 'G' } }).mode, 'drift');
  assert.equal(R.toBody('quests', { text: 'x'.repeat(400), tzOffset: 360 }).goal.length, 300);
});
async function withStub(handler, fn) {
  const http = require('node:http'); const srv = http.createServer(handler); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}
const fakeAi = { look: async ({ purpose }) => ({ onTask: true, confidence: 0.9, questDone: false, evidence: 'mock', nextStep: 'mock step', sayLine: '', purpose }), quests: async () => ({ deadline_iso: 'x', starter: 's', quests: [] }) };
const args = { purpose: 'stuck', jpegBase64: Buffer.from([255, 216, 255, 0]).toString('base64'), quest: { title: 'T', finish: 'F' }, ctx: { task: 'G' } };
for (const [name, h] of [
  ['429', (q, s) => { s.writeHead(429, { 'content-type': 'application/json' }); s.end('{"fallback":"mock","reason":"rate"}'); }],
  ['401 deployment protection', (q, s) => { s.writeHead(401); s.end('auth'); }],
  ['200 fallback', (q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"fallback":"mock","reason":"model"}'); }],
  ['html garbage', (q, s) => { s.writeHead(200); s.end('<html>'); }],
]) test(`look: ${name} -> mock result flagged mock:true`, () => withStub(h, async (base) => {
  const v = await R.look(args, { base, ai: fakeAi, fetch: globalThis.fetch, resize: (b) => b });
  assert.equal(v.mock, true); assert.equal(v.nextStep, 'mock step');
}));
test('look: hanging server -> mock within timeout', () => withStub(() => {}, async (base) => {
  const t0 = Date.now(); const v = await R.look(args, { base, ai: fakeAi, fetch: globalThis.fetch, resize: (b) => b, timeoutMs: 300 });
  assert.equal(v.mock, true); assert.ok(Date.now() - t0 < 2000);
}));
test('look: connection refused -> mock', async () => {
  const v = await R.look(args, { base: 'http://127.0.0.1:9', ai: fakeAi, fetch: globalThis.fetch, resize: (b) => b });
  assert.equal(v.mock, true);
});
test('look: 200 ok -> live result, no mock flag', () => withStub((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, result: { onTask: true, confidence: 0.8, questDone: false, evidence: 'Causes heading', nextStep: 'Type one sentence', sayLine: 'go' } })); }, async (base) => {
  const v = await R.look(args, { base, ai: fakeAi, fetch: globalThis.fetch, resize: (b) => b });
  assert.equal(v.mock, undefined); assert.equal(v.nextStep, 'Type one sentence');
}));
