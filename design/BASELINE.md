# Baseline — UI v2 (measured 2026-10-02, this machine, Windows 10)

How: `node scripts/baseline.js <label> [--shots]` (needs `NODE_PATH` to a playwright-core). Real Electron window launched
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

## After

(filled in Step 7)
