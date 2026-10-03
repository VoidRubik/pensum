// Regression tests for the polish-night bug list (B4, B5, B7, B8). Mock mode, $0, fresh profile each.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// start: false stops before the window picker so a test can race it
async function launch(extra, { start = true } = {}) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_TEST: '1', QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'u.jsonl'), QUESTLING_TIME_SCALE: '100', ...extra };
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
  await page.click('.ql-window');
  if (start) {
    await page.click('#windows-start');
    await page.waitForSelector('#stuck-btn:not(.hidden)');
    if (await page.isVisible('.ql-card--starter')) await page.click('#card-quiet');
  }
  const send = (o) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('signal', s),
    { ts: Date.now(), changed: false, fgHwnd: 222, fgProcess: 'chrome', onWork: false, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o });
  const calls = () => app.evaluate(() => global.__qlState().lookCalls);
  const mainState = () => app.evaluate(() => global.__qlState());
  return { app, page, send, calls, mainState };
}
async function pushUntil(page, send, o, sel = '#card:not(.hidden) #card-chips:not(.hidden)') {
  for (let i = 0; i < 25; i++) { await send(o); if (await page.isVisible(sel)) return true; await sleep(150); }
  return false;
}

(async () => {
  // B4: pausing while away from the work window must not leave a stale offSince that fakes a "welcome back" look later
  {
    const { app, page, send, calls } = await launch();
    await send({ onWork: false, fgProcess: 'chrome', ts: Date.now() - 60000 }); // away "since 60 s ago" (one signal: no drift ask)
    await sleep(200);
    await page.click('#pause-btn');
    await sleep(200);
    await page.click('#pause-btn'); // resume -> its own re-entry look
    await page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 5000 });
    await page.click('#card-quiet');
    const before = await calls();
    await send({ onWork: true, fgProcess: 'winword' });
    await sleep(500);
    ok((await calls()) === before, `B4: pause -> resume -> back on the window makes no second re-entry look (${before} -> ${await calls()})`);
    await app.close();
  }

  // B5: "two X silence the session" - the budget belongs to the session, not to a pause or a re-pick
  {
    const { app, page, send, calls } = await launch();
    ok(await pushUntil(page, send, { fgProcess: 'chrome', onWork: false }), 'B5: first drift ask');
    await page.click('#card-x');
    await sleep(3300);
    ok(await pushUntil(page, send, { fgProcess: 'discord', onWork: false }), 'B5: second drift ask');
    await page.click('#card-x'); // 2 dismissals: quiet
    await sleep(300);
    const quiet = async (label) => {
      const before = await calls();
      for (let i = 0; i < 10; i++) { await send({ onWork: true, fgProcess: 'notepad', changed: true }); await sleep(120); }
      ok((await calls()) === before, `B5: ${label}: 10 changed signals made no model call (${before} -> ${await calls()})`);
    };
    await quiet('after two dismissals');
    await send({ windowAlive: false, windowVisible: false });
    await page.waitForSelector('#repick:not(.hidden)');
    await page.click('#repick');
    await page.waitForSelector('.ql-window');
    await page.click('.ql-window'); await page.click('#windows-start');
    await page.waitForSelector('#stuck-btn:not(.hidden)');
    await sleep(300);
    await quiet('still quiet after the window was lost and re-picked');
    await page.click('#pause-btn'); await sleep(200);
    await page.click('#pause-btn'); // resume
    await sleep(800);
    if (await page.isVisible('#card:not(.hidden)')) await page.evaluate(() => document.getElementById('card-quiet').click());
    await quiet('still quiet after pause and resume');
    // a brand-new session gets the budget back
    if (!(await page.isVisible('#end-btn'))) await page.click('#toggle'); // End session lives in the panel
    await page.click('#end-btn');
    await page.waitForSelector('#recap:not(.hidden)');
    await page.click('#recap-close');
    await page.waitForSelector('#start-btn:not(.hidden)');
    await page.click('#start-btn');
    await page.waitForSelector('.ql-window');
    await page.click('.ql-window'); await page.click('#windows-start');
    await page.waitForSelector('#stuck-btn:not(.hidden)');
    if (await page.isVisible('.ql-card--starter')) await page.click('#card-quiet');
    const before = await calls();
    let got = false;
    for (let i = 0; i < 25 && !got; i++) { await send({ onWork: true, fgProcess: 'notepad', changed: true }); await sleep(150); got = (await calls()) > before; }
    ok(got, 'B5: a new Start session has its budget back (a changed signal makes a look again)');
    await app.close();
  }

  // B7: switching quests closes the old quest's card
  {
    const { app, page } = await launch();
    await page.click('#stuck-btn');
    await page.waitForSelector('.ql-card--step:not(.hidden)');
    if (!(await page.isVisible('.ql-quest'))) await page.click('#toggle');
    await page.waitForSelector('.ql-quest:nth-child(2)');
    await page.click('.ql-quest:nth-child(2) .ql-quest__finish'); // the row itself, not its checkbox or title field
    await sleep(300);
    ok(await page.isHidden('#card'), 'B7: the step card for quest 1 is gone once quest 2 is picked');
    await app.close();
  }

  // B8: New task / Pause pressed while the window picker is still answering must not leave a session without a task
  {
    const { app, page, mainState } = await launch({ QUESTLING_PICK_DELAY_MS: '1500' }, { start: false });
    await page.click('#windows-start');
    await page.evaluate(() => document.getElementById('new-task').click()); // mid-pick
    await sleep(2200);
    const st = await mainState();
    ok(!st.hasWork && !st.sampling, `B8: New task mid-pick -> no session left running in main (${JSON.stringify({ hasWork: st.hasWork, sampling: st.sampling })})`);
    ok(await page.getAttribute('main', 'data-pet-state') === 'idle' && await page.isHidden('#pause-btn'), 'B8: the bar shows no session (idle pet, no pause button)');
    ok(await page.isHidden('.ql-window'), 'B8: no picker left on screen');
    await app.close();
  }
  {
    const { app, page, mainState } = await launch({ QUESTLING_PICK_DELAY_MS: '1500' }, { start: false });
    await page.click('#windows-start');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('paused')); // tray Pause, mid-pick
    await sleep(2200);
    const st = await mainState();
    ok(!st.hasWork && !st.sampling, `B8: tray Pause mid-pick -> the late pick does not start a session (${JSON.stringify({ hasWork: st.hasWork, sampling: st.sampling })})`);
    ok(await page.getAttribute('main', 'data-pet-state') !== 'working', 'B8: the pet is not working after Pause');
    await app.close();
  }
  {
    const { app, page, mainState } = await launch({ QUESTLING_PICK_DELAY_MS: '0' });
    await page.click('#pause-btn'); // paused, window remembered
    await sleep(200);
    await app.evaluate(() => { process.env.QUESTLING_PICK_DELAY_MS = '1500'; }); // the hook reads the env on every pick
    await page.click('#pause-btn'); // resume -> pickWindow (slow)
    await page.evaluate(() => document.getElementById('new-task').click()); // mid-resume
    await sleep(2200);
    const st = await mainState();
    ok(!st.hasWork && !st.sampling, `B8: New task mid-resume -> no session left running in main (${JSON.stringify({ hasWork: st.hasWork, sampling: st.sampling })})`);
    await app.close();
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
