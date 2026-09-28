// POST { text, now, tzOffset } -> { deadline_iso, quests: [{title, finish}] }
// Server-side only: GEMINI_API_KEY never reaches the client.
const { callGemini } = require('./_gemini.js');
const { questFallback, isAllowedOrigin, createRateLimiter } = require('../logic.js');

const limiter = createRateLimiter(2000); // best-effort only, see logic.js

const QUEST_SCHEMA = {
  type: 'object',
  properties: {
    deadline_iso: { type: 'string' },
    quests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          finish: { type: 'string' },
        },
        required: ['title', 'finish'],
      },
    },
  },
  required: ['deadline_iso', 'quests'],
};

function defaultDeadline(now) {
  const base = now ? new Date(now) : new Date();
  base.setHours(base.getHours() + 1);
  return base.toISOString();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!isAllowedOrigin({ origin: req.headers.origin, referer: req.headers.referer, host: process.env.DEPLOY_HOST })) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }
  const clientId = req.headers['x-session-id'] || req.socket?.remoteAddress || 'unknown';
  if (!limiter.allow(clientId)) {
    res.status(429).json({ error: 'slow down' });
    return;
  }

  const { text, now, tzOffset } = req.body || {};
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'text required' });
    return;
  }

  const mock = process.env.GEMINI_API_KEY === undefined || req.query?.mock === '1';
  if (mock) {
    res.status(200).json({
      deadline_iso: defaultDeadline(now),
      quests: questFallback(),
      mock: true,
    });
    return;
  }

  try {
    const prompt = `Task: "${text}". Current time: ${now}, timezone offset (minutes): ${tzOffset}.
Break this into 3 to 6 concrete quests, each with a visible, checkable finish condition.
Also infer a reasonable deadline_iso (ISO 8601) if the task implies one, otherwise default to
1 hour from now.`;
    const result = await callGemini({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      responseSchema: QUEST_SCHEMA,
    });
    if (!Array.isArray(result?.quests) || result.quests.length === 0 || !result.deadline_iso) {
      throw new Error('malformed quest response');
    }
    res.status(200).json({ deadline_iso: result.deadline_iso, quests: result.quests.slice(0, 6) });
  } catch (e) {
    // Quest generation failure falls back to 3 generic quests (brief risk note).
    res.status(200).json({ deadline_iso: defaultDeadline(now), quests: questFallback(), fallback: true, reason: String(e.message || e) });
  }
};
