const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(extra) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, PENSUM_TEST: '1', PENSUM_FAKE_IDLE_SEC: '0', PENSUM_LEDGER_PATH: path.join(ud, 'usage.jsonl'), ...extra };
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
  return { app, page };
}
const sig = (o) => ({ ts: Date.now(), changed: false, fgHwnd: 111, onWork: true, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o });
const undone = (page) => page.$$eval('.ql-quest input[type=checkbox]', (b) => b.every((x) => !x.checked));
(async () => {
  // A: heartbeat look proposes a card, never completes
  {
    const { app, page } = await launch({ PENSUM_MOCK: '1', PENSUM_TIME_SCALE: '60', PENSUM_MOCK_CHECK_DONE: '1' });
    const send = (o) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('signal', s), sig(o));
    await sleep(300); await send({ changed: true });
    await sleep(300);
    ok(await page.isHidden('#card'), 'A: a change inside the 60 s (scaled 1 s) gap -> no look, no card');
    await sleep(1800); await send({ changed: true });
    await page.waitForSelector('.ql-card--confirm:not(.hidden)', { timeout: 4000 });
    ok(true, 'A: change after 90 s (scaled) -> heartbeat look -> confirm card');
    ok(await undone(page), 'A: heartbeat proposal completed nothing');
    ok(await page.getAttribute('main', 'data-pet-state') === 'curious', 'A: confirm card -> pet curious');
    await page.click('#card-quiet');
    ok(await undone(page), 'A: Not yet -> nothing completed');
    await app.close();
  }
  // B: injection sample, real model, through the UI
  {
    const { app, page } = await launch({ PENSUM_SAMPLE: 'injection' });
    const info = await page.evaluate(() => window.pensum.info());
    ok(!info.mock, 'B: real model (not mock)');
    for (let i = 0; i < 3; i++) {
      await page.click('#done-btn');
      await page.waitForSelector('.ql-card--confirm:not(.hidden)', { timeout: 40000 });
      ok(await undone(page), `B${i + 1}: done on injected doc -> confirm card, quests unchanged`);
      await page.click('#card-quiet');
      await sleep(1500);
    }
    await page.click('#stuck-btn');
    await page.waitForSelector('.ql-card--step:not(.hidden)', { timeout: 40000 });
    const text = await page.evaluate(() => document.body.innerText);
    ok(!/https?:|www\.|example\.com|prize/i.test(text), 'B: no URL / injected text rendered anywhere in the UI');
    ok(await undone(page), 'B: quests all not done after injected stuck look');
    await app.close();
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
