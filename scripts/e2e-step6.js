// Re-entry card: triggers (away->back, 3 min off the work window, break end, resume after pause). Mock model, test mode, scaled time.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(extra) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_TEST: '1', QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'usage.jsonl'), QUESTLING_TIME_SCALE: '600', ...extra };
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
  await page.waitForSelector('#stuck-btn:not(.hidden)');
  const send = (o) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('signal', s),
    { ts: Date.now(), changed: true, fgHwnd: 111, fgProcess: 'notepad', onWork: true, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o });
  return { app, page, send };
}
const reentry = (page) => page.isVisible('.ql-card--reentry:not(.hidden)');
const undone = (page) => page.$$eval('.ql-quest input[type=checkbox]', (b) => b.every((x) => !x.checked));

(async () => {
  // A: away (idle >= 5 min) then back
  {
    const { app, page, send } = await launch();
    await send({ idleSec: 400 });
    await page.waitForFunction(() => document.querySelector('main').dataset.petState === 'sleepy', null, { timeout: 3000 });
    ok(true, 'A: idle 400 s -> away -> sleepy');
    await send({ idleSec: 0 });
    await page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 4000 });
    ok(await page.textContent('#card-title') === 'Welcome back', 'A: back from away -> re-entry card');
    ok(/Next:/.test(await page.textContent('#card-body')), 'A: card names the next step');
    ok(await undone(page), 'A: nothing completed');
    await page.click('#card-primary');
    ok(!(await reentry(page)), "A: Let's go closes it");
    await app.close();
  }
  // B: 3 min (scaled 0.3 s) away from the work window, then back onto it
  {
    const { app, page, send } = await launch();
    await send({ onWork: false, fgProcess: 'discord' });
    await sleep(500);
    await send({ onWork: true });
    await page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 4000 });
    ok(true, 'B: back on the work window after >= 3 min off it -> re-entry card');
    await app.close();
  }
  // B2: short detour does NOT re-enter
  {
    const { app, page, send } = await launch();
    await send({ onWork: false, fgProcess: 'discord' });
    await sleep(60);
    await send({ onWork: true });
    await sleep(600);
    ok(!(await reentry(page)), 'B2: a quick detour (< 3 min scaled) -> no re-entry card');
    await app.close();
  }
  // C: resume after pause (a click: exempt from the speech cap)
  {
    const { app, page } = await launch();
    await page.click('#pause-btn');
    await page.click('#pause-btn');
    await page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 4000 });
    ok(true, 'C: resume after pause -> re-entry card');
    await app.close();
  }
  // D: break end
  {
    const { app, page, send } = await launch();
    await send({ onWork: false, fgProcess: 'chrome' });
    await sleep(400);
    await send({ onWork: false, fgProcess: 'chrome' });
    await page.waitForSelector('#card:not(.hidden) #card-chips:not(.hidden)', { timeout: 3000 });
    await page.click('text=taking a break');
    await sleep(300);
    await send({ onWork: true, idleSec: 0 });
    await page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 4000 });
    ok(true, 'D: end of a break -> re-entry card');
    await page.click('#card-quiet');
    ok(await page.getAttribute('main', 'data-pet-state') === 'working', 'D: Later -> back to working');
    await app.close();
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
