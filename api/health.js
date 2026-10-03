// Deploy smoke check. Booleans and numbers only, never a secret.
const ai = require('../ai.js');
const lim = require('./_lib/limit.js');
module.exports = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', live: !ai.isMock(), limiter: lim.fromEnv() ? 'upstash' : 'none', globalDay: lim.GLOBAL_DAY() });
};
