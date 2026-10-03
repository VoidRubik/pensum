// Exe -> Vercel proxy client. Runs in Electron main. No key here: the proxy holds it.
// Any failure (rate limit, offline, 401, timeout, junk) returns the local mock answer flagged mock:true,
// so the renderer shows MOCK MODE instead of failing silently.
const { validateLook, validateQuests } = require('./logic.js');
const MODE = { stuck: 'stuck', check: 'drift', done: 'confirm', reentry: 'reentry' };
const cut = (s, n) => String(s || '').slice(0, n);
function aiMode(env, { test } = {}) {
  if (env.PENSUM_MOCK === '1') return 'mock';
  if (env.GEMINI_API_KEY) return 'own-key';
  if (test && !env.PENSUM_API) return 'mock'; // tests never reach production
  return 'live';
}
function toBody(kind, a) {
  if (kind === 'quests') return { mode: 'plan', goal: cut(a.text, 300), tzOffset: Number.isInteger(a.tzOffset) ? Math.max(-840, Math.min(840, a.tzOffset)) : 0 };
  const b = {
    mode: MODE[a.purpose], goal: cut(a.ctx?.task, 300) || 'my task',
    quest: { title: cut(a.quest?.title, 120) || 'quest', finish: cut(a.quest?.finish, 200) },
    screenshot: a.jpegBase64,
  };
  if (a.ctx?.quests?.length) b.quests = a.ctx.quests.slice(0, 6).map((q) => ({ title: cut(q.title, 120) || 'quest', done: !!q.done }));
  if (a.ctx?.windowTitle) b.windowTitle = cut(a.ctx.windowTitle, 120);
  return b;
}
// 10 s: under the renderer's 13 s look backstop (app.js:50), over the server's 8 s model budget.
async function post(body, { base, fetch, timeoutMs = 10000 }) {
  const r = await fetch(`${base}/api/pet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const j = await r.json().catch(() => null);
  return { result: r.ok && j && j.ok ? j.result : null };
}
async function look(a, d) {
  try {
    const p = await post(toBody('look', { ...a, jpegBase64: d.resize(a.jpegBase64) }), d);
    const ok = p.result && validateLook(p.result);
    if (ok) return ok;
  } catch {}
  return { ...(await d.ai.look(a)), mock: true }; // ai.look has no key here -> scripted mock
}
async function quests(a, d) {
  try {
    const p = await post(toBody('quests', a), d);
    const ok = p.result && validateQuests(p.result);
    if (ok) return ok; // validateQuests already carries deadline_iso
  } catch {}
  return { ...(await d.ai.quests(a)), mock: true };
}
module.exports = { aiMode, toBody, look, quests };
