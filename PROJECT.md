# questling

A tiny companion that helps when you can't help yourself: **starting, getting unstuck, coming back.**
It floats at the bottom of the screen (Electron, always on top, click-through outside its surfaces),
plans your goal into small quests, and looks only at **the one window you pick**, only during a session.
A web demo (Vercel) runs the same renderer on staged samples.

**Grade: Partial.** v4 (2026-10-01) is built and tested on staged windows and samples with mock and real
Gemini. Never done: the author using it on real work, the live Vercel deployment, the real-window-close
path end to end, the Win10 capture border check. UI v2 (2026-10-02: Claude Design App UI v2 in both themes, two
pets Tuck/Kip) is built and verified in the real Electron window on this PC only; first-open frame hitches and
real-hardware smoothness are in the Not done list. Every decision and caveat: `DECISIONS.md`.

## What it does

- **Plan:** one question ("What do you want to finish today?") → 3–5 quests (quest 1 ≤ 5 min, each with
  minutes and an on-screen finish line) + a first "sloppy step". The progress bar starts with a filled
  *Plan made* segment.
- **Starting:** a 60 s "Tiny start" card with a countdown ring; "Did it start?" Yes / 60 more. No model call.
- **Getting unstuck:** the footsteps button → one vision look at the picked window → one tiny next step
  that names something on screen (`[Start 2 min]` `[Another idea]`).
- **Finishing:** ✓ never completes anything by itself: the pet shows what it sees and asks; only the
  click on *Yes, done* completes a quest. A heartbeat look can propose the same card.
- **Drifting:** a local rule (foreground process ≠ the work window and not allowed, 2 min, 1 ask / 10 min;
  no screenshot, no model) asks "Still on …?" with chips *research · lecture for this · taking a break*
  and free text. Drift lines are never model text.
- **Coming back:** re-entry card after away / break / 3 min elsewhere / resume ("You were on … Next: …"),
  with a local template fallback.
- **Time disc + timebox**, **session recap** with one specific praise line, 8 pet states
  (`idle`×4 variants, `working`, `curious`, `thinking`, `helper`, `celebrate`, `sleepy`, `asleep`).
- **Quiet by design:** at most one unsolicited line per 5 min; two ✕ silence the session; paid background
  looks only run when their card could be shown.

## Run it

```
npm install
npm start          # the overlay; tray icon has Show/hide, Pause, Quit
npm test           # node --test, 159 unit tests, zero deps
node web/build.js && node scripts/dev-server.js   # the web demo locally on :4173
```

`.env` (gitignored; never commit or paste it): `GEMINI_API_KEY=…`. Models: quests
`gemini-3.5-flash` (`GEMINI_MODEL`), every look `gemini-3.5-flash-lite` (`GEMINI_CHECK_MODEL`). Use a key
from a Google project with **billing off** so the free tier is a hard $0 cap. No key or `QUESTLING_MOCK=1`
→ scripted answers, $0. If `npm start` prints a Node version and exits, unset `ELECTRON_RUN_AS_NODE`.

Test/ops env: `QUESTLING_TEST=1` (fake window, scripted signals only, no tracker), `QUESTLING_TIME_SCALE=N`
(divide every engine duration), `QUESTLING_FAKE_IDLE_SEC`, `QUESTLING_LEDGER_PATH`, `QUESTLING_DAILY_CALLS`
(300), `QUESTLING_PER_MIN` (8), `QUESTLING_MOCK_DELAY_MS`, `QUESTLING_MOCK_CHECK_DONE|OFF`.

## Architecture (pinned)

- **main.js owns devices and the key:** window capture (`capture.js`, chosen window only, no display
  fallback), the PowerShell foreground/alive tracker (`focus.js`), idle/lock, the model gateway + rate gate
  + usage ledger, the RAM-only last work frame. It emits one raw `signal` stream; **it never calls the model
  on its own.** The look pipeline is `look-flow.js` (dependencies injected; re-checks the session after
  every await so a pause mid-look sends nothing).
- **app.js (renderer) owns every decision:** quest state, the epoch, drift/stuck/idle/timebox/re-entry,
  the speech budget, which card shows. Rules are pure functions in `logic.js`.
- **preload.js** is the whole renderer surface (12 functions). **ai.js + gemini.js:** raw REST, JSON schema,
  one LOOK schema for all vision calls, injection-aware system prompt, `safeText` (links, domains,
  contact details), `toneOk`, output caps.
- **Web:** `web/shim.js` implements the same `window.questling` surface on a fake desktop with a scene bar;
  `api/model.js` (Vercel function) reads a whitelisted sample server-side (never an upload), rate-limited
  per IP and globally, 6 s, no retries; any failure → recorded real answers (`demo/recorded.json`, tagged).
  `web/build.js` copies only the renderer into `public/`.
- **Design hand-off:** `DESIGN_PROMPT.md` is the contract for the Claude Design assets (pet.css, ui.css, the icon
  sprite); `test/design-prompt.test.js` fails if it drifts from the code. `scripts/build-pet.js` generates both pets
  (Tuck inline, Kip in a template) and pet.css. `design/PLAN-ui-v2.md` + `design/BASELINE.md` = the UI v2 plan and numbers.

