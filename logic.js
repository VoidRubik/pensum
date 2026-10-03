// Pure functions, zero deps, node --test-able. Progress, quest + look validation,
// guards, proposal rules, nudges, usage, frame diff.

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
    return { title: x.title.trim().slice(0, 60), finish: x.finish.trim().slice(0, 160), minutes: i === 0 ? clamp(m, 2, 5) : clamp(m, 10, 25) };
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

// Links, contact details, markup — and bare domains / paths a hostile document could make the model repeat ("evil.com/login").
const TLDS = 'com|net|org|io|ly|co|me|app|xyz|gg|tv|info|biz|dev|ai|edu|gov|ru|cn|tk|ml|top|site|online|link|click|live|shop|store|club|page|cc|ws';
const LINK_OR_CODE = new RegExp(`https?:|www\\.|:\\/\\/|@|\`|<|>|\\b[a-z0-9][a-z0-9-]*\\.(?:${TLDS})\\b|[a-z]\\.[a-z0-9]+\\/`, 'i');
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
function applyLook({ quests, idx, purpose, auto, sup, starter, activeMs }, look) {
  const g = gateLook(validateLook(look), GATE);
  const title = quests[idx].title;
  const out = { quests, sup, card: null };
  if (purpose === 'done') {
    out.card = g
      ? { kind: 'confirm', idx, title: 'Looks done?', body: title, evidence: toneOk(g.evidence) ? g.evidence : '' }
      : { kind: 'confirm', idx, title: 'Looks done?', body: "I can't tell from here — mark it done?", evidence: '' };
  } else if (purpose === 'stuck') {
    const step = g && g.nextStep && toneOk(g.nextStep) ? g.nextStep : `Tiny step: write one rough sentence for '${title}'.`;
    out.card = { kind: 'step', idx, title: 'Next tiny step', body: step };
  } else if (purpose === 'reentry') {
    const ev = g && g.evidence && toneOk(g.evidence) ? g.evidence : '';
    const nx = g && g.nextStep && toneOk(g.nextStep) ? g.nextStep : '';
    const next = activeMs === 0 && starter ? starter : quests[idx].finish.slice(0, 60);
    out.card = { kind: 'reentry', idx, title: 'Welcome back', body: ev && nx ? `${ev} ${nx}` : `You were on "${title}". Next: ${next}`, evidence: '' };
  } else if (purpose === 'check' && g) {
    if (g.questDone) {
      const p = proposeStep(sup, { idx, questDone: true, auto });
      out.sup = p.state;
      if (p.propose) out.card = { kind: 'confirm', idx, title: 'Looks done?', body: title, evidence: toneOk(g.evidence) ? g.evidence : '' };
    } else if (!g.onTask) {
      // Drift lines are never model text: only the model's judgment (onTask=false, confident) is used.
      out.card = { kind: 'ask', idx, title: `Still on "${title}"?`, body: '', evidence: '', drift: true };
    }
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

/** Keeps the work window "visible" through one missed frame (resize, redraw); two in a row lose it, the next frame restores it.
 * A frame never resurrects a window the tracker says is closed (alive stays false). */
function stepWindow(win, misses, gotFrame) {
  if (gotFrame) return { win: { ...win, visible: true }, misses: 0 };
  const m = misses + 1;
  return { win: m >= 2 ? { ...win, visible: false } : win, misses: m };
}

let timeScale = 1;
const setTimeScale = (n) => { timeScale = Number.isFinite(n) && n > 0 ? n : 1; };
/** Every engine duration goes through here, so tests can run a session at N x speed. */
const dur = (ms) => ms / timeScale;

/** May an unsolicited check look happen now? A change and >= 90 s since the last look, or the 6 min heartbeat;
 * never more than one per 60 s. The renderer decides; main never calls the model on its own. */
function lookDue({ now, lastLookAt, changed }) {
  const since = now - lastLookAt;
  if (since < dur(60000)) return false;
  return (changed && since >= dur(90000)) || since >= dur(360000);
}

const sameProc = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
/** Is this foreground process one the user said belongs to the task? */
const allowMatches = (allow, proc) => !!proc && allow.some((a) => sameProc(a.process, proc));
/** "I'm on task" notes: newest per process wins, max 8, note cut to 60. */
function addAllow(allow, { process, note }) {
  if (!isStr(process) || !process.trim()) return allow;
  const p = process.trim();
  return [...allow.filter((a) => !sameProc(a.process, p)), { process: p, note: isStr(note) ? note.trim().slice(0, 60) : '' }].slice(-8);
}

/** Local drift rule ($0, no screenshots): off the work window, in a process the user hasn't allowed, for 2 min
 * -> ask; at most one ask per 10 min. st = { since, lastAskAt }. */
function driftStep(st, s, { allow, now }) {
  const off = !s.onWork && !!s.fgProcess && !allowMatches(allow, s.fgProcess);
  if (!off) return { state: { ...st, since: null }, ask: false };
  const since = st.since ?? s.ts;
  const gapOk = st.lastAskAt == null || now - st.lastAskAt >= dur(600000);
  if (now - since >= dur(120000) && gapOk) return { state: { since: now, lastAskAt: now }, ask: true };
  return { state: { ...st, since }, ask: false };
}

/** Unsolicited speech budget: one line per 5 min; two dismissals silence the rest of the session. */
function allowSpeak({ lastSpokeAt, dismissed }, now, capMs = 300000) {
  if (dismissed >= 2) return false;
  return lastSpokeAt == null || now - lastSpokeAt >= dur(capMs);
}

const BREAKPOINTS = ['windowLost', 'deadline', 'timebox', 'drift', 'stuck', 'idle'];
/** One prompt at a time: the highest-priority breakpoint that is due, or null. */
const breakpoint = (flags) => BREAKPOINTS.find((k) => flags[k]) || null;

/** Coming back: from away/break, or onto the work window after >= 3 min elsewhere. */
function reentryTrigger({ wasAway, away, onWork, offForMs }) {
  if (wasAway && !away) return true;
  return !away && onWork && offForMs >= dur(180000);
}

/** The last work frame is held in RAM only; usable for 10 min. Returns its base64 or null. */
function freshFrame(slot, now) {
  return slot && now - slot.at < dur(600000) ? slot.jpegBase64 : null;
}

/** m:ss label for a countdown. leftMs is engine time (already divided by the time scale), shown as real minutes. */
function mmss(leftMs) {
  const secs = Math.max(0, Math.ceil(leftMs / dur(1000)));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

const PET_STATES = ['idle', 'working', 'curious', 'thinking', 'helper', 'celebrate', 'sleepy', 'asleep'];
const IDLE_VARIANTS = ['a', 'b', 'c', 'd'];

/** Which of the 8 pet states to show. One base state plus transient overrides; priority top to bottom. */
function petStep({ celebrating, looking, quietLook, cardKind, sessionOn, hasTask, breakMode, windowLost, away, busy, offWork }) {
  if (celebrating) return 'celebrate';
  if ((looking && !quietLook) || busy) return 'thinking'; // busy = the quests are being made
  if (cardKind) return cardKind === 'step' ? 'helper' : 'curious';
  if (!sessionOn) return hasTask ? 'sleepy' : 'idle';
  if (windowLost) return 'asleep';
  if (breakMode || away) return 'sleepy';
  if (offWork) return 'curious'; // the user left the work window: an instant, silent glance (no text, no model)
  return 'working';
}

/** Next idle variant: random, never the same twice in a row. r in [0,1). */
function pickIdle(prev, r) {
  const pool = IDLE_VARIANTS.filter((v) => v !== prev);
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}
/** Idle moments last 7-16 s (engine time), at a speed of 0.85-1.15 so the loop never repeats identically. */
const idleDelay = (r) => dur(7000 + r * 9000);
const idleSpeed = (r) => 0.85 + r * 0.3;

/** Fraction of the quest's timebox still left, 1 -> 0, for the time disc. */
function discLeft({ activeMs, minutes }) {
  if (!(minutes > 0)) return 0;
  return Math.max(0, Math.min(1, 1 - Math.max(0, activeMs) / (minutes * 60000)));
}

/** True once the active minutes are used up, and again only after the minutes were extended and used up. */
function timeboxDue({ activeMs, minutes, firedAt }) {
  return minutes > 0 && activeMs >= minutes * 60000 && firedAt !== minutes;
}

/** Next open quest after idx (wrapping), or -1 if no other quest is open. */
function nextQuestIdx(done, idx) {
  for (let k = 1; k < done.length; k++) {
    const j = (idx + k) % done.length;
    if (!done[j]) return j;
  }
  return -1;
}

/** Human minutes: 54m, 1h 16m, 2h. */
const fmtMin = (m) => {
  const n = Math.max(0, Math.round(m));
  const h = Math.floor(n / 60);
  return h ? (n % 60 ? `${h}h ${n % 60}m` : `${h}h`) : `${n}m`;
};
/** Active time on a quest, for the quest-done card: <1m, 6m, 1h 5m. */
const fmtActive = (ms) => (ms > 0 && ms < 60000 ? '<1m' : fmtMin(ms / 60000));

/** Review-screen fit meter: open work vs the time left to the deadline. spare < 0 = short. ratio (0..1) fills the bar. */
function fitSummary(quests, deadlineMs, nowMs) {
  const workMin = quests.filter((q) => !q.done).reduce((a, q) => a + (Number(q.minutes) || 0), 0);
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return { workMin, leftMin: null, spareMin: null, short: false, ratio: 0 };
  const leftMin = Math.max(0, Math.floor((deadlineMs - nowMs) / 60000)); // floor: never promise time that is not there
  const spareMin = leftMin - workMin;
  return { workMin, leftMin, spareMin, short: spareMin < 0, ratio: workMin <= 0 ? 0 : leftMin <= 0 ? 1 : Math.min(1, workMin / leftMin) };
}

/** Per-quest counters {drifts, back, stuck}, attributed to the quest being worked on when the event happens. */
const ZERO_STATS = { drifts: 0, back: 0, stuck: 0 };
const statsFor = (qs, idx) => ({ ...ZERO_STATS, ...((qs && qs[idx]) || {}) });
const bumpStat = (qs, idx, key) => ({ ...qs, [idx]: { ...statsFor(qs, idx), [key]: statsFor(qs, idx)[key] + 1 } });
const sumStat = (qs, key) => Object.keys(qs).reduce((a, i) => a + statsFor(qs, i)[key], 0);

/** Picker card text from a window title: "Clade map - Figma" -> app Figma, title Clade map. The app is the last " - " part. */
function windowLabel(raw) {
  const t = String(raw || '').trim();
  const i = Math.max(t.lastIndexOf(' - '), t.lastIndexOf(' – '), t.lastIndexOf(' — '));
  if (i > 0 && t.slice(i + 3).trim()) return { app: t.slice(i + 3).trim(), title: t.slice(0, i).trim() };
  return { app: t || 'window', title: '' };
}

const lcFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
/** End-of-session summary from persisted state. Pure; missing parts count as zero. */
function recap({ quests, activeMs, session, questStats }) {
  const planned = quests.length;
  const doneTitles = quests.filter((q) => q.done).map((q) => q.title);
  const done = doneTitles.length;
  const total = Object.values(activeMs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const ss = session || {};
  const last = doneTitles.slice(-2).map((t) => lcFirst(t.slice(0, 40)));
  let praise;
  if (done === 0) praise = 'You made a plan and showed up. That counts.';
  else if (done === planned) praise = `All ${planned} done: ${last.join(' and ')}. Nice.`;
  else praise = `${done} of ${planned} done: ${last.join(' and ')}.`;
  return {
    planned, done, doneTitles, praise,
    minutes: Math.round(total / 60000),
    // per-quest counters when the caller has them (they equal the session totals by construction), else the session totals
    drifts: questStats ? sumStat(questStats, 'drifts') : ss.driftsAsked || 0,
    backOnTrack: questStats ? sumStat(questStats, 'back') : ss.backOnTrack || 0,
    stuck: questStats ? sumStat(questStats, 'stuck') : ss.stuckUsed || 0,
  };
}

/** Persisted state of any older shape -> current shape, or null (back to onboarding). Idempotent. */
function migrate(s) {
  if (!s || typeof s !== 'object' || !isStr(s.text) || !Array.isArray(s.quests) || !s.quests.length) return null;
  if (s.quests.some((q) => !q || !isStr(q.title))) return null;
  const quests = s.quests.map((q, i) => ({ ...q, finish: isStr(q.finish) ? q.finish : '', minutes: Number.isFinite(q.minutes) ? q.minutes : i === 0 ? 5 : 15 }));
  const session = { allow: [], driftsAsked: 0, backOnTrack: 0, stuckUsed: 0, ...(s.session || {}) };
  return { ...s, quests, starter: isStr(s.starter) && s.starter ? s.starter : STARTER_DEFAULT, session, timeboxFired: s.timeboxFired || {}, questStats: s.questStats && typeof s.questStats === 'object' && !Array.isArray(s.questStats) ? s.questStats : {} };
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

// --- window placement (main.js): the overlay is anchored by its centre x and the edge it grows away from ---
const SIZES = { S: 0.85, M: 1, L: 1.3 };
const SIZE_ORDER = ['S', 'M', 'L'];
const stepSize = (size, dir) => {
  const i = SIZE_ORDER.indexOf(size) === -1 ? 1 : SIZE_ORDER.indexOf(size);
  return SIZE_ORDER[clamp(i + (dir === 'in' ? 1 : -1), 0, 2)];
};
const defaultAnchor = (wa) => ({ cx: Math.round(wa.x + wa.width / 2), y: wa.y + wa.height - 12, dock: 'bottom' });
/** Dock from where the cursor was released (not the window centre: the window is tall while the panel is open). */
const dockFor = (cursorY, wa) => (cursorY < wa.y + wa.height / 2 ? 'top' : 'bottom');
/** bottom dock keeps the bottom edge (grows up); top dock keeps the top edge (grows down). */
const anchorFrom = (b, dock) => ({ cx: Math.round(b.x + b.w / 2), y: dock === 'top' ? b.y : b.y + b.h, dock });
/** The point that picks the display for an anchor. A bottom-dock anchor IS the display's bottom edge, which belongs to the display
 * below on Windows (half-open rectangles), so probe one pixel inside it. */
const anchorProbe = (a) => ({ x: Math.round(a.cx), y: Math.round(a.dock === 'bottom' ? a.y - 1 : a.y) });
/** Anchor y after a drop that FLIPPED the dock: the layout flips (bar at the opposite end of the window), so aim the window at
 * the cursor: it sits on the bar, whose centre is 33 css px from the bar's edge; 16 = window padding, 30 = pet headroom (top dock only). */
const dropAnchorY = (dock, cursorY, z) => (dock === 'top' ? cursorY - (16 + 30 + 33) * z : cursorY + (33 + 16) * z);
/** anchor + size -> bounds, always inside the work area. */
function placeWindow({ anchor, w, h, wa }) {
  const W = Math.min(w, wa.width);
  const H = Math.min(h, wa.height);
  const x = clamp(Math.round(anchor.cx - W / 2), wa.x, wa.x + wa.width - W);
  const y = clamp(anchor.dock === 'top' ? anchor.y : anchor.y - H, wa.y, wa.y + wa.height - H);
  return { x, y, w: W, h: H };
}
/** settings.json -> safe values. workAreas = every display's work area; an anchor on none of them (unplugged monitor) is dropped. */
// Files the user picked in the "link work" dialog: the only paths main will read for the model. Newest last.
const MAX_LINKED = 20;
function cleanLinked(a) {
  return Array.isArray(a) ? [...new Set(a.filter((p) => typeof p === 'string' && p && p.length <= 1024))].slice(-MAX_LINKED) : [];
}
function addLinked(list, p) { return cleanLinked([...list.filter((x) => x !== p), p]); }

// Environment for a PowerShell child: no API keys or Questling switches ride along.
function childEnv(env) {
  return Object.fromEntries(Object.entries(env || {}).filter(([k]) => !/^(GEMINI|QUESTLING)_/i.test(k) && !/KEY|TOKEN|SECRET|PASSWORD/i.test(k)));
}

function sanitizeSettings(raw, workAreas) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const a = r.anchor;
  const on = a && Number.isFinite(a.cx) && Number.isFinite(a.y) && (a.dock === 'top' || a.dock === 'bottom')
    && workAreas.some((w) => a.cx >= w.x && a.cx <= w.x + w.width && a.y >= w.y && a.y <= w.y + w.height);
  return {
    anchor: on ? { cx: a.cx, y: a.y, dock: a.dock } : null,
    size: SIZE_ORDER.includes(r.size) ? r.size : 'M',
    theme: ['system', 'light', 'dark'].includes(r.theme) ? r.theme : 'system',
    linked: cleanLinked(r.linked),
  };
}

const exported = { addLinked, childEnv, anchorProbe, dropAnchorY, SIZES, stepSize, defaultAnchor, dockFor, anchorFrom, placeWindow, sanitizeSettings, computeProgress, validateQuests, questFallback, safeText, toneOk, freshLine, validateLook, gateLook, applyLook, diffFraction, dur, setTimeScale, lookDue, stepWindow, recap, windowLabel, fitSummary, fmtMin, fmtActive, statsFor, bumpStat, discLeft, timeboxDue, nextQuestIdx, PET_STATES, IDLE_VARIANTS, petStep, pickIdle, idleDelay, idleSpeed, mmss, reentryTrigger, freshFrame, allowMatches, addAllow, driftStep, allowSpeak, breakpoint, migrate, STARTER_DEFAULT, isStale, proposeStep, notYet, currentIdx, redactTitle, focusSummary, shouldSkip, artifactDigest, capMiddle, nudgeDue, summarizeUsage, rateGate, nextInterval, dayKey };

// Dual CommonJS (main process, node --test) / browser global (renderer via
// a plain <script> tag — no build step, no bundler).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (typeof window !== 'undefined') {
  window.QuestlingLogic = exported;
}
