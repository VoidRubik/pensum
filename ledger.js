// Sole writer of usage.jsonl (text metadata only). One JSON line per real Gemini call.
const fs = require('node:fs');
const path = require('node:path');
const { summarizeUsage, dayKey } = require('./logic.js');

let file = process.env.QUESTLING_LEDGER_PATH || null;
function init(dir) { if (!file) file = path.join(dir, 'usage.jsonl'); }

function append(entry) {
  for (const v of Object.values(entry)) {
    if (typeof v === 'string' && v.length > 500) throw new Error('ledger: string too long (image data?)');
  }
  if (file) fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
}

function read() {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  } catch { return []; }
}

const today = () => summarizeUsage(read(), dayKey(Date.now()));

module.exports = { init, append, read, today };
