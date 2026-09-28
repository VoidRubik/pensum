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
 * treat `false` as "keep state, retry next cycle" (see api/check.js). */
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

/** Best-effort origin check (adversarial review #1/#4). Not a security
 * boundary on its own — a forged Origin header defeats it — but it
 * stops casual curl/script abuse of a public URL with no auth. `host`
 * is the deployed domain, e.g. "questling.vercel.app". Requests with no
 * Origin/Referer at all (same-origin GET-style tools, some curl setups)
 * are rejected too: a browser always sends one for a fetch() POST. */
function isAllowedOrigin({ origin, referer, host }) {
  if (!host) return true; // local dev / host unset: don't block
  const check = (value) => {
    if (!value) return false;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  return check(origin) || check(referer);
}

/** In-memory, best-effort rate limiter. NOT durable across Vercel's
 * stateless/multi-instance functions (adversarial review #4) — this is a
 * documented, deliberate scope cut, not a real guarantee. */
function createRateLimiter(minIntervalMs) {
  const last = new Map();
  return {
    allow(id) {
      const now = Date.now();
      const prev = last.get(id) || 0;
      if (now - prev < minIntervalMs) return false;
      last.set(id, now);
      return true;
    },
  };
}

const exported = {
  computeProgress,
  validateVerdict,
  questFallback,
  isAllowedOrigin,
  createRateLimiter,
};

// Dual CommonJS (Node, api/*.js, node --test) / browser global (app.js via
// a plain <script> tag — no build step, no bundler).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (typeof window !== 'undefined') {
  window.QuestlingLogic = exported;
}
