# questling

AI screen-pet — a small always-on-top bar at the bottom-center of your screen (Wispr-Flow style).
Tell it a task + deadline, it breaks it into editable quests, looks at your screen when you ask,
and the pet reacts to real progress.

**Grade: Partial** — Phase 1 runs as a Windows desktop overlay (Electron), verified in mock mode.
Real Gemini calls have never run (no key yet). Phase 2 (automatic checks, nudges, all pet states)
not built.

## Run it

```
npm install
npm start          # launches the overlay; tray icon (mint dot) has Show/hide, Pause, Quit
npm test           # node --test, pure logic
```

Put your key in `.env` (gitignored, never commit or paste it anywhere):
```
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
```
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

- Real Gemini calls (needs `.env`), current model id confirmed via ListModels.
- Phase 2: interval checks in main, 2-in-a-row off-task rule, override, deadline nudges, all states.
- Packaging to a single `.exe` (electron-builder), autostart, public repo.

Brief: `brainstorms/brief-20260927-183530-questling.md` (see its desktop-overlay revision).
Brain node: `brain/situational/memory/aipet.md`.
