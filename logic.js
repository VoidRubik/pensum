// Pure functions, zero deps, node --test-able. Phase 1: progress, verdict
// validation, quest fallback. Phase 2 adds: nudge schedule, off-task rule,
// frame diff (see brainstorms/brief-20260927-183530-questling.md, Slices).

/** Progress within [0,1] across `total` quests. Never moves backwards —
 * pass the last returned value as `previous` and a regressed estimate
 * clamps to it instead of dropping the bar. */
function computeProgress({ questsDone, total, currentEstimate, previous }) {
  if (!total || total <= 0) throw new Error('total must be > 0');
  const clampedEstimate = Math.max(0, Math.min(100, currentEstimate || 0));
  const raw = (questsDone + clampedEstimate / 100) / total;
  const value = Math.max(0, Math.min(1, raw));
  if (typeof previous === 'number' && value < previous) return previous;
  return value;
}

/** Schema check on model output. Returns boolean, never throws — callers
 * treat `false` as "keep state, retry next cycle" (see ai.js). */
function validateVerdict(v) {
  if (!v || typeof v !== 'object') return false;
  const shape = {
    on_task: 'boolean',
    quest_done: 'boolean',
    progress_estimate: 'number',
    pet_line: 'string',
    reason: 'string',
  };
  for (const [key, type] of Object.entries(shape)) {
    if (typeof v[key] !== type) return false;
  }
  if (v.progress_estimate < 0 || v.progress_estimate > 100) return false;
  return true;
}

/** Used when quest generation fails or returns malformed JSON. */
function questFallback() {
  return [
    { title: 'Make a first pass', finish: 'You have written or changed something toward the task.' },
    { title: 'Get it mostly working', finish: 'The main flow runs, even roughly.' },
    { title: 'Clean up and finish', finish: 'You would show this to someone else.' },
  ];
}

/** Verdict carries the {idx, epoch} it was judged for; drop it if the renderer moved on. */
function isStale(v, cur) {
  return v.idx !== cur.idx || v.epoch !== cur.epoch;
}

/** Worried only after 2 consecutive off-task. `suppress` (user override) eats the next verdict. */
function offTaskStep({ off, suppress }, onTask) {
  if (suppress) return { worried: false, state: { off: 0, suppress: false } };
  const n = onTask ? 0 : off + 1;
  return { worried: n >= 2, state: { off: n, suppress: false } };
}

/** Auto-complete on 2 consecutive quest_done for the same quest; `locked` = user undid it. */
function doneStep({ idx, n }, curIdx, questDone, locked) {
  const streak = questDone ? (idx === curIdx ? n + 1 : 1) : 0;
  if (locked) return { complete: false, state: { idx: curIdx, n: streak } };
  return { complete: streak >= 2, state: { idx: curIdx, n: streak >= 2 ? 0 : streak } };
}

/** Deadline checkpoints. Returns {speak, fired}; speak = latest newly-crossed, only if behind schedule. */
function nudgeDue({ startedAt, deadline, now, progress, fired }) {
  const total = deadline - startedAt;
  if (!(total > 0) || !Number.isFinite(now)) return { speak: null, fired };
  const elapsed = Math.max(0, Math.min(1, (now - startedAt) / total));
  const remaining = deadline - now;
  const crossed = [];
  if (1 - elapsed <= 0.5) crossed.push('50');
  if (1 - elapsed <= 0.25) crossed.push('25');
  if (1 - elapsed <= 0.1) crossed.push('10');
  if (total > 20 * 60000 && remaining <= 10 * 60000) crossed.push('left10');
  const fresh = crossed.filter((c) => !fired.includes(c));
  if (!fresh.length) return { speak: null, fired };
  return { speak: progress < elapsed ? fresh[fresh.length - 1] : null, fired: [...fired, ...fresh] };
}

const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Today's totals from ledger lines. Day = local date. */
function summarizeUsage(lines, day) {
  const out = { checks: 0, autoChecks: 0, tokens: 0 };
  for (const l of lines) {
    if (dayKey(l.ts) !== day) continue;
    if (l.kind === 'check') { out.checks++; if (l.auto) out.autoChecks++; }
    out.tokens += (l.promptTokens || 0) + (l.outputTokens || 0) + (l.thoughtsTokens || 0);
  }
  return out;
}

/** Next auto-check delay in ms, or null = stop for the day. 429 per-minute backs off, cap 15 min. */
function nextInterval(base, { status, perDay, retryDelayMs } = {}) {
  if (status !== 429) return base;
  if (perDay) return null;
  return Math.min(15 * 60000, Math.max(retryDelayMs || 0, 2 * base));
}

const exported = { computeProgress, validateVerdict, questFallback, isStale, offTaskStep, doneStep, nudgeDue, summarizeUsage, nextInterval, dayKey };

// Dual CommonJS (main process, node --test) / browser global (renderer via
// a plain <script> tag — no build step, no bundler).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (typeof window !== 'undefined') {
  window.QuestlingLogic = exported;
}
