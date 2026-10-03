// Time disc + timebox: the disc shrinks with active time, pauses when away, and the timebox card fires once at 0.
// Signal time is scripted (20 s steps) so a 5-minute timebox takes 15 signals, not 5 minutes.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, PENSUM_TEST: '1', PENSUM_MOCK: '1', PENSUM_FAKE_IDLE_SEC: '0', PENSUM_LEDGER_PATH: path.join(ud, 'u.jsonl'), PENSUM_TIME_SCALE: '600' };
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
  let t = Date.now();
  const send = (o) => { t += 20000; return app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('signal', s),
    { ts: t, changed: true, fgHwnd: 111, fgProcess: 'notepad', onWork: true, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o }); };
  const left = () => page.$eval('#disc', (e) => Number(e.style.getPropertyValue('--left')));
  const minutes = () => page.evaluate(() => JSON.parse(localStorage.getItem('pensum-state-v1')).quests.map((q) => q.minutes));
  const firstMin = (await minutes())[0];
  ok(firstMin <= 5, `quest 1 timebox is ${firstMin} min (<= 5)`);
  ok((await left()) === 1, 'disc starts full');
  await send({}); await send({}); await send({});     // 60 s of 300 s
  await sleep(200);
  const l1 = await left();
  ok(l1 < 1 && Math.abs(l1 - (1 - 60 / (firstMin * 60))) < 0.1, `disc shrinks with active time (${l1.toFixed(2)})`);
  ok(!(await page.isVisible('.ql-card--timebox')), 'no timebox card yet');
  // away: time stops counting and the disc dims
  await send({ idleSec: 400 }); await send({ idleSec: 400 });
  await sleep(200);
  ok(await page.$eval('#disc', (e) => e.classList.contains('is-paused')), 'away -> disc dimmed (paused)');
  const l2 = await left();
  await send({ idleSec: 400 });
  await sleep(100);
  ok((await left()) === l2, 'away: no time counted');
  // back, run the rest of the timebox
  await send({ idleSec: 0 });
  await page.waitForSelector('.ql-card--reentry:not(.hidden)', { timeout: 3000 }); // coming back from away offers re-entry first
  await page.click('#card-quiet');
  await sleep(700); // scaled speech cap (5 min / 600)
  for (let i = 0; i < 16 && !(await page.isVisible('.ql-card--timebox:not(.hidden)')); i++) { await send({}); await sleep(120); }
  await page.waitForSelector('.ql-card--timebox:not(.hidden)', { timeout: 3000 });
  const title = await page.textContent('#card-title');
  ok(title === `Quest 1 had its ${firstMin} minutes.`, 'timebox card: ' + title);
  ok((await left()) === 0, 'disc empty at the end of the timebox');
  ok(await page.getAttribute('main', 'data-pet-state') === 'curious', 'timebox card -> curious');
  // once: more active signals do not re-fire the same timebox
  await page.click('#card-x');
  await send({}); await send({}); await sleep(300);
  ok(!(await page.isVisible('.ql-card--timebox:not(.hidden)')), 'fires once per timebox length');
  console.log(`\n${pass} pass, ${fail} fail (part 1)`);
  await app.close();

  // Part 2: +10 min extends and the card fires again at the new end; Next quest moves on.
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env2 = { ...env, PENSUM_LEDGER_PATH: path.join(ud2, 'u.jsonl') };
  const app2 = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud2], env: env2 });
  const p2 = await app2.firstWindow();
  await p2.waitForSelector('#bar');
  await p2.click('#toggle'); await p2.fill('#task-text', 'my water cycle essay'); await p2.click('#make-quests'); await p2.waitForSelector('.ql-quest');
  await p2.click('#start-btn'); await p2.waitForSelector('.ql-window'); await p2.click('.ql-window'); await p2.click('#windows-start'); await p2.waitForSelector('#stuck-btn:not(.hidden)');
  if (await p2.isVisible('.ql-card--starter')) await p2.click('#card-quiet');
  let t2 = Date.now();
  const send2 = (o) => { t2 += 20000; return app2.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('signal', s),
    { ts: t2, changed: true, fgHwnd: 111, fgProcess: 'notepad', onWork: true, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o }); };
  const mins2 = () => p2.evaluate(() => JSON.parse(localStorage.getItem('pensum-state-v1')).quests.map((q) => q.minutes));
  const m0 = (await mins2())[0];
  for (let i = 0; i < 30 && !(await p2.isVisible('.ql-card--timebox:not(.hidden)')); i++) { await send2({}); await sleep(80); }
  await p2.waitForSelector('.ql-card--timebox:not(.hidden)', { timeout: 3000 });
  await p2.click('#card-primary'); // +10 min
  ok((await mins2())[0] === m0 + 10, `+10 min extends the quest (${m0} -> ${m0 + 10})`);
  ok(await p2.isHidden('#card'), '+10 closes the card');
  ok((await p2.$eval('#disc', (e) => Number(e.style.getPropertyValue('--left')))) > 0.3, 'disc refills after the extension');
  for (let i = 0; i < 60 && !(await p2.isVisible('.ql-card--timebox:not(.hidden)')); i++) { await send2({}); await sleep(80); }
  await p2.waitForSelector('.ql-card--timebox:not(.hidden)', { timeout: 3000 });
  ok(true, 'fires again at the new end');
  await p2.click('#card-quiet'); // Next quest
  const cur = await p2.evaluate(() => [...document.querySelectorAll('.ql-quest')].findIndex((li) => li.classList.contains('is-current')));
  ok(cur === 1, `Next quest -> current is quest 2 (index ${cur})`);
  ok(await p2.$$eval('.ql-quest input[type=checkbox]', (b) => b.every((x) => !x.checked)), 'nothing completed by moving on');
  await app2.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
