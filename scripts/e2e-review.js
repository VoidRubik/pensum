// Regression tests for the step-13 review findings that live in the renderer / main wiring.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(extra) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, PENSUM_TEST: '1', PENSUM_MOCK: '1', PENSUM_FAKE_IDLE_SEC: '0', PENSUM_LEDGER_PATH: path.join(ud, 'u.jsonl'), PENSUM_TIME_SCALE: '600', ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#bar');
  await page.click('#toggle');
  await page.fill('#task-text', 'my water cycle essay');
  await page.click('#make-quests');
  await page.waitForSelector('.ql-quest');
  await page.click('#start-btn');
  await page.waitForSelector('.ql-window');
  await page.click('.ql-window'); await page.click('#windows-start');
  await page.waitForSelector('#stuck-btn:not(.hidden)');
  if (await page.isVisible('.ql-card--starter')) await page.click('#card-quiet');
  const send = (o) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('signal', s),
    { ts: Date.now(), changed: true, fgHwnd: 222, fgProcess: 'chrome', onWork: false, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o });
  const calls = () => app.evaluate(() => global.__qlState().lookCalls);
  return { app, page, send, calls };
}
async function pushUntil(page, send, o, sel = '#card:not(.hidden) #card-chips:not(.hidden)') {
  for (let i = 0; i < 25; i++) { await send(o); if (await page.isVisible(sel)) return true; await sleep(150); }
  return false;
}
const undone = (page) => page.$$eval('.ql-quest input[type=checkbox]', (b) => b.every((x) => !x.checked));

(async () => {
  // Finding 4: a click during a background look is queued, not swallowed
  {
    const { app, page, send, calls } = await launch({ PENSUM_MOCK_DELAY_MS: '900' });
    await sleep(300);
    await send({ onWork: true, fgProcess: 'notepad' });          // change -> heartbeat look starts (takes 900 ms)
    for (let i = 0; i < 20 && (await calls()) < 1; i++) await sleep(50);
    ok((await calls()) >= 1, 'a background heartbeat look is in flight');
    await page.click('#done-btn');                                  // user presses done meanwhile
    await page.waitForSelector('.ql-card--confirm:not(.hidden)', { timeout: 5000 });
    ok(true, 'the click made during the background look still produces its confirm card');
    ok(await undone(page), 'nothing completed');
    await app.close();
  }
  // Finding 6: after 2 dismissals no paid background look is made at all
  {
    const { app, page, send, calls } = await launch();
    ok(await pushUntil(page, send, { fgProcess: 'chrome', onWork: false }), 'first drift ask');
    await page.click('#card-x');
    await sleep(1300);
    ok(await pushUntil(page, send, { fgProcess: 'discord', onWork: false }), 'second drift ask');
    await page.click('#card-x');                                    // 2 dismissals: quiet for the session
    await sleep(1300);
    const before = await calls();
    for (let i = 0; i < 12; i++) { await send({ onWork: true, fgProcess: 'notepad' }); await sleep(200); }
    ok((await calls()) === before, `quiet mode: 12 changed signals made no model call (${before} -> ${await calls()})`);
    await app.close();
  }
  // B2: a look that outlives the client backstop falls back to the local template and re-enables the buttons
  {
    const { app, page } = await launch({ PENSUM_MOCK_DELAY_MS: '6000', PENSUM_LOOK_TIMEOUT_MS: '1500' });
    await page.click('#stuck-btn');
    ok(await page.isDisabled('#stuck-btn'), 'B2: the stuck button is disabled while the look is in flight');
    await page.waitForSelector('.ql-card--step:not(.hidden)', { timeout: 4000 });
    ok(true, 'B2: after the backstop (1.5 s, mock reply due at 6 s) the local stuck template card shows');
    ok(!(await page.isDisabled('#stuck-btn')) && !(await page.isDisabled('#done-btn')), 'B2: stuck and done are enabled again');
    await app.close();
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
