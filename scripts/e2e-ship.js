// Ship: gear settings sheet, MOCK MODE badge via a stub proxy, reset with inline confirm, own-key form. $0: the stub is local.
// Launch env keeps GEMINI_API_KEY empty (NOT deleted: process.loadEnvFile never overwrites a set var, so the repo .env key can't load).
const { _electron } = require('playwright-core');
const http = require('node:http');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = path.resolve(__dirname, '..').split(path.sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const goodQuests = { ok: true, result: { deadline_iso: new Date(Date.now() + 6 * 3600e3).toISOString(), starter: 'Open the doc.', quests: [{ title: 'Write intro', finish: 'intro exists', minutes: 5 }, { title: 'Body', finish: 'body exists', minutes: 15 }, { title: 'Wrap up', finish: 'end exists', minutes: 15 }] } };

(async () => {
  let stubMode = '429';
  const seen = [];
  const stub = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
      try { seen.push({ url: req.url, method: req.method, body: JSON.parse(b || '{}') }); } catch { seen.push({ url: req.url, method: req.method, body: null }); }
      if (stubMode === '429') { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' }); res.end('{"fallback":"mock","reason":"rate"}'); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(goodQuests)); }
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${stub.address().port}`;

  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'pensum-ship-'));
  const env = { ...process.env, PENSUM_TEST: '1', PENSUM_MOCK: '', GEMINI_API_KEY: '', PENSUM_API: base, PENSUM_FAKE_IDLE_SEC: '0', PENSUM_LEDGER_PATH: path.join(ud, 'u.jsonl') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#bar');
  const info = () => page.evaluate(() => window.pensum.info());
  const i0 = await info();
  if (i0.aiMode !== 'live') { console.log('ABORT: aiMode is ' + i0.aiMode + ', would use a real key or no proxy'); await app.close(); stub.close(); process.exit(2); }
  ok(true, 'aiMode is live (stub proxy), no real key in play');

  const shot = path.resolve(__dirname, '..', 'evidence', 'ship');
  fs.mkdirSync(shot, { recursive: true });
  await page.click('#toggle');
  await page.waitForSelector('#panel:not(.hidden)');

  // 1-2: settings sheet
  ok(await page.isHidden('#settings'), 'settings sheet hidden at boot');
  ok(await page.isHidden('#size-switch') && await page.isHidden('#shadows-switch'), 'size and shadows controls are not shown by default');
  await page.click('#gear-btn');
  ok(await page.isVisible('#settings'), 'gear opens the settings sheet');
  ok(await page.isVisible('#size-switch') && await page.isVisible('#theme-switch') && await page.isVisible('#shadows-switch') && await page.isVisible('#pet-switch'), 'sheet holds size, theme, shadows, pet');
  ok(await page.getAttribute('#gear-btn', 'aria-expanded') === 'true', 'gear aria-expanded true');
  await sleep(300);
  await page.screenshot({ path: path.join(shot, 'settings-open.png') });
  await page.click('#gear-btn');
  ok(await page.isHidden('#settings'), 'second gear click hides the sheet');

  // 3: 429 -> MOCK MODE badge, quests still render
  stubMode = '429';
  await page.fill('#task-text', 'my water cycle essay');
  await page.click('#make-quests');
  await page.waitForSelector('#quest-card:not(.hidden)', { timeout: 15000 });
  ok(await page.isVisible('#mock-badge'), '429 from the proxy -> MOCK MODE badge visible');
  ok((await page.locator('#quest-card .ql-quest, #quest-card li').count()) >= 1, 'quests still render from the local mock plan');
  const req = seen.find((s) => s.url === '/api/pet');
  ok(!!req && req.method === 'POST' && req.body.mode === 'plan' && req.body.goal === 'my water cycle essay' && !('prompt' in req.body), 'proxy got a strict plan body (mode, goal, no prompt)');
  await sleep(300);
  await page.screenshot({ path: path.join(shot, 'mock-badge.png') });

  // 4: live answer -> badge hides
  await page.click('#new-task');
  stubMode = 'ok';
  await page.fill('#task-text', 'my water cycle essay');
  await page.click('#make-quests');
  await page.waitForSelector('#quest-card:not(.hidden)', { timeout: 15000 });
  ok(await page.isHidden('#mock-badge'), 'live answer -> badge hidden');

  // 5: reset with inline confirm
  await page.click('#reset-btn');
  ok(await page.isVisible('#reset-confirm'), 'reset asks for confirmation');
  await page.click('#reset-no');
  ok(await page.isHidden('#reset-confirm') && await page.isVisible('#quest-card'), 'cancel keeps the quests');
  await page.click('#reset-btn');
  await page.click('#reset-yes');
  await sleep(300);
  ok(await page.inputValue('#task-text') === '' && await page.isVisible('#task-card') && await page.isHidden('#quest-card'), 'confirm clears the task and returns to the task view');

  // 6: own key
  await page.click('#gear-btn');
  await page.fill('#key-input', 'short');
  await page.click('#key-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('key-state').textContent.includes('does not look like'));
  ok((await info()).aiMode === 'live', 'a malformed key is rejected, mode unchanged');
  await page.fill('#key-input', 'A'.repeat(39));
  await page.click('#key-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('key-state').textContent === 'Saved');
  const i2 = await info();
  ok(i2.aiMode === 'own-key' && i2.hasKey === true, 'a valid-shaped key switches to own-key');
  ok(fs.existsSync(path.join(ud, '.env')), 'key saved to the (temp) userData .env');
  await page.click('#key-clear');
  await page.waitForFunction(() => document.getElementById('key-state').textContent === 'Using Pensum server');
  ok((await info()).aiMode === 'live', 'clearing the key returns to live');
  ok(!fs.existsSync(path.join(ud, '.env')), 'clear removed the .env');

  await app.close();
  stub.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
