// Vercel function: the public web demo's only door to the model. POST { kind:'quests'|'look', ... }.
// The key lives in this function's env and never leaves it. The image is read server-side from a
// whitelist of staged samples, so the route never accepts an upload. Limiter state is in memory per
// function instance: best-effort, the hard $0 cap is a Gemini key from a project with billing off.
const fs = require('node:fs');
const path = require('node:path');

// Vercel limits: 6 s per call, no retries; failures are fast non-200s and the shim swaps in recorded answers.
process.env.PENSUM_TIMEOUT_MS = '6000';
process.env.PENSUM_RETRIES = '0';
// Flash answered quests in 8-16 s: past the 6 s budget, so the web route plans with lite unless GEMINI_MODEL says otherwise.
process.env.GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const ai = require('../ai.js');
const { rateGate } = require('../logic.js');

const SAMPLES = new Set(['essay-blank', 'essay-midway', 'outline-done', 'video-site', 'injection']);
const PURPOSES = new Set(['stuck', 'check', 'done', 'reentry']);
const MAX_TEXT = 300;
const PER_MIN = 6;
const PER_IP_DAY = 40;
const GLOBAL_DAY = 400;

const ips = new Map(); // ip -> { stamps, day, count }
const global = { day: '', count: 0 };
const today = () => new Date().toISOString().slice(0, 10);

function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown');
}

// Runs first on every request, valid or not. Returns true if the request may proceed.
function admit(ip, now) {
  const day = today();
  if (global.day !== day) { global.day = day; global.count = 0; }
  if (global.count >= GLOBAL_DAY) return false;
  if (ips.size > 5000) ips.clear();
  const e = ips.get(ip) || { stamps: [], day, count: 0 };
  if (e.day !== day) { e.day = day; e.count = 0; }
  if (e.count >= PER_IP_DAY) return false;
  const g = rateGate(e.stamps, now, { perMin: PER_MIN });
  e.stamps = g.stamps;
  ips.set(ip, e);
  if (!g.ok) return false;
  e.count++;
  global.count++;
  return true;
}

const str = (v, { min = 0 } = {}) => typeof v === 'string' && v.length >= min && v.length <= MAX_TEXT;

function parseBody(b) {
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } }
  return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

module.exports = async function handler(req, res) {
  if (!admit(clientIp(req), Date.now())) return res.status(429).json({ limited: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (ai.isMock()) return res.status(503).json({ error: 'model unavailable' });

  const b = parseBody(req.body);
  if (!b) return res.status(400).json({ error: 'bad body' });

  try {
    if (b.kind === 'quests') {
      if (!str(b.task, { min: 1 })) return res.status(400).json({ error: 'bad task' });
      const q = await ai.quests({ text: b.task, now: new Date().toISOString(), tzOffset: 0 });
      if (q.fallback || q.mock) return res.status(502).json({ error: 'model failed' });
      return res.status(200).json({ deadline_iso: q.deadline_iso, starter: q.starter, quests: q.quests });
    }
    if (b.kind === 'look') {
      const quest = b.quest;
      if (!PURPOSES.has(b.purpose) || !SAMPLES.has(b.sample) || !str(b.task)) return res.status(400).json({ error: 'bad look' });
      if (!quest || typeof quest !== 'object' || !str(quest.title, { min: 1 }) || !str(quest.finish)) return res.status(400).json({ error: 'bad quest' });
      const jpeg = fs.readFileSync(path.join(__dirname, '..', 'demo', 'samples', `${b.sample}.jpg`));
      const v = await ai.look({
        purpose: b.purpose, jpegBase64: jpeg.toString('base64'), memory: false,
        quest: { title: quest.title, finish: quest.finish },
        ctx: { task: b.task, quests: [{ title: quest.title, done: false }] },
      });
      if (v.error) return res.status(502).json({ error: 'model failed' });
      return res.status(200).json(v);
    }
  } catch {
    return res.status(502).json({ error: 'model failed' });
  }
  return res.status(400).json({ error: 'bad kind' });
};
