// Sole writer of usage.jsonl (text metadata only). One JSON line per real Gemini call.
const fs = require('node:fs');
const path = require('node:path');
const { summarizeUsage, dayKey } = require('./logic.js');

let file = process.env.PENSUM_LEDGER_PATH || null;
const unsaved = []; // entries whose write failed
function init(dir) { if (!file) file = path.join(dir, 'usage.jsonl'); }

function append(entry) {
  for (const v of Object.values(entry)) {
    if (typeof v === 'string' && v.length > 500) throw new Error('ledger: string too long (image data?)');
  }
  // A failed write must not discard an answer that was already paid for: only the image-data guard above throws.
  // The call still counts toward the daily cap (kept in memory), so a full disk cannot switch the cap off.
  if (!file) return;
  const line = { ts: Date.now(), ...entry };
  try { fs.appendFileSync(file, JSON.stringify(line) + '\n'); } catch { unsaved.push(line); }
}

function read() {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  } catch { return []; }
}

const today = () => summarizeUsage([...read(), ...unsaved], dayKey(Date.now()));

module.exports = { init, append, read, today };
