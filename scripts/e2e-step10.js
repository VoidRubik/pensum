// Session recap: End session, and the automatic recap when every quest is done. Counters come from real UI actions.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_TEST: '1', QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'u.jsonl'), QUESTLING_TIME_SCALE: '600' };
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
    { ts: Date.now(), changed: true, fgHwnd: 111, fgProcess: 'notepad', onWork: true, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o });
  return { app, page, send };
}
async function completeCurrent(page) {
  await page.click('#done-btn');
  await page.waitForSelector('.ql-card--confirm:not(.hidden)');
  await page.click('#card-primary');
}

(async () => {
  // A: End session after one quest, one stuck step, one drift ask
  {
    const { app, page, send } = await launch();
    await page.click('#stuck-btn');
    await page.waitForSelector('.ql-card--step:not(.hidden)');
    await page.click('#card-x');
    await send({ onWork: false, fgProcess: 'chrome' }); await sleep(300);
    for (let i = 0; i < 20 && !(await page.isVisible('#card:not(.hidden) #card-chips:not(.hidden)')); i++) { await send({ onWork: false, fgProcess: 'chrome' }); await sleep(150); }
    await page.click('#card-primary'); // Back on track
    await sleep(700); // the unsolicited re-entry obeys the speech cap (5 min / 600 = 0.5 s)
    await send({ onWork: true });
    await page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 3000 }); // back after >= 3 min (scaled) off the work window
    await page.click('#card-quiet');
    await completeCurrent(page);
    await page.click('#toggle');
    ok(await page.isVisible('#end-btn'), 'End session visible while a session runs');
    ok(await page.isHidden('#start-btn'), 'Start hidden while a session runs');
    await page.click('#end-btn');
    await page.waitForSelector('#recap:not(.hidden)');
    const praise = await page.textContent('#recap-praise');
    ok(/^1 of 3 done: /.test(praise), 'praise names what got done: ' + praise);
    ok((await page.textContent('#rs-done')) === '1 of 3', 'planned vs done');
    ok((await page.textContent('#rs-stuck')) === '1', 'stuck steps used = 1');
    ok((await page.textContent('#rs-drifts')) === '1', 'drifts caught = 1');
    ok((await page.textContent('#rs-back')) === '1', 'back on track = 1');
    ok(/^\d+ min$/.test(await page.textContent('#rs-min')), 'minutes on quest: ' + await page.textContent('#rs-min'));
    ok((await page.$$('#recap-list li')).length === 1, 'done list has the finished quest');
    await page.click('#recap-close');
    ok(await page.isVisible('#quest-list'), 'Back to quests');
    ok(await page.isVisible('#start-btn') && await page.isHidden('#end-btn'), 'session ended -> Start is back, End hidden');
    await app.close();
  }
  // B: all quests done -> recap appears by itself, "All N done"
  {
    const { app, page } = await launch();
    for (let i = 0; i < 3; i++) {
      await page.click('#done-btn');
      await page.waitForSelector('.ql-card--confirm:not(.hidden)');
      await page.click('#card-primary');
      await sleep(150);
    }
    await page.waitForSelector('#recap:not(.hidden)', { timeout: 3000 });
    const praise = await page.textContent('#recap-praise');
    ok(/^All 3 done: .* Nice\.$/.test(praise), 'all done -> automatic recap: ' + praise);
    ok(await page.getAttribute('main', 'data-pet-state') !== 'working', 'session stopped after the last quest');
    await page.click('#recap-new');
    ok(await page.isVisible('#task-text'), 'New task from the recap -> onboarding');
    await app.close();
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
