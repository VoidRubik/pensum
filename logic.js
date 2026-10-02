// Pure functions, zero deps, node --test-able. Progress, quest + look validation,
// guards, proposal rules, nudges, usage, frame diff (see brainstorms/brief-20260927-183530-questling.md).

const STARTER_DEFAULT = 'Open the doc and type one ugly sentence.';

/** Progress in [0,1] over total+1 segments; segment 0 ("Plan made") starts filled. The active quest
 * adds up to 0.9 of its segment as time on it runs toward its timebox. Never moves backwards. */
function computeProgress({ done, total, activeMs, minutes, previous }) {
  if (!total || total <= 0) throw new Error('total must be > 0');
  const part = minutes > 0 ? Math.min(0.9, Math.max(0, activeMs || 0) / (minutes * 60000)) : 0;
  const value = Math.max(0, Math.min(1, (1 + done + part) / (total + 1)));
  if (typeof previous === 'number' && value < previous) return previous;
  return value;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const isStr = (x) => typeof x === 'string';

/** Quest schema v2 -> clamped/cut result, or null (caller falls back to questFallback()). */
function validateQuests(v) {
  if (!v || typeof v !== 'object' || !isStr(v.deadline_iso) || !v.deadline_iso || !Array.isArray(v.quests)) return null;
  if (v.quests.length < 3 || v.quests.some((x) => !x || !isStr(x.title) || !x.title.trim() || !isStr(x.finish))) return null;
  const quests = v.quests.slice(0, 5).map((x, i) => {
    const m = Number.isFinite(x.minutes) ? Math.round(x.minutes) : 15;
    return { title: x.title.trim().slice(0, 60), finish: x.finish.trim(), minutes: i === 0 ? clamp(m, 2, 5) : clamp(m, 10, 25) };
  });
  const starter = isStr(v.starter) && v.starter.trim() ? v.starter.trim().slice(0, 80) : STARTER_DEFAULT;
  return { deadline_iso: v.deadline_iso, starter, quests };
}

/** Used when quest generation fails or returns malformed JSON. */
function questFallback() {
  return {
    starter: STARTER_DEFAULT,
    quests: [
      { title: 'Make a first pass', finish: 'You have written or changed something toward the task.', minutes: 5 },
      { title: 'Get it mostly working', finish: 'The main flow runs, even roughly.', minutes: 15 },
      { title: 'Clean up and finish', finish: 'You would show this to someone else.', minutes: 15 },
    ],
  };
}

const LINK_OR_CODE = /https?:|www\.|:\/\/|@|`|<|>/i;
/** Text safe to render: trimmed, within max, no links/contact details/markup. Otherwise ''. */
function safeText(s, max) {
  if (!isStr(s)) return '';
  const t = s.trim();
  return t.length > max || LINK_OR_CODE.test(t) ? '' : t;
}

const TONE_BAD = /\b(must|should|failed|lazy)\b|again\?/i;
const toneOk = (line) => isStr(line) && !TONE_BAD.test(line);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** null when the line repeats (normalized) one of the last 30 spoken lines. */
function freshLine(line, history) {
  const n = norm(line);
  return history.slice(-30).some((h) => norm(h) === n) ? null : line;
}

/** One validator for every vision call. Strings are cut to their limit then made safe; anything else off-shape -> null. */
function validateLook(v) {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.onTask !== 'boolean' || typeof v.questDone !== 'boolean') return null;
  if (typeof v.confidence !== 'number' || !(v.confidence >= 0 && v.confidence <= 1)) return null;
  if (!isStr(v.evidence) || !isStr(v.nextStep) || !isStr(v.sayLine)) return null;
  return {
    onTask: v.onTask, confidence: v.confidence, questDone: v.questDone,
    evidence: safeText(v.evidence.slice(0, 90), 90),
    nextStep: safeText(v.nextStep.slice(0, 120), 120),
    sayLine: safeText(v.sayLine.slice(0, 70), 70),
  };
}

/** null below the confidence gate (unsolicited speech stays silent; clicks fall back to a local template). */
const gateLook = (v, min) => (v && v.confidence >= min ? v : null);

const GATE = 0.7;
/** Turn a look into UI effects. The model proposes; this never touches quest state (only click handlers do). */
function applyLook({ quests, idx, purpose, auto, sup }, look) {
  const g = gateLook(validateLook(look), GATE);
  const title = quests[idx].title;
  const out = { quests, sup, card: null };
  if (purpose === 'done') {
    out.card = g
      ? { kind: 'confirm', idx, title: 'Looks done?', body: title, evidence: g.evidence }
      : { kind: 'confirm', idx, title: 'Looks done?', body: "I can't tell from here — mark it done?", evidence: '' };
  } else if (purpose === 'stuck') {
    const step = g && g.nextStep && toneOk(g.nextStep) ? g.nextStep : `Tiny step: write one rough sentence for '${title}'.`;
    out.card = { kind: 'step', idx, title: 'Next tiny step', body: step };
  } else if (purpose === 'check' && g && g.questDone) {
    const p = proposeStep(sup, { idx, questDone: true, auto });
    out.sup = p.state;
    if (p.propose) out.card = { kind: 'confirm', idx, title: 'Looks done?', body: title, evidence: g.evidence };
  }
  return out;
}

/** Share of grayscale pixels that moved by more than `thr` (0..255). Different sizes count as fully changed. */
function diffFraction(a, b, thr = 24) {
  if (a.length !== b.length || !a.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thr) n++;
  return n / a.length;
}

let timeScale = 1;
const setTimeScale = (n) => { timeScale = Number.isFinite(n) && n > 0 ? n : 1; };
/** Every engine duration goes through here, so tests can run a session at N x speed. */
const dur = (ms) => ms / timeScale;

/** Persisted state of any older shape -> current shape, or null (back to onboarding). Idempotent. */
function migrate(s) {
  if (!s || typeof s !== 'object' || !isStr(s.text) || !Array.isArray(s.quests) || !s.quests.length) return null;
  if (s.quests.some((q) => !q || !isStr(q.title))) return null;
  const quests = s.quests.map((q, i) => ({ ...q, finish: isStr(q.finish) ? q.finish : '', minutes: Number.isFinite(q.minutes) ? q.minutes : i === 0 ? 5 : 15 }));
  const session = { allow: [], driftsAsked: 0, backOnTrack: 0, ...(s.session || {}) };
  return { ...s, quests, starter: isStr(s.starter) && s.starter ? s.starter : STARTER_DEFAULT, session };
}

/** Verdict carries the {idx, epoch} it was judged for; drop it if the renderer moved on. */
function isStale(v, cur) {
  return v.idx !== cur.idx || v.epoch !== cur.epoch;
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
  const out = { checks: 0, autoChecks: 0, calls: 0, tokens: 0 };
  for (const l of lines) {
    if (dayKey(l.ts) !== day) continue;
    out.calls++;
    if (l.kind === 'check') { out.checks++; if (l.auto) out.autoChecks++; }
    out.tokens += (l.promptTokens || 0) + (l.outputTokens || 0) + (l.thoughtsTokens || 0);
  }
  return out;
}

/** Sliding-window limiter. Returns {ok, stamps, retryMs}; a blocked call is not recorded. */
function rateGate(stamps, now, { perMin }) {
  const live = stamps.filter((t) => now - t < 60000);
  if (live.length >= perMin) return { ok: false, stamps: live, retryMs: live[0] + 60000 - now };
  return { ok: true, stamps: [...live, now], retryMs: 0 };
}

/** Next auto-check delay in ms, or null = stop for the day. 429 per-minute backs off, cap 15 min. */
function nextInterval(base, { status, perDay, retryDelayMs } = {}) {
  if (status !== 429) return base;
  if (perDay) return null;
  return Math.min(15 * 60000, Math.max(retryDelayMs || 0, 2 * base));
}

const exported = { computeProgress, validateQuests, questFallback, safeText, toneOk, freshLine, validateLook, gateLook, applyLook, diffFraction, dur, setTimeScale, migrate, STARTER_DEFAULT, isStale, proposeStep, notYet, currentIdx, redactTitle, focusSummary, shouldSkip, artifactDigest, capMiddle, nudgeDue, summarizeUsage, rateGate, nextInterval, dayKey };

// Dual CommonJS (main process, node --test) / browser global (renderer via
// a plain <script> tag — no build step, no bundler).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (typeof window !== 'undefined') {
  window.QuestlingLogic = exported;
}
