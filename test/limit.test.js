const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeLimiter, ipKey } = require('../api/_lib/limit.js');
const rl = (success, reset = Date.now() + 30000) => ({ limit: async () => ({ success, reset }) });
test('all pass -> ok', async () => {
  const L = makeLimiter({ perMin: rl(true), perDay: rl(true), global: rl(true) });
  assert.deepEqual(await L.checkIp('1.1.1.1'), { ok: true });
  assert.deepEqual(await L.checkGlobal(), { ok: true });
});
test('per-minute exceeded -> rate + retryAfterSec>0', async () => {
  const r = await makeLimiter({ perMin: rl(false), perDay: rl(true), global: rl(true) }).checkIp('1.1.1.1');
  assert.equal(r.ok, false); assert.equal(r.reason, 'rate'); assert.ok(r.retryAfterSec > 0);
});
test('global exhausted -> rate', async () => {
  assert.equal((await makeLimiter({ perMin: rl(true), perDay: rl(true), global: rl(false) }).checkGlobal()).reason, 'rate');
});
test('redis throws -> limiter (closed)', async () => {
  const r = await makeLimiter({ perMin: { limit: async () => { throw new Error('ECONNREFUSED'); } }, perDay: rl(true), global: rl(true) }).checkIp('x');
  assert.deepEqual(r, { ok: false, reason: 'limiter' });
});
test('redis hangs -> limiter after timeout (closed)', async () => {
  const r = await makeLimiter({ perMin: rl(true), perDay: rl(true), global: { limit: () => new Promise(() => {}) }, timeoutMs: 50 }).checkGlobal();
  assert.deepEqual(r, { ok: false, reason: 'limiter' });
});
test('ipKey: IPv6 collapses to /64, IPv4 unchanged', () => {
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:db8:1:2:bbbb::9'));
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  assert.equal(ipKey('1.2.3.4'), '1.2.3.4');
});
test('no redis env -> fromEnv returns null', () => {
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.KV_REST_API_URL;
  assert.equal(require('../api/_lib/limit.js').fromEnv(), null);
});
