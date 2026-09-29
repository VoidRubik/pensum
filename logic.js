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

/** A `quest_done` verdict becomes a proposal unless the user said "not yet" for that quest.
 * `suppress[idx]` = auto checks left to stay quiet; manual checks never use it up. */
function proposeStep(state, { idx, questDone, auto }) {
  const left = state.suppress[idx] || 0;
  if (!questDone) return { propose: false, state };
  if (left > 0) {
    const suppress = auto ? { ...state.suppress, [idx]: left - 1 } : state.suppress;
    return { propose: false, state: { ...state, suppress } };
  }
  return { propose: true, state };
}

/** User answered "Not yet" to a proposal: stay quiet on that quest for its next 2 auto checks. */
function notYet(state, idx) {
  return { ...state, suppress: { ...state.suppress, [idx]: 2 } };
}

/** The quest being worked on: the user's pick if still open, else the first open one, -1 if all done. */
function currentIdx({ current, done }) {
  if (Number.isInteger(current) && done[current] === false) return current;
  return done.findIndex((d) => !d);
}

const TITLE_DENY_PROC = /keepass|1password|bitwarden|lastpass|dashlane/i;
const TITLE_DENY_WORDS = /incognito|inprivate|private browsing|navegaci[oó]n privada|bank|banco|banking|paypal|password|contrase/i;

/** Window title safe to send, or null. Private windows, password managers, banking words are dropped. */
function redactTitle(proc, title) {
  if (TITLE_DENY_PROC.test(proc || '') || TITLE_DENY_WORDS.test(title || '')) return null;
  return title || null;
}

const fmtDur = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? `${s % 60}s` : ''}`;
};

/** "WINWORD 'Essay.docx' 2m40s · chrome 'YouTube' 30s" — time per window within [since, now], longest first.
 * Each event is active until the next one; `titles:false` sends process names only. Windows under 5 s are noise. */
function focusSummary(events, since, now, { titles = true } = {}) {
  const totals = new Map();
  events.forEach((e, i) => {
    const end = i + 1 < events.length ? events[i + 1].ts : now;
    const ms = Math.min(end, now) - Math.max(e.ts, since);
    if (ms < 5000) return;
    const title = titles ? redactTitle(e.process, e.title) : null;
    const key = `${e.process}\u0000${title || ''}`;
    totals.set(key, (totals.get(key) || 0) + ms);
  });
  return [...totals.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 4)
    .map(([k, ms]) => {
      const [proc, title] = k.split('\u0000');
      return `${proc}${title ? ` '${title}'` : ''} ${fmtDur(ms)}`;
    })
    .join(' · ');
}

/** Skip the paid check silently when the user is away: locked, or idle >= max(interval, 5 min). */
function shouldSkip(idleSec, locked, baseMs) {
  return !!locked || idleSec >= Math.max(baseMs / 1000, 300);
}

/** Keep the head (30%) and the tail (70%) of a long document — the end is where the writing stopped. */
function capMiddle(text, max) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.3);
  return `${text.slice(0, head)}
[... middle of the document left out ...]
${text.slice(text.length - (max - head))}`;
}

/** Cheap summary of long work that goes with every check: size, headings, and where the writing stopped. */
function artifactDigest(text) {
  const t = text || '';
  return {
    words: t.split(/\s+/).filter(Boolean).length,
    headings: t.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.trim().slice(0, 80)).slice(0, 12),
    tail: t.slice(-800),
  };
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

const exported = { computeProgress, validateVerdict, questFallback, isStale, offTaskStep, proposeStep, notYet, currentIdx, redactTitle, focusSummary, shouldSkip, artifactDigest, capMiddle, nudgeDue, summarizeUsage, nextInterval, dayKey };

// Dual CommonJS (main process, node --test) / browser global (renderer via
// a plain <script> tag — no build step, no bundler).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (typeof window !== 'undefined') {
  window.QuestlingLogic = exported;
}
