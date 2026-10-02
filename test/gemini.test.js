// callGemini timeout/retry behaviour with a stubbed fetch.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { callGemini } = require('../gemini.js');

const realFetch = globalThis.fetch;
beforeEach(() => { process.env.GEMINI_API_KEY = 'test-key'; });
afterEach(() => { globalThis.fetch = realFetch; });

const ok = () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: {} }) });
const err = (status) => ({ ok: false, status, json: async () => ({ error: { status: 'UNAVAILABLE' } }) });
const args = { model: 'm', contents: [], responseSchema: {} };

test('callGemini: one retry on 503 then succeeds', async () => {
  const seq = [err(503), ok()];
  let calls = 0;
  globalThis.fetch = async () => seq[calls++];
  const r = await callGemini({ ...args, retries: 1 });
  assert.equal(calls, 2);
  assert.deepEqual(r.data, { a: 1 });
});

test('callGemini: gives up after the retries are spent and throws the 503', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return err(503); };
  await assert.rejects(callGemini({ ...args, retries: 1 }), (e) => e.status === 503);
  assert.equal(calls, 2);
});

test('callGemini: never retries a 400 or a 429', async () => {
  for (const s of [400, 429]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return err(s); };
    await assert.rejects(callGemini({ ...args, retries: 1 }));
    assert.equal(calls, 1, `status ${s}`);
  }
});

test('callGemini: retries a timeout once, and timeoutMs reaches the abort signal', async () => {
  let calls = 0;
  globalThis.fetch = async (_u, { signal }) => {
    calls++;
    return new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
  };
  const t0 = Date.now();
  const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout timers are unref'd
  try { await assert.rejects(callGemini({ ...args, timeoutMs: 40, retries: 1 }), (e) => e.code === 'NETWORK'); } finally { clearTimeout(keepAlive); }
  assert.equal(calls, 2);
  assert.ok(Date.now() - t0 < 1000, 'default 8 s must not apply');
});

test('callGemini: default timeout is 8 s (not the old 20 s)', async () => {
  let ms = null;
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = (n) => { ms = n; return orig.call(AbortSignal, n); };
  globalThis.fetch = async () => ok();
  try { await callGemini(args); } finally { AbortSignal.timeout = orig; }
  assert.equal(ms, 8000);
});

test('ai.quests: flash timeout/503 gets one retry on lite, 12 s timeout', async () => {
  delete process.env.QUESTLING_MOCK;
  const ai = require('../ai.js');
  const models = [];
  const timeouts = [];
  const orig = AbortSignal.timeout;
  AbortSignal.timeout = (n) => { timeouts.push(n); return orig.call(AbortSignal, n); };
  const good = JSON.stringify({ deadline_iso: '2026-10-02T10:00:00Z', starter: 'Open the doc.', quests: [{ title: 'Write intro', finish: 'intro exists', minutes: 5 }] });
  globalThis.fetch = async (url) => {
    models.push(/models\/([^:]+):/.exec(url)[1]);
    return models.length === 1 ? err(503) : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: good }] } }], usageMetadata: {} }) };
  };
  try {
    const r = await ai.quests({ text: 'essay', now: '2026-10-02T09:00:00Z', tzOffset: 0 });
    assert.equal(r.fallback, undefined, 'must not fall back to local quests');
  } finally { AbortSignal.timeout = orig; }
  assert.deepEqual(models, ['gemini-3.5-flash', 'gemini-3.5-flash-lite']);
  assert.equal(timeouts[0], 12000);
});
