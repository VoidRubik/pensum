# questling

AI screen-pet — a small always-on-top bar at the bottom-center of your screen (Wispr-Flow style).
Tell it a task + deadline, it breaks it into editable quests, looks at your screen when you ask,
and the pet reacts to real progress.

**Grade: Partial** — Windows desktop overlay (Electron). Phase 1 + Phase 2 built. Mock end-to-end
(auto checks, 2-in-a-row off-task, override, auto-complete + undo, pause) **Built**. Real Gemini:
quests call and two checks verified 2026-09-28 (on/off-task judged correctly, on a saved screenshot
of the UI — not a live screen). **Unrun at real stakes**: never used on real work; live daily-cap
test and live-screen checks not yet done.

## Run it

```
npm install
npm start          # launches the overlay; tray icon (mint dot) has Show/hide, Pause, Quit
npm test           # node --test, pure logic
```

Put your key in `.env` (gitignored, never commit or paste it anywhere):
```
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash              # quests (default)
GEMINI_CHECK_MODEL=gemini-3.5-flash-lite   # screen checks (default)
```
`gemini-2.5-*` returns 404 for new keys (retired 2026-09). 3.x uses `thinkingLevel: minimal`
(`low` still burns hundreds of thinking tokens on 3.5-flash).

Optional env: `QUESTLING_DAILY_CHECKS` (default 150, caps auto checks only), `QUESTLING_CHECK_INTERVAL_MS`
(default 180000), `QUESTLING_TICK_MS` (nudge tick, 30000), `QUESTLING_MOCK=1`,
`QUESTLING_MOCK_SCRIPT=on,off,off,done,done`, `QUESTLING_LEDGER_PATH`.

Usage ledger: `usage.jsonl` in Electron userData (text metadata only: model, tokens, ms, status),
sole writer `ledger.js`.
No key, or `QUESTLING_MOCK=1` → scripted quests/verdicts, $0. Use a key from a Google project
with **no billing enabled** so the free tier is a hard $0 cap. Pick the model id with:
```
curl -H "x-goog-api-key: $KEY" https://generativelanguage.googleapis.com/v1beta/models
```

If `npm start` just prints a Node version and exits: the shell has `ELECTRON_RUN_AS_NODE=1`
(VS Code-spawned shells set it). Unset it first.

## How it works

- `main.js` — frameless transparent window, `alwaysOnTop('screen-saver')`, no taskbar entry,
  bottom-center of the primary work area; grows upward into a panel on ▴. `setContentProtection`
  hides the pet from every screen capture, so Gemini never sees the pet itself. Screen capture is
  `desktopCapturer` in the main process — no share prompt, works while the pet is minimized or
  unfocused. Frames stay in memory; never written to disk.
- `ai.js` + `gemini.js` — quest generation and the screen check, raw REST with JSON schema,
  key sent as a header. Bad model output → keep state, pet says "my eyes blurred".
- `preload.js` — the only bridge (`window.questling`). Renderer has no Node, no key.
- `index.html` / `style.css` / `app.js` — bar + panel UI, state in localStorage (text only).
- `logic.js` — progress math, verdict validation, quest fallback.

## Verified 2026-09-27 (Playwright `_electron`, mock mode, real Windows desktop)

- `npm test` 12/12.
- Bar placed at exact bottom-center (`x=(1304-360)/2`, 12px above work area), always-on-top,
  never steals focus; expands to 360×480 upward keeping its bottom edge; collapses on Start.
- Flow: task → 3 quests → Start → ✓ ×2 → pet happy, progress 0 → 0.11, frame thumbnail shown.
- Capture with the pet **minimized and unfocused**: non-blank frame (pixel variance 1130). Closes
  the old web version's #1 risk (hidden-tab capture) — the browser tab no longer exists.
- Full-screen capture with content protection on shows no pet.
- localStorage contains no image data.

## Not done

- Live-screen real checks, live daily-cap test, free-tier limits per model (ledger + 429 backoff make them observable).
- Packaging to a single `.exe` (electron-builder), autostart, public repo.

Brief: `brainstorms/brief-20260927-183530-questling.md` (see its desktop-overlay revision).
Brain node: `brain/situational/memory/aipet.md`.
