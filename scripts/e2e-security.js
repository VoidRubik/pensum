// Ship-prep hardening, proven in the real Electron window (mock mode, $0, fresh profile).
// Needs playwright-core (devDependency). Run with QUESTLING_MOCK=1 GEMINI_API_KEY= so no paid call can happen.
const { launch, reach, sleep } = require('./ui-drive.js');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

(async () => {
  const h = await launch({ env: { QUESTLING_MOCK: '1' } });
  const { app, page } = h;
  for (const step of ['ask', 'review', 'windows', 'starter']) await reach[step](h);

  // --- webPreferences are explicit, the window cannot navigate away or pop up, permissions are denied ---
  const wp = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  ok(wp.contextIsolation === true && wp.nodeIntegration === false && wp.sandbox === true, `webPreferences contextIsolation/nodeIntegration/sandbox = ${wp.contextIsolation}/${wp.nodeIntegration}/${wp.sandbox}`);
  ok(await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'), 'renderer has no require / process');
  const url0 = page.url();
  await page.evaluate(() => { location.href = 'https://example.com/'; }).catch(() => {});
  await sleep(800);
  ok(page.url() === url0, 'navigation to another origin is blocked (url unchanged)');
  const opened = await page.evaluate(() => window.open('https://example.com/') === null).catch(() => false);
  await sleep(300);
  ok(opened && app.windows().length === 1, 'window.open is denied and no second window exists');
  ok((await page.evaluate(() => Notification.requestPermission())) === 'denied', 'Notification permission is denied');

  // --- linked files: main reads only paths the user picked in the dialog ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-linked-'));
  const picked = path.join(dir, 'picked.txt'), other = path.join(dir, 'other.txt');
  fs.writeFileSync(picked, 'my essay about the water cycle');
  fs.writeFileSync(other, 'a file the renderer names but the user never picked');
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, picked);
  const look = (linkedPath) => page.evaluate((lp) => window.questling.look({ purpose: 'check', quest: { title: 'x' }, idx: 0, epoch: 0, ctx: {}, allow: [], linkedPath: lp }), linkedPath);
  const seen = () => app.evaluate(() => global.__qlState().lastGetText);

  await look(other);
  ok((await seen())?.linkedPath === null, 'an unlisted path is ignored (getText got linkedPath null)');
  await look('C:/Windows/win.ini');
  ok((await seen())?.linkedPath === null, 'a system path is ignored');
  const r = await page.evaluate(() => window.questling.linkWork());
  ok(r && r.path === picked && r.readable === true, 'link-work returns the picked file');
  await look(picked);
  ok((await seen())?.linkedPath === picked, 'a path chosen in the dialog is read');
  await look(other);
  ok((await seen())?.linkedPath === null, 'an unlisted path is still ignored after linking another file');
  await look(null);
  ok((await seen())?.linkedPath === null, 'null (new task) reads nothing');
  const ud = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  ok(Array.isArray(saved.linked) && saved.linked.includes(picked) && !saved.linked.includes(other), 'settings.json persists the picked path only');

  // --- recording toggle: default hidden; the tray handler flips it, applies it and persists it ---
  const st0 = await app.evaluate(() => global.__qlState());
  ok(st0.capture === 'hidden' && st0.protect === true, 'default: hidden from screen recordings, content protection on');
  await app.evaluate(() => global.__qlSetCapture(false));
  const st1 = await app.evaluate(() => global.__qlState());
  ok(st1.capture === 'visible' && st1.protect === false, 'toggle off: visible, content protection off');
  ok(JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).capture === 'visible', 'settings.json persists capture: visible');
  await app.evaluate(() => global.__qlSetCapture(true));
  ok((await app.evaluate(() => global.__qlState())).protect === true, 'toggle on again: content protection back on');

  console.log(`\n${pass} pass, ${fail} fail`);
  await h.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
