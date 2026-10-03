// Shared driver for the UI v2 scripts (baseline.js, e2e-ui-v2.js): launches the real Electron overlay in
// mock + test mode (no model call, no key) and walks it to each of the 8 design screens by clicking the
// real controls. Needs playwright-core (not a project dependency): set NODE_PATH to a folder that has it.
// VS Code shells set ELECTRON_RUN_AS_NODE=1; it is removed here.
const { _electron } = require('playwright-core');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Q = path.resolve(__dirname, '..').split(path.sep).join('/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ env: extra = {}, test = true } = {}) {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'u.jsonl'), QUESTLING_TIME_SCALE: '600', ...extra };
  if (test) env.QUESTLING_TEST = '1'; else delete env.QUESTLING_TEST;
  delete env.ELECTRON_RUN_AS_NODE;
  const t0 = Date.now();
  const app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#bar');
  const readyMs = Date.now() - t0;
  await app.evaluate(({ ipcMain }) => { global.__sz = 0; ipcMain.on('set-size', () => { global.__sz++; }); });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  const send = (o) => app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('signal', s),
    { ts: Date.now(), changed: true, fgHwnd: 222, fgProcess: 'chrome', onWork: true, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o });
  const sizeCalls = () => app.evaluate(() => global.__sz);
  // Playwright pins prefers-color-scheme to light by default; clearing it lets the REAL path (Electron nativeTheme) drive the page.
  const theme = async (t) => {
    await page.emulateMedia({ colorScheme: null });
    await app.evaluate(({ nativeTheme }, v) => { nativeTheme.themeSource = v; }, t);
    await page.waitForFunction((d) => matchMedia('(prefers-color-scheme: dark)').matches === d, t === 'dark');
  };
  return { app, page, send, sizeCalls, theme, errs, readyMs, close: () => app.close() };
}

// Each reach* leaves the app on that screen. They are cumulative: call them in order.
const reach = {
  async ask(h) { await h.page.click('#toggle'); await h.page.waitForSelector('#task-card:not(.hidden)'); },
  async making(h) { // needs QUESTLING_MOCK_DELAY_MS so the quest call is still pending
    await h.page.fill('#task-text', 'Phylogenetic tree mind map for bio, due 6:22 pm');
    await h.page.click('#make-quests');
    await h.page.waitForSelector('#task-card.is-busy');
  },
  async review(h) {
    if (!(await h.page.isVisible('.ql-quest')) && !(await h.page.$('#task-card.is-busy'))) {
      await h.page.fill('#task-text', 'Phylogenetic tree mind map for bio, due 6:22 pm');
      await h.page.click('#make-quests');
    }
    await h.page.waitForSelector('.ql-quest');
  },
  async windows(h) { await h.page.click('#start-btn'); await h.page.waitForSelector('.ql-window'); },
  async starter(h) { await h.page.click('.ql-window'); await h.page.click('#windows-start'); await h.page.waitForSelector('.ql-card--starter:not(.hidden)'); },
  async drift(h) {
    if (await h.page.isVisible('#card:not(.hidden)')) await h.page.click('#card-x');
    for (let i = 0; i < 25 && !(await h.page.isVisible('#card:not(.hidden) #card-chips:not(.hidden)')); i++) { await h.send({ onWork: false, fgProcess: 'chrome' }); await sleep(150); }
    await h.page.waitForSelector('#card-chips:not(.hidden)');
  },
  async questDone(h) {
    if (await h.page.isVisible('#card:not(.hidden)')) await h.page.click('#card-x');
    await h.send({ onWork: true });
    await h.page.click('#done-btn');
    await h.page.waitForSelector('.ql-card--confirm:not(.hidden)');
    await h.page.click('#card-primary');
    await h.page.waitForSelector('#quest-done:not(.hidden)'); // opens after the power-up lifts off
  },
  async allDone(h) {
    for (let i = 0; i < 6 && !(await h.page.isVisible('#recap:not(.hidden)')); i++) {
      if (await h.page.isVisible('#card:not(.hidden)')) await h.page.click('#card-x').catch(() => {});
      await h.page.click('#done-btn').catch(() => {});
      await h.page.waitForSelector('.ql-card--confirm:not(.hidden)', { timeout: 3000 }).catch(() => {});
      if (await h.page.isVisible('.ql-card--confirm')) await h.page.click('#card-primary');
      await sleep(200);
    }
    await h.page.waitForSelector('#recap:not(.hidden)');
  },
};

const frames = (page, ms) => page.evaluate((t) => new Promise((res) => {
  const d = []; let last = performance.now(); const t0 = last;
  const f = (n) => { d.push(n - last); last = n; if (n - t0 < t) requestAnimationFrame(f); else res(d); };
  requestAnimationFrame(f);
}), ms);
const stats = (d) => {
  const s = d.slice(1).sort((a, b) => a - b);
  const r = (x) => Math.round(x * 10) / 10;
  return { frames: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]), over20ms: s.filter((x) => x > 20).length };
};

module.exports = { launch, reach, frames, stats, sleep, Q };
