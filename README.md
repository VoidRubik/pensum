# Pensum

A tiny companion that helps when you can't help yourself: **starting, getting unstuck, coming back.**
It floats at the bottom of your screen, plans your goal into small quests, and looks only at **the one
window you pick**, only during a session. It asks, it never scolds, and the model never decides you are
finished: you click.

![Pensum plan review, light theme](evidence/ui-v2/ui-v2-light-tuck-03-review.png)

Built for LovHack S3. Grade: **Partial** (built and tested on staged windows and samples; not yet used on a
real task by its author). Every decision and caveat: [`DECISIONS.md`](DECISIONS.md).

## Try it in 30 seconds (any OS)

The web demo runs the same renderer on a fake desktop with 8 scene buttons. It asks for no permissions and works
without a key (recorded answers).

- Web demo: **LIVE URL PLACEHOLDER (not deployed yet)**
- Or run it locally: `node web/build.js && node scripts/dev-server.js`, then open http://127.0.0.1:4173

## Run the desktop app (Windows 10/11)

```
git clone https://github.com/VoidRubik/pensum.git
cd pensum
npm install
npm start
```

Needs Node 22.12 or newer. With no key the app runs in **mock mode** (canned quests and looks, no network).
To go live, put a free [Google AI Studio](https://aistudio.google.com/) key in `.env` (`GEMINI_API_KEY=...`) in the
repo, or in `%APPDATA%\pensum\.env`. A packaged build never contains a key. The tray icon has Show/hide,
Pause, "Hide from screen recordings", Reset position and Quit.

To build a portable exe locally: `npm run dist` (output in `dist/`).

If the window never appears, your shell may have `ELECTRON_RUN_AS_NODE=1` set (VS Code terminals do): unset it
before `npm start`.

## A 5-step walkthrough

1. Click the pet, type a goal ("write my water cycle essay, due 6 pm"), press **Make quests**: you get 3 to 5 small quests, the first one tiny.
2. **Start session**, then pick the window you are working in (the desktop app lists real windows; the web demo has a fake one).
3. Work. Press the footsteps button when stuck: it names one concrete next step from what is on screen.
4. Wander off for two minutes: the pet asks if that is still the task (a local rule, no screenshot, no model). Press the check when you think a quest is done: the pet shows what it sees and **you** confirm.
5. Finish the last quest for the recap, or close the work window and watch the pet fall asleep and offer to pick it again.

## Privacy

Each look sends one frame of the window you picked, its title (private-window, password and banking words
dropped), and, if you link a document or use Word, that document's text to Google Gemini. **On the free tier
Google may use it to improve its products, and humans may review it.** Frames are never written to disk. The
usage ledger stores only model, token counts, timing and status. Pause and End session clear the chosen window,
the sampler and the in-memory frame. The web demo reads no screen at all.

By default the overlay is hidden from screenshots and screen recordings (content protection); the tray toggle
"Hide from screen recordings" turns that off, for example to record a demo. Frames sent to Gemini come only from
the picked window, so the overlay is never in them either way.

Hardening: sandboxed renderer with context isolation, navigation / new-window / permission requests denied, main
reads only document files you chose in the link dialog, PowerShell helpers get no API keys.

## Tests

```
npm install
npm test            # node --test, any OS
```

The end-to-end suites drive the real Electron window (Windows, `playwright-core` is a devDependency). Run them in
mock mode so no model call can happen:

```
PENSUM_MOCK=1 GEMINI_API_KEY= node scripts/e2e-step2.js      # also e2e-step8/10/11, e2e-polish, e2e-bugs, e2e-security
```

(PowerShell: `$env:PENSUM_MOCK='1'; $env:GEMINI_API_KEY=''`.) A few tests that guard a private design brief skip
themselves on a fresh clone.

## Known limits

- The desktop app is Windows-only (window capture and focus tracking use Win32 and PowerShell).
- Free-tier Gemini latency has long tails (up to 16 s); looks time out and the app carries on.
- Some answers on the web demo come from recordings of real model output, tagged "(recorded)".
- Not yet verified: use on a real, long task; the first-open frame hitches on real hardware; multi-monitor drag
  with different DPI. Details in [`DECISIONS.md`](DECISIONS.md) and [`PROJECT.md`](PROJECT.md).

## Credits

1. Electron 44 (MIT): desktopCapturer, Tray, powerMonitor, nativeTheme
2. Node.js 22 and its built-in test runner
3. Google Gemini API, `gemini-3.5-flash`: quests in the desktop app
4. Google Gemini API, `gemini-3.5-flash-lite`: looks, and quests on the web demo
5. Google AI Studio free-tier key
6. Vercel: static demo plus one serverless function
7. Playwright (`playwright-core`, `_electron`) for the end-to-end tests
8. electron-builder for the portable exe
9. GitHub, the gh CLI and GitHub Actions
10. Win32 `user32.dll` via PowerShell `Add-Type` (foreground window)
11. Microsoft Word COM automation (live document text)
12. .NET `System.IO.Compression` (reading `.docx`)
13. Claude Code (Anthropic): Opus 5.5 for planning and review, Sonnet 5.5 for building and independent reviews
14. Claude Design: "Pensum App UI v2" and "Pet Motion" (pets Tuck and Kip) plus the SVG icon sprite
15. Agent skills used while building: superpowers, ponytail, impeccable, emil-design-eng, ui-ux-pro-max
16. AIOS, the author's personal context system (brief, task cards, memory)
17. Segoe UI Variable and Cascadia Mono (system fonts)
18. Electron security checklist (docs)
19. LovHack S3 rules on Devpost

Depth: [`PROJECT.md`](PROJECT.md) (architecture, what runs now) and [`DECISIONS.md`](DECISIONS.md) (every decision, honest caveats). MIT licensed: [`LICENSE`](LICENSE).
