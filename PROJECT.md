# questling

AI screen-pet hackathon app — task + deadline in, editable quests out, screen-share checks verify
real progress, pet reacts.

**Grade: Unrun** (Phase 1 only, built and verified against mock mode + a local dev server. Real
Gemini calls, the public repo, and the Vercel deploy have never run — that's Bruno's hands, per
scope. Do not call this "done"; call it "Phase 1, mock-verified, not deployed.")

## What it does (Phase 1)

Type a task → `POST /api/quests` returns 3–6 editable quests + an editable deadline → **Start**
shares your screen (`getDisplayMedia`) → **check me now** grabs one downscaled JPEG (≤1024px),
sends it to `POST /api/check`, gets back `{on_task, quest_done, progress_estimate, pet_line,
reason}` → progress bar advances (monotonic), pet reacts idle/happy/worried.

Phase 2 (interval checks, off-task streak rule, override, deadline nudges, sleepy/party states)
and Phase 3 (PiP pop-out, thumbnail/watching indicator polish, design pass) are separate task
cards, not built yet.

## Run it locally

No build step, no framework. The `api/*.js` files are Vercel-function-shaped
(`module.exports = async (req, res) => ...`) but nothing here depends on the Vercel CLI —
`vercel dev` should work once the project is linked; for a quick local check without that, serve
`index.html` statically and stub the two API routes, or use `vercel dev` after `vercel link`.

```
node --test test/logic.test.js
```

Mock mode: leave `GEMINI_API_KEY` unset (or append `?mock=1`), and both endpoints return scripted,
schema-valid responses — zero cost, no key needed.

## Verified this session (2026-09-27)

- `node --test test/logic.test.js` — **19/19 pass**: progress math (including "never moves
  backwards"), verdict schema validation (rejects malformed/wrong-typed/out-of-range), quest
  fallback, Origin/Referer allow-list, best-effort rate limiter.
- Full mock flow end to end in real Chrome (Playwright-driven, not headless — needed a real
  screen to share): typed a task → 3 quests returned → **Start** → real `getDisplayMedia` capture
  → **check me now** → real frame grabbed via `ImageCapture.grabFrame()` (`usedFallback: false`,
  confirmed non-blank) → mock verdict → progress bar moved `0 → 0.057`, pet went idle → happy,
  thumbnail populated. Screenshot taken as evidence (session scratchpad, not committed — nothing
  here is a real captured screen worth keeping).
- `/api/quests` and `/api/check` reject-path tests via curl: missing `text` → 400, non-JPEG
  prefix → 400, well-formed mock request → 200 with schema-correct body.

## Known gap: the hidden-tab spike is inconclusive, not passed

The plan's own build gate ("prove a non-blank frame grab while `document.hidden === true`, before
building anything that depends on it") was attempted three ways under Playwright + real Chrome:
switching to a second tab, switching to a second top-level window, and a genuine Win32
`ShowWindowAsync(SW_MINIMIZE)` on the actual browser window. None of the three made
`document.hidden` (or even `document.hasFocus()`) report anything but `visible`/`true` inside the
CDP-attached page — a documented category of automation limitation (Chrome suppresses natural
page-visibility throttling for pages under DevTools/CDP control, to keep automated tests from
flaking on backgrounding). What *is* proven: `getDisplayMedia` + `ImageCapture.grabFrame()`
returns a real non-blank frame during active capture in a normal, focused run
(`test/hidden-tab-spike.html`, `usedFallback: false`). `grabFrame()` reads the track's raw buffer
rather than a painted/composited canvas, which is architecturally why it's expected to keep
working while backgrounded — but that's reasoning, not a passed test.

**This means:** the single biggest risk named in the Brief (real background-tab capture, the
actual point of the product) is still open. Closing it needs a human manually backgrounding a real
tab while this page runs and checking the console — not something this session could force through
automation. Flagged in the Brief's Risks and here so it isn't lost.

## Known gap: Gemini model id unverified

`api/_gemini.js` defaults `GEMINI_MODEL` to `gemini-2.0-flash` — a guess, not a confirmed current
Flash alias. Check Google's docs at deploy time.

## Not done (deliberately, this session's scope)

- No public GitHub repo (`gh repo create` is Bruno's hands).
- No Vercel deploy, no real `GEMINI_API_KEY` (Bruno's hands — needs a no-billing Google project so
  free tier stays a hard $0 cap).
- Phase 2 and Phase 3 task cards exist but are unbuilt.

Brief: `brainstorms/brief-20260927-183530-questling.md`. Tasks:
`os/zones/Tasks/task-20260927-184008-questling-phase-1-*.md` (Phase 1, this session),
`task-20260927-184019-*` (Phase 2), `task-20260927-184027-*` (Phase 3). Brain node:
`brain/situational/memory/ai-pet.md`.
