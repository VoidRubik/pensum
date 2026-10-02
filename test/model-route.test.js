// api/model.js: the public web-demo route. Rate limit first, whitelisted samples, no uploads, no key in output.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const realFetch = globalThis.fetch;
let route;
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key-not-real';
  delete process.env.QUESTLING_MOCK;
  delete require.cache[require.resolve('../api/model.js')]; // fresh in-memory limiter per test
  route = require('../api/model.js');
});
afterEach(() => { globalThis.fetch = realFetch; });

const reply = (obj) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: {} }) });
const goodLook = { onTask: true, confidence: 0.9, questDone: false, evidence: 'Causes heading, empty', nextStep: 'Type one sentence under Causes.', sayLine: 'Tiny step?' };
const goodQuests = { deadline_iso: '2026-10-02T10:00:00Z', starter: 'Open the doc.', quests: [{ title: 'Write intro', finish: 'intro exists', minutes: 5 }, { title: 'Body', finish: 'body exists', minutes: 15 }, { title: 'Wrap up', finish: 'end exists', minutes: 15 }] };

function call(handler, { method = 'POST', body, ip = '1.2.3.4' } = {}) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o, headers: this.headers }); }, end() { resolve({ code: this.code, body: null, headers: this.headers }); } };
    handler({ method, body, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } }, res);
  });
}
const lookBody = (o = {}) => ({ kind: 'look', purpose: 'stuck', sample: 'essay-blank', task: 'my essay', quest: { title: 'Write Causes', finish: 'three sentences' }, ...o });

test('look: whitelisted sample -> 200 with a validated look, memory off', async () => {
  const prompts = [];
  globalThis.fetch = async (_u, init) => { prompts.push(JSON.parse(init.body).contents[0].parts[0].text); return reply({ ...goodLook, evidence: 'SECRET-EVIDENCE' }); };
  const r1 = await call(route, { body: lookBody() });
  assert.equal(r1.code, 200);
  assert.equal(r1.body.nextStep, 'Type one sentence under Causes.');
  await call(route, { body: lookBody(), ip: '9.9.9.9' });
  assert.doesNotMatch(prompts[1], /SECRET-EVIDENCE/, 'no state shared between visitors');
});

test('quests: 200 with a v2 plan; a model failure is a 502 (not a silent local fallback)', async () => {
  globalThis.fetch = async () => reply(goodQuests);
  const ok = await call(route, { body: { kind: 'quests', task: 'my water cycle essay' } });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.quests.length, 3);
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE' } }) });
  const bad = await call(route, { body: { kind: 'quests', task: 'x' }, ip: '5.5.5.5' });
  assert.equal(bad.code, 502);
});

test('look: a model failure is a 502 so the shim can swap in the recorded answer', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.equal((await call(route, { body: lookBody() })).code, 502);
});

test('sample must be in the whitelist; path tricks and uploads are rejected with 400', async () => {
  globalThis.fetch = async () => reply(goodLook);
  for (const sample of ['../.env', 'essay-blank.jpg', 'nope', '', 5, null, 'ESSAY-BLANK']) {
    assert.equal((await call(route, { body: lookBody({ sample }), ip: `7.7.7.${Math.random() * 200 | 0}` })).code, 400, String(sample));
  }
  assert.equal((await call(route, { body: lookBody({ jpegBase64: 'AAAA', image: 'AAAA' }), ip: '8.8.8.8' })).code, 200, 'extra fields are ignored, never used as the image');
});

test('bad bodies are 400: unknown kind/purpose, non-object, oversized text', async () => {
  globalThis.fetch = async () => reply(goodLook);
  const bodies = [null, 'str', [], { kind: 'x' }, lookBody({ purpose: 'rm -rf' }), { kind: 'quests', task: 'x'.repeat(301) }, lookBody({ task: 'x'.repeat(301) }), lookBody({ quest: { title: 'x'.repeat(301), finish: 'a' } }), lookBody({ quest: null })];
  let i = 0;
  for (const body of bodies) assert.equal((await call(route, { body, ip: `6.6.6.${i++}` })).code, 400, JSON.stringify(body)?.slice(0, 40));
});

test('only POST; others get 405', async () => {
  assert.equal((await call(route, { method: 'GET' })).code, 405);
});

test('rate limit: per-IP 6/min — the 7th request in a minute is a 429, INVALID requests count too', async () => {
  globalThis.fetch = async () => reply(goodLook);
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push((await call(route, { body: { kind: 'garbage' }, ip: '4.4.4.4' })).code);
  assert.deepEqual(codes.slice(0, 6), [400, 400, 400, 400, 400, 400]);
  assert.equal(codes[6], 429);
  assert.equal((await call(route, { body: lookBody(), ip: '4.4.4.4' })).body.limited, true);
  assert.equal((await call(route, { body: lookBody(), ip: '4.4.4.5' })).code, 200, 'another IP is unaffected');
});

test('rate limit: global daily cap 400 trips for everyone', async () => {
  globalThis.fetch = async () => reply(goodLook);
  let last;
  for (let i = 0; i < 401; i++) last = await call(route, { body: lookBody(), ip: `10.${(i / 250) | 0}.${i % 250}.1` });
  assert.equal(last.code, 429);
});

test('mock mode (no key) is a 503, never canned "mock:" text to a visitor', async () => {
  delete process.env.GEMINI_API_KEY;
  delete require.cache[require.resolve('../api/model.js')];
  const r = require('../api/model.js');
  assert.equal((await call(r, { body: lookBody() })).code, 503);
});

test('the key never appears in any response body', async () => {
  globalThis.fetch = async () => reply(goodLook);
  const r = await call(route, { body: lookBody() });
  assert.doesNotMatch(JSON.stringify(r), /test-key-not-real/);
});

test('route sets the Vercel limits: 6 s timeout, no retries', async () => {
  const seen = [];
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = (n) => { seen.push(n); return orig.call(AbortSignal, n); };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; };
  try { await call(route, { body: lookBody() }); } finally { AbortSignal.timeout = orig; delete process.env.QUESTLING_TIMEOUT_MS; delete process.env.QUESTLING_RETRIES; }
  assert.equal(seen[0], 6000);
  assert.equal(calls, 1);
});
