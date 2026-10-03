const clientIp = (req) => { const h = req.headers || {}; return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'); };
const isJson = (req) => /^application\/json\b/i.test(String(req.headers?.['content-type'] || ''));
function body(req) { let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return null; } } return b && typeof b === 'object' && !Array.isArray(b) ? b : null; }
module.exports = { clientIp, isJson, body };
