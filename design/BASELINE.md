# Baseline — UI v2 (measured 2026-10-02, this machine, Windows 10)

How: `node scripts/baseline.js <label> [--shots]` (needs `playwright-core`, a devDependency: `npm install`). Real Electron window launched
by Playwright `_electron`, mock mode (no key, no model call). rAF numbers are deltas **inside that window**, not a
compositor/GPU capture and not another machine: label every one of them "this PC, Electron window".
Raw: `evidence/ui-v2/baseline-before.json`, `baseline-after.json`. "Before" screenshots: `evidence/ui-v2/before-*.png`.

## Bruno's complaints, and what the numbers blame

| Complaint | Cause found | Evidence |
|---|---|---|
| "takes a minute to load" | **Not the UI.** Cold start to `load` event is ~0.45–0.5 s. The stall is *session start*: `focus.start()` then `focus.setWork()` each `spawn('powershell.exe', [..., '-EncodedCommand', <4.7 KB>])`, and that spawn blocks the main thread synchronously | `focus.start` 5024 ms, `focus.setWork` 4158 ms (main-process timer); `pick-window` IPC 8862 ms; click window → session on **9359 ms**. Same spawn with `-File <script>`: 23 ms. Short `-Command`: 7–19 ms. Encoded command without env: 4424 ms (so it is the long encoded argument, not the env block) |
| "not smooth" | **Not reproduced.** rAF in every pet state and across every screen change is 17.6–17.9 ms mean, p95 18.2 ms, 0 frames over 20 ms (one 53 ms hitch in the first idle sample, one 36 ms hitch in a picker run). The 9 s main-thread block above freezes the window (pet included) at the moment a session starts, which is the likeliest thing Bruno saw as "not smooth" | headless-style rAF cannot see transparent-window compositing on his GPU: **unmeasured on real use** |

Fix (own commit): `focus.js` writes the tracker script to `os.tmpdir()/questling-focus-<pid>.ps1` once and spawns
`powershell -File`. Verified: `focus.start` 23 ms, `focus.setWork` 7 ms, tracker still reports the foreground process
(`Code`) 2.5 s later, click window → session on **368 ms** (was 9359 ms).

## Before (old placeholder UI)

Startup (5 launches each): process start → `load` end, median **496 ms** (test mode) / **454 ms** (real mode); Playwright
"first window + #bar present" median 682 / 557 ms. Navigation start is ~180–230 ms after process start; the page itself
loads in ~200–370 ms. `first-contentful-paint` is never reported for the transparent window (null).
Main-process module load (plain node, electron excluded): logic 1.8, ledger 1.0, focus 1.0, artifact 0.7,
**capture 27.8**, look-flow 0.9, ai 1.9 ms. Nothing in `whenReady` is slow; `.env` load, `ledger.init`, `createWindow`,
`createTray` are all small.

rAF per pet state (1.5 s each): idle 18.9 mean (max 53.4, 2 over 20 ms), the other seven 17.6–17.7 mean, p95 18.1–18.3, 0 over 20 ms.
rAF per screen change (0.9 s window): openPanel / makeQuests / windows / startSession / drift / questDone / allDone
all mean 17.6–17.9, p95 18.1–18.2, 0 over 20 ms.

`set-size` IPC (each is a `setBounds` on the transparent topmost window) per flow, **before**:
openPanel 1 · makeQuests 2 · windows 2 · startSession 1 · drift 2 · questDone 4 · allDone 4.

Screens missing from "before" because the old UI has no such screen: 02 Making quests (no busy state), and 07/08 are a
bubble + the old recap panel.

## After (same script, same PC, 2026-10-02, `node scripts/baseline.js after --shots`)

| Metric (Electron window, this PC) | Before | After |
|---|---|---|
| Process start -> load end, median of 5 (test / real mode) | 496 / 454 ms | 503 / 565 ms (run-to-run noise is about +-100 ms; no change claimed) |
| Click window -> session on, real mode | **9359 ms** | **664 ms** (window list 490 ms) |
| rAF per pet state (8 states) | mean 17.6-18.9 ms, 0-2 frames >20 ms | mean 16.7 ms, p95 16.8, 0 frames >20 ms in every state |
|  IPC calls per flow (open / make quests / windows / start / drift / quest done / all done) | 1 / 2 / 2 / 1 / 2 / 4 / 4 | 1 / 1 / 1 / 1 / 2 / 4 / 4 |

Regression, stated plainly: the first time a panel screen appears there are long frames. Panel open (first time) showed
2 frames of about 60-100 ms, make quests 1 (~116 ms in the baseline run), start session and quest done 1 each (33 ms).
Re-opening the panel is smooth (6 opens: 42 frames at 16.7 ms, 0 over 20 ms). Cause, measured by switching CSS off on the
live window: removing every box-shadow inside the panel removes the hitch completely (6 of 6 runs); removing any one shadow
type, shrinking the blurs, or pre-drawing every shadow type once at startup did not. Not fixed. The old UI had none, so on
the author's real screen this needs a look; if it feels laggy the lever is a flatter shadow set (`main[data-shadows="flat"]`, the footer switch Shadows: Flat) in
ui.css. Headless/other-GPU numbers may differ.

Not measured: the transparent-window compositor on the author's own display, a real Gemini round trip, power use.

## Deliberately dropped or changed from the design, and why

- `q-barAura`, `q-flow`, `q-glowPulse` as designed animate box-shadow / background-position (repaint every frame). Replaced: flare = opacity on a pseudo-element (3 pulses), flow = a transform-only highlight on the current segment, glow on done fills is static.
- Primary-button glow ring is static (design pulses it).
- Outer shadow `0 0 24px 10px` (the design's `q-barAura` end frame) is clipped by the window edge; a tight one (`0 0 10px 2px`) fits the 16 px window padding.
- Review rows: only the current row is raised, others sunken (design raises all four; shadow budget).
- Deadline shows the editable datetime field, not the design's friendly "Today, 6:22 pm" text.
- Drift card keeps the allow-list chips and free text (the design drops them; they are the feature). Primary/quiet roles swapped to the design's emphasis (Back on track = primary).
- Panel/card exit is instant (no 120 ms exit animation): display:none cannot animate, and delaying it breaks the click-through/resize logic and the e2e.
- Plan section 7.7 per-pet class prefixes: not needed. One generator run emits both pets, so the deduplicated animation classes are shared and cannot collide.
- Re-diff of the pet states against the original Claude Design motion file: not done, the file was not available in this session. The state list was checked against PET_STATES and the v2 design's pet slots instead.
- Per-quest completion no longer celebrates (it hops); only all-done celebrates.
