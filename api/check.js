// POST { jpegBase64, quest } -> { on_task, quest_done, progress_estimate, pet_line, reason }
// Server-side only. Body capped at 1.5MB, JPEG-only prefix check, never logs the body.
const { callGemini } = require('./_gemini.js');
const { validateVerdict, isAllowedOrigin, createRateLimiter } = require('../logic.js');

const limiter = createRateLimiter(50 * 1000); // best-effort: ~1 check / 50s per session (see logic.js)
const MAX_BODY_BYTES = 1.5 * 1024 * 1024;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    on_task: { type: 'boolean' },
    quest_done: { type: 'boolean' },
    progress_estimate: { type: 'number' },
    pet_line: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['on_task', 'quest_done', 'progress_estimate', 'pet_line', 'reason'],
};

function mockVerdict(seed) {
  // Deterministic-ish scripted verdicts so the mock flow is verifiable and
  // demoable at $0 (brief Improvements: "Mock model").
  const onTask = seed % 3 !== 0;
  return {
    on_task: onTask,
    quest_done: seed % 5 === 0,
    progress_estimate: Math.min(100, (seed * 17) % 100),
    pet_line: onTask ? 'pet nods, watching closely' : 'pet tilts its head, unsure',
    reason: 'mock mode: scripted verdict, no vision call made',
  };
}

let mockCounter = 0;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!isAllowedOrigin({ origin: req.headers.origin, referer: req.headers.referer, host: process.env.DEPLOY_HOST })) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }

  const { jpegBase64, quest } = req.body || {};
  if (!jpegBase64 || typeof jpegBase64 !== 'string') {
    res.status(400).json({ error: 'jpegBase64 required' });
    return;
  }
  if (!jpegBase64.startsWith('/9j/')) {
    // JPEG magic bytes (0xFFD8FF) base64-encode to a "/9j/" prefix.
    res.status(400).json({ error: 'not a JPEG' });
    return;
  }
  if (jpegBase64.length * 0.75 > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'frame too large' });
    return;
  }

  const clientId = req.headers['x-session-id'] || req.socket?.remoteAddress || 'unknown';
  const rateOk = limiter.allow(clientId);

  const mock = process.env.GEMINI_API_KEY === undefined || req.query?.mock === '1';
  if (mock) {
    mockCounter += 1;
    res.status(200).json(mockVerdict(mockCounter));
    return;
  }

  if (!rateOk) {
    res.status(429).json({ error: 'slow down' });
    return;
  }

  try {
    const prompt = `The user's current quest is: "${quest?.title}" (finish condition: "${quest?.finish}").
Look at the attached screenshot of their screen. Judge: are they on-task, is the quest finished,
and roughly what percent of this quest looks done (0-100)? Reply as the given JSON schema. Keep
pet_line short and in-character for a small encouraging screen pet.`;
    const result = await callGemini({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
        ],
      }],
      responseSchema: VERDICT_SCHEMA,
    });
    if (!validateVerdict(result)) {
      throw new Error('verdict failed schema validation');
    }
    res.status(200).json(result);
  } catch (e) {
    // Keep state, retry next cycle (brief risk note) — the client interprets
    // a 502 as "no verdict this tick," not as off-task.
    res.status(502).json({ error: 'model check failed, retrying next cycle', pet_line: 'my eyes blurred, trying again soon' });
  }
};
