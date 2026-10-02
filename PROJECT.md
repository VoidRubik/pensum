# questling

AI screen-pet — a small always-on-top bar at the bottom-center of your screen (Wispr-Flow style).
Tell it a task + deadline, it breaks it into editable quests, watches your screen, and **proposes**
when a quest looks done — you confirm with one click.

**Grade: Partial** — Windows desktop overlay (Electron). v3 (2026-09-29) built: propose-and-confirm
done, speech bubble, multi-monitor capture, window-title / idle / Word-text signals. Mock end-to-end
(27 checks) **Built**. Real Gemini (free tier): done-check verified on staged essay pages (n=2, lite);
earlier quests + checks verified 2026-09-28. **Live test 2026-09-29: Bruno reports all 12 v3 feature
tests pass** (done-check on live Word, not-yet, proposal chip, confirm, linked .docx, multi-monitor,
bubble, paused ✓, off-task + override, titles toggle, idle/lock skip, finish). Caveats: that run's
`usage.jsonl` holds 0 auto-check lines (all calls manual, ~6.5 min), so the auto path had no real-call
evidence; the daily-cap test is still not done. Bruno's verdict: core works, UI ugly, not yet useful.

## Run it

```
npm install
npm start          # launches the overlay; tray icon (mint dot) has Show/hide, Pause, Quit
npm test           # node --test, pure logic (34 tests)
```

Put your key in `.env` (gitignored, never commit or paste it anywhere):
```
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash              # quests (default)
GEMINI_CHECK_MODEL=gemini-3.5-flash-lite   # screen checks (default)
GEMINI_DONE_MODEL=                         # done-check (default: the check model)
```
`gemini-2.5-*` returns 404 for new keys (retired 2026-09). 3.x uses `thinkingLevel: minimal`.
Done-check defaults to lite: on 2 staged essays lite was correct in ~1.3 s; flash took 10–20 s and
errored twice (n=1 each — a sample, not a benchmark). Gemini's `mediaResolution` made no difference
(same token count, same transcription) so it is not sent.

Optional env: `QUESTLING_DAILY_CHECKS` (150, caps auto checks only), `QUESTLING_CHECK_INTERVAL_MS`
(180000), `QUESTLING_TICK_MS` (30000), `QUESTLING_MOCK=1`, `QUESTLING_MOCK_SCRIPT=on,off,done,…`,
`QUESTLING_MOCK_CLAIM=ok,no` (done-check answers), `QUESTLING_FAKE_IDLE_SEC` (tests on an idle PC),
`QUESTLING_LEDGER_PATH`.

No key, or `QUESTLING_MOCK=1` → scripted quests/verdicts, $0. Use a key from a Google project with
**no billing enabled** so the free tier is a hard $0 cap.

If `npm start` just prints a Node version and exits: the shell has `ELECTRON_RUN_AS_NODE=1`
(VS Code-spawned shells set it). Unset it first.

## How it works

- **Done = pet proposes, you confirm.** A `quest_done` verdict (auto or 👁) puts a proposal in its own
  element: *Looks like "X" is done! [Yes ✓] [Not yet]*. Yes completes that quest and says "Next: …".
  Not yet silences that quest for its next 2 auto checks. After 10 s it collapses to a ✓? chip on the bar.
- **Bar:** pet · current quest + progress · 👁 look now · ✓ "I'm done" · ❚❚ · ▴. ✓ runs a done-check on
  its own channel (works while paused): model agrees → done; disagrees → "Hmm, … Mark done anyway?".
- **Panel:** per-quest checkbox (both ways), click a quest to make it current, "Link my work", a
  "send window titles" toggle. Speech bubble shows above the bar; the transparent window is click-through
  everywhere except bar / bubble / proposal / panel.
- **Signals** (`focus.js`, `artifact.js`; all in memory): window titles per check ("WINWORD 'Essay.docx'
  2m40s · chrome …") with private-window / password-manager / banking-word redaction; skip the paid check
  when locked or idle ≥ 5 min; Word's live unsaved text via COM; a linked `.docx/.txt/.md/code` file
  (`.docx` read with shared access, works while open in Word). Every check gets a digest (words,
  headings, last 800 chars); the done-check gets the text (head + tail, 40k chars).
- **Capture:** the display the cursor last rested on outside the pet (clicking the pet always puts the
  cursor on its display), native size capped at 1600 px (done-check 2048).
- `ai.js` + `gemini.js` raw REST + JSON schema. `ledger.js` sole writer of `usage.jsonl`.
  `preload.js` only bridge. `logic.js` pure rules (proposeStep, currentIdx, focusSummary, redactTitle,
  shouldSkip, artifactDigest, capMiddle, nudges, …).

## Privacy — honest version

Each check sends one frame to Google Gemini, plus window titles and, if you link work, a text digest.
On the free tier **Google may keep these, use them to improve its products, and human reviewers may
read them** (ai.google.dev/gemini-api/terms, checked 2026-09-28). Don't run it with private things on
screen. Nothing screen-derived is written to disk or localStorage; the ledger stores only model, token
counts, timing and status. Window titles and document text live in main-process memory and are
dropped on pause.

## Verified 2026-09-29

- `npm test` 34/34 (each new rule watched RED first).
- Mock e2e (Playwright `_electron`, scratchpad `e2e-v3.js`): proposal in its own slot and survives a
  nudge; Not yet suppresses 2 auto checks then it asks again; Yes completes the proposed quest + Next
  line; untick lowers progress to 0; click a quest → current + bar title; ✓ works while paused (claim-ok
  completes, claim-no shows the confirm); last quest → party; click-through toggles; buttons not clipped;
  localStorage has no image / verdict text.
- Spot-tests on this PC: PowerShell tracker UTF-8 across 2 monitors; Word COM live text; `.docx`
  readable while locked open; display under cursor on monitor 2 captured at 1600×900, `display_id` set.
- Fresh Sonnet hostile review: 0 Critical, 8 Important, 4 Minor — fixed (see git log).

## Not done

- Real use: Bruno driving v3 on a real task; live-screen checks; the daily-cap test.
- ✓ pressed *during* an in-flight auto check is covered by construction (separate slot), not by a
  test — the mock answers instantly.
- Phase R (UI Automation text, OCR, Google Docs, git diff) waits on the research prompt
  `brainstorms/research-prompt-questling-screen-aware.md`.
- Packaging to `.exe`, autostart, public repo. Deferred minors: override bumps epoch (#9), ledger append
  failure discards a paid response / `read()` reparses per check (#10), backoff not cumulative (#12),
  Word COM can stall a check up to 8 s (screenshot then older than the text), no docx entity edge cases
  beyond the five XML entities.

Brief: `brainstorms/brief-20260927-183530-questling.md` (revision 2026-09-28 v3).
Brain node: `brain/situational/memory/aipet.md`.
