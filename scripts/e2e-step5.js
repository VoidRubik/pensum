const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(extra) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_TEST: '1', QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'usage.jsonl'), ...extra };
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
    { ts: Date.now(), changed: true, fgHwnd: 222, fgProcess: 'chrome', onWork: false, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o });
  return { app, page, send };
}
async function pushUntil(page, send, o, sel = '#card:not(.hidden) #card-chips:not(.hidden)') {
  for (let i = 0; i < 20; i++) {
    await send(o);
    if (await page.isVisible(sel)) return true;
    await sleep(150);
  }
  return false;
}
const stateOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('questling-state-v1')));
const cardVisible = (page, sel = '.ql-card--ask') => page.isVisible(sel + ':not(.hidden)');
const driftCard = (page) => page.isVisible('#card:not(.hidden) #card-chips:not(.hidden)');

(async () => {
  // Scale 600: 2 min = 0.2 s, 5 min = 0.5 s, 10 min = 1 s
  const { app, page, send } = await launch({ QUESTLING_TIME_SCALE: '600' });
  await send({ onWork: false }); await sleep(100);
  ok(!(await driftCard(page)), 'drift: no ask before 2 min (scaled)');
  await sleep(200);
  ok(await pushUntil(page, send, { onWork: false }), 'drift: ask appears once 2 min (scaled) have passed');
  ok((await page.textContent('#card-title')).startsWith('Still on "'), 'drift ask: local template title');
  ok((await page.$$('#card-chips .ql-chip')).length === 3, 'drift ask: 3 chips (research / lecture for this / taking a break)');
  ok(await page.isVisible('#card-input'), 'drift ask: free-text field');
  ok(await page.getAttribute('main', 'data-pet-state') === 'curious', 'drift ask -> curious');
  let st = await stateOf(page);
  ok(st.session.driftsAsked === 1, 'counter: driftsAsked = 1');
  await page.click('text=research');
  ok(!(await cardVisible(page)), 'chip closes the card');
  st = await stateOf(page);
  ok(st.session.allow.length === 1 && st.session.allow[0].process === 'chrome' && st.session.allow[0].note === 'research', 'allow list: chrome / research');
  await sleep(1300); await send({}); await sleep(400); await send({});
  ok(!(await driftCard(page)), 'allowed process: never asks again');

  // another process, after the 10 min gap (1 s) and the 5 min speech cap (0.5 s)
  await send({ fgProcess: 'discord' }); await sleep(300);
  ok(await pushUntil(page, send, { fgProcess: 'discord' }), 'second process asks');
  await page.click('#card-x'); // dismissal 1 (unsolicited)
  await sleep(1300); await send({ fgProcess: 'steam' }); await sleep(300);
  ok(await pushUntil(page, send, { fgProcess: 'steam' }), 'third process asks');
  await page.click('#card-x'); // dismissal 2
  await sleep(1300); await send({ fgProcess: 'spotify' }); await sleep(400); await send({ fgProcess: 'spotify' }); await sleep(400); await send({ fgProcess: 'spotify' });
  ok(!(await driftCard(page)), '2 dismissals -> quiet for the rest of the session');
  st = await stateOf(page);
  ok(st.session.driftsAsked === 3, 'driftsAsked counts only asks shown (3)');
  // back on the work window counts as back on track
  const before = st.session.backOnTrack;
  await send({ onWork: true, fgProcess: 'notepad' });
  await sleep(300);
  st = await stateOf(page);
  ok(st.session.backOnTrack === before + 1, 'counter: backOnTrack incremented on return');
  ok(await page.$$eval('.ql-quest input[type=checkbox]', (b) => b.every((x) => !x.checked)), 'nothing completed by any of this');
  await app.close();

  // break chip + in-window drift via a check look (mock off-task)
  const b = await launch({ QUESTLING_TIME_SCALE: '600', QUESTLING_MOCK_CHECK_OFF: '1' });
  await b.send({ onWork: false }); await sleep(300);
  await pushUntil(b.page, b.send, { onWork: false });
  await b.page.click('text=taking a break');
  ok(await b.page.getAttribute('main', 'data-pet-state') === 'sleepy', 'taking a break -> sleepy');
  await sleep(1300); await b.send({ onWork: false }); await sleep(400); await b.send({ onWork: false });
  ok(!(await driftCard(b.page)), 'break mode: no asks');
  await b.send({ onWork: true, fgProcess: 'notepad', idleSec: 0 });
  await b.page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 3000 });
  ok(true, 'activity on the work window ends the break -> re-entry card');
  await b.page.click('#card-quiet');
  await b.page.waitForFunction(() => document.querySelector('main').dataset.petState === 'working', null, { timeout: 3000 });
  ok(true, 'Later -> working');
  await b.app.close();

  // in-window drift: heartbeat check look says off-task at 0.9 -> ask with a LOCAL title
  const c = await launch({ QUESTLING_TIME_SCALE: '600', QUESTLING_MOCK_CHECK_OFF: '1' });
  await sleep(300); await c.send({ onWork: true, fgProcess: 'notepad', changed: true });
  await c.page.waitForSelector('.ql-card--ask:not(.hidden)', { timeout: 4000 });
  const title = await c.page.textContent('#card-title');
  ok(/^Still on "/.test(title) && !/mock/i.test(title), 'in-window drift: ask with local template title (' + title.slice(0, 30) + ')');
  ok(await c.page.$$eval('.ql-quest input[type=checkbox]', (x) => x.every((y) => !y.checked)), 'in-window drift completed nothing');
  await c.app.close();

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
