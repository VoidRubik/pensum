// Shared limits across every function instance (Upstash Redis). Fails CLOSED: Redis missing, erroring or
// slow -> { ok:false, reason:'limiter' } -> the client goes to mock.
// checkIp runs BEFORE parsing (spam still counts against its sender); checkGlobal runs only for a VALID body,
// right before the model call, so junk requests can never drain the shared daily budget.
// x-forwarded-for is overwritten by Vercel's edge, so it can't be spoofed; IPv6 is keyed per /64 (one user's block).
const PER_MIN = 15, PER_DAY = 150;
const GLOBAL_DAY = () => Number(process.env.PENSUM_GLOBAL_DAY) || 500; // set to ~70% of the model's free RPD
function ipKey(ip) {
  const s = String(ip);
  if (!s.includes(':')) return s;
  const [head] = s.split('::');
  const parts = head.split(':').filter(Boolean);
  return [...parts, '0', '0', '0', '0'].slice(0, 4).join(':') + '::/64';
}
function makeLimiter({ perMin, perDay, global, timeoutMs = 1500 }) {
  const within = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('limiter timeout')), timeoutMs))]);
  const after = (reset) => Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  const step = async (rl, key) => { const r = await within(rl.limit(key)); return r.success ? null : { ok: false, reason: 'rate', retryAfterSec: after(r.reset) }; };
  return {
    async checkIp(ip) {
      try { const k = ipKey(ip); return (await step(perMin, k)) || (await step(perDay, k)) || { ok: true }; } catch { return { ok: false, reason: 'limiter' }; }
    },
    async checkGlobal() {
      try { return (await step(global, 'all')) || { ok: true }; } catch { return { ok: false, reason: 'limiter' }; }
    },
  };
}
// Vercel Marketplace Upstash injects either UPSTASH_REDIS_REST_* or KV_REST_API_* depending on the integration: accept both.
function fromEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const { Redis } = require('@upstash/redis');
  const { Ratelimit } = require('@upstash/ratelimit');
  const redis = new Redis({ url, token });
  const mk = (limiter, prefix) => new Ratelimit({ redis, limiter, prefix, analytics: false });
  return makeLimiter({
    perMin: mk(Ratelimit.slidingWindow(PER_MIN, '1 m'), 'pensum:min'),
    perDay: mk(Ratelimit.fixedWindow(PER_DAY, '1 d'), 'pensum:day'),
    global: mk(Ratelimit.fixedWindow(GLOBAL_DAY(), '1 d'), 'pensum:all'),
  });
}
const no = async () => ({ ok: false, reason: 'limiter' });
const CLOSED = { checkIp: no, checkGlobal: no }; // no Redis configured -> never call the model
module.exports = { makeLimiter, fromEnv, ipKey, CLOSED, PER_MIN, PER_DAY, GLOBAL_DAY };
