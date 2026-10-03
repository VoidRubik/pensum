// The exe's and the web demo's only door to the model. Key lives in this function's env only.
// Order: method -> per-IP limit (counts invalid spam too) -> content-type -> strict schema -> key
//        -> global daily budget (valid bodies only) -> one model call.
// Every failure the client can recover from is { fallback:'mock' }. Never logs bodies.
// 8 s model budget: looks measured 1.2-2.2 s; the exe gives up at 10 s and the renderer backstop is 13 s (app.js:50),
// so an answer is never computed after the client stopped waiting.
process.env.PENSUM_TIMEOUT_MS = process.env.PENSUM_TIMEOUT_MS || '8000';
process.env.PENSUM_RETRIES = '0';
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'; // flash plans take 8-16 s; one model = one quota pool
const ai = require('../ai.js');
const { parse } = require('./_lib/schema.js');
const lim = require('./_lib/limit.js');
const { clientIp, isJson, body } = require('./_lib/http.js');
const PURPOSE = { stuck: 'stuck', drift: 'check', confirm: 'done', reentry: 'reentry' };

function make({ limiter }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const refuse = (gate) => {
      if (gate.reason === 'rate') { res.setHeader('Retry-After', String(gate.retryAfterSec)); return res.status(429).json({ fallback: 'mock', reason: 'rate', retryAfterSec: gate.retryAfterSec }); }
      return res.status(503).json({ fallback: 'mock', reason: 'limiter' });
    };
    const ipGate = await limiter.checkIp(clientIp(req));
    if (!ipGate.ok) return refuse(ipGate);
    if (!isJson(req)) return res.status(415).json({ error: 'json only' });
    const raw = body(req);
    if (!raw) return res.status(400).json({ error: 'bad body', issues: ['not a JSON object'] });
    const p = parse(raw);
    if (!p.body) return res.status(p.status).json({ error: p.error, ...(p.issues ? { issues: p.issues } : {}) });
    if (ai.isMock()) return res.status(503).json({ fallback: 'mock', reason: 'no-key' });
    const globalGate = await limiter.checkGlobal();
    if (!globalGate.ok) return refuse(globalGate);
    const b = p.body;
    try {
      if (b.mode === 'plan') {
        const q = await ai.quests({ text: b.goal, now: new Date().toISOString(), tzOffset: b.tzOffset || 0 });
        if (q.fallback || q.mock) return res.status(200).json({ fallback: 'mock', reason: 'model' });
        return res.status(200).json({ ok: true, result: { deadline_iso: q.deadline_iso, starter: q.starter, quests: q.quests } });
      }
      const v = await ai.look({
        purpose: PURPOSE[b.mode], jpegBase64: b.screenshot, memory: false, quest: b.quest,
        ctx: { task: b.goal, quests: b.quests || [{ title: b.quest.title, done: false }], windowTitle: b.windowTitle || null },
      });
      if (v.error) return res.status(200).json({ fallback: 'mock', reason: v.status === 0 ? 'timeout' : 'model' });
      return res.status(200).json({ ok: true, result: v });
    } catch { return res.status(200).json({ fallback: 'mock', reason: 'model' }); }
  };
}
module.exports = make({ limiter: lim.fromEnv() || lim.CLOSED });
module.exports.make = make;