## Privacy — honest version

Each look sends one frame of the picked window, its title (private-window / password / banking words
dropped), and, if you link a doc or use Word, the doc's text to Google Gemini. On the free tier **Google may
use it to improve its products, and humans may review it.** Frames are never written to disk; the ledger
stores only model, token counts, timing, status. Pause / End session clear the chosen window, the sampler,
the focus events and the RAM frame. The web demo reads no screen at all.

## Verified (2026-10-01)

Unit 127/127 · e2e (Playwright `_electron`, fresh profile, scripted signals) step2 19, step3 11, step5 22,
step6 10, step7 12, step8 8, step9 16, step10 14, step11 11, review 6 · web e2e 20 (fresh Chrome context,
all permissions denied) · `check-live.js` against the local server 27 · real Gemini: stuck steps 3/5 and
4/5 name something on screen (latency tails to 16 s), injection sample 6/6 not obeyed (n=6, one sample,
not a security result). A fresh hostile review found 0 Critical / 7 Important; all 7 fixed test-first.

## UI v2 (2026-10-02)

Unit 141/141 · e2e step2 19, step3 10 (+1 expected fail: its "real model" assertion, run with the key blanked), step5 24,
step6 10, step7 13, step8 17, step9 16, step10 17, step11 11, review 6, **ui-v2 56** (8 screens x light/dark x Tuck/Kip, 32
screenshots in `evidence/ui-v2/`) · web e2e 20 (mock) · `scripts/contrast.js` both themes PASS. Root cause of the
"takes a minute": the PowerShell tracker spawn blocked the main thread ~9 s at session start (fixed, 368 ms now).
Numbers and before/after: `design/BASELINE.md`.

## Polish night (2026-10-02)

- **Move it anywhere:** drag the pet or the quest title (under 4 px stays a click). Main follows the cursor; the drop point picks the
  dock (cursor above the work-area midpoint = top: the panel opens downward; else bottom: upward). Saved in `settings.json` in
  the Electron userData folder; a saved position on a monitor that is gone falls back to bottom-centre at the next start (while running, the window is clamped to the nearest display). Tray menu: Reset position.
- **Size S / M / L** (0.85 / 1 / 1.3, native page zoom, the window scales with it) in the panel footer, or Ctrl+wheel over the bar.
- **Theme Auto / Light / Dark** (`nativeTheme`, applied before the window loads) and **Shadows Soft / Flat** (renderer-only).
- **Power-up on every confirmed quest** (pet + a bar aura, 3.6 s); a second quest inside that restarts it; the quest-done card opens
  after lift-off. All quests done = the same power-up + the existing flare + the recap.
- **Glance:** the pet turns curious at once (no text, no model call) when you switch to another app that is not allowed.
- **Fixes:** B1 timeouts are not retried, B2 a 13 s client backstop on looks, B3 Word probe 3 s, B4 stale away-time after pause,
  B5 dismissal budget lasts the session, B6 tone filter on confirm evidence, B7 switching quest closes the old card, B8 New task
  while the picker answers, B9 a failed ledger write keeps the paid answer, B10 real window close (`scripts/e2e-realclose.js`).
- Unit 159/159 · e2e `scripts/e2e-polish.js` 37, `e2e-bugs.js` 12, `e2e-review.js` 9, `e2e-realclose.js` 4 (real Notepad close: pet
  asleep in 657 ms), step2 19, step5 24, step6 10, step8 17, step10 17, ui-v2 56, web 20 (local, key blanked).

## Not done

- UI v2 on real hardware: all frame numbers are rAF deltas in this PC's Electron window, not the author's screen. First time a panel
  screen appears there are 1-2 long frames (~50-110 ms, caused by the box-shadows; later opens are smooth). Footer switch
  Shadows: Flat did NOT reliably remove them (3 runs of 4 first opens: Flat 0 / 4 / 7 frames over 20 ms, Soft 9 / 10 / 9; one clean
  run was luck), so the long first frame is probably the window resize, not only the shadows. Not fixed.
- UI v2 deferred/dropped: see `design/BASELINE.md` (no DesignSync re-diff of the Motion file, exit animations, friendly deadline text).
- Real use on a real task; the daily-cap behaviour at 300 calls.
- The public push, Vercel import and `check-live.js` / `e2e-web.js` against the live URL (blocked on the
  owner's OK and a billing-off key).
- Packaging to `.exe`; autostart; Phase R research results.
- Polish night (2 Oct): drag/dock/size/theme/shadows/power-up/glance verified by scripted e2e and unit tests only. By hand still:
  drag across two monitors with different DPI, Ctrl+wheel, tray "Reset position", releasing the mouse off the pet mid-drag.
- Remaining deferred minors are listed in `DECISIONS.md` (the seven from the 1 Oct review, minus the ones fixed on 2 Oct).

Brief: `brainstorms/brief-20260927-183530-questling.md` (revision 2026-09-30, helper pivot).
Brain node: `brain/situational/memory/aipet.md`.
