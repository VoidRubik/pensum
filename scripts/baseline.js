// Step 0 / Step 7 measurements. Usage: node scripts/baseline.js <label> [--shots]
// Writes evidence/ui-v2/baseline-<label>.json (+ <label>-NN-*.png with --shots). Everything is measured in the real
// Electron window on this machine in mock mode; frame numbers are rAF deltas inside that window (NOT a screen
// capture of the compositor, and not real-hardware/GPU-variety numbers). Startup = process start -> load events.
const fs = require('node:fs'), path = require('node:path');
const { launch, reach, frames, stats, sleep, Q } = require('./ui-drive.js');
const label = process.argv[2] || 'run';
const shots = process.argv.includes('--shots');
const out = path.join(__dirname, '..', 'evidence', 'ui-v2');
fs.mkdirSync(out, { recursive: true });
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function startup(test) {
  const h = await launch({ test });
  const m = await h.page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { origin: performance.timeOrigin, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, fcp: fcp ? fcp.startTime : null };
  });
  const created = await h.app.evaluate(() => process.getCreationTime());
  await h.close();
  return { toNavStart: Math.round(m.origin - created), dcl: Math.round(m.dcl), load: Math.round(m.load), fcp: m.fcp && Math.round(m.fcp), toLoadEnd: Math.round(m.origin - created + m.load), readyMs: h.readyMs };
}

(async () => {
  const res = { label, when: new Date().toISOString(), note: 'Electron window, mock mode, this machine; rAF deltas, not compositor capture' };
  // A. startup, 5 launches each
  for (const test of [true, false]) {
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await startup(test));
    res[test ? 'startupTest' : 'startupReal'] = { runs, medianToLoadEnd: med(runs.map((r) => r.toLoadEnd)), medianReadyMs: med(runs.map((r) => r.readyMs)), medianFcp: med(runs.map((r) => r.fcp || 0)) };
  }
  // B. main-process module load cost (plain node; electron's own require not included)
  const req = {};
  for (const m of ['logic', 'ledger', 'focus', 'artifact', 'capture', 'look-flow', 'ai']) {
    const t = process.hrtime.bigint(); require(path.join(Q, m + '.js')); req[m] = Number(process.hrtime.bigint() - t) / 1e6;
  }
  res.requireMs = Object.fromEntries(Object.entries(req).map(([k, v]) => [k, Math.round(v * 10) / 10]));

  // C. frames per pet state + panel open/close + set-size IPC per flow
  const h = await launch({ env: { QUESTLING_MOCK_DELAY_MS: '0' } });
  const { page } = h;
  res.petFrames = {};
  for (const s of ['idle', 'working', 'curious', 'thinking', 'helper', 'celebrate', 'sleepy', 'asleep']) {
    await page.evaluate((v) => { document.querySelector('main').dataset.petState = v; }, s);
    await sleep(200);
    res.petFrames[s] = stats(await frames(page, 1500));
  }
  await page.evaluate(() => { document.querySelector('main').dataset.petState = 'idle'; });
  const flow = {};
  let c0 = await h.sizeCalls();
  const mark = async (k) => { const c = await h.sizeCalls(); flow[k] = c - c0; c0 = c; };
  const run = async (name, fn) => { const p = frames(page, 900); await fn(); const d = await p; await sleep(100); await mark(name); return stats(d); };
  res.transitionFrames = {};
  res.transitionFrames.openPanel = await run('openPanel', () => reach.ask(h));
  if (shots) await page.screenshot({ path: path.join(out, `${label}-01-ask.png`), omitBackground: true });
  res.transitionFrames.makeQuests = await run('makeQuests', () => reach.review(h));
  if (shots) await page.screenshot({ path: path.join(out, `${label}-03-review.png`), omitBackground: true });
  res.transitionFrames.windows = await run('windows', () => reach.windows(h));
  if (shots) await page.screenshot({ path: path.join(out, `${label}-04-windows.png`), omitBackground: true });
  res.transitionFrames.startSession = await run('startSession', () => reach.starter(h));
  if (shots) await page.screenshot({ path: path.join(out, `${label}-05-starter.png`), omitBackground: true });
  res.transitionFrames.drift = await run('drift', () => reach.drift(h));
  if (shots) await page.screenshot({ path: path.join(out, `${label}-06-drift.png`), omitBackground: true });
  res.transitionFrames.questDone = await run('questDone', () => reach.questDone(h));
  if (shots) await page.screenshot({ path: path.join(out, `${label}-07-questdone.png`), omitBackground: true });
  res.transitionFrames.allDone = await run('allDone', () => reach.allDone(h));
  if (shots) await page.screenshot({ path: path.join(out, `${label}-08-alldone.png`), omitBackground: true });
  res.setSizeCalls = flow;
  res.consoleErrors = h.errs;
  await h.close();
  // D. real window picker + session start (non-test mode: real desktopCapturer + the PowerShell tracker; the mock model, no key)
  const r = await launch({ test: false, env: { QUESTLING_TIME_SCALE: '1' } });
  await reach.ask(r); await reach.review(r);
  let t = Date.now(); await r.page.click('#start-btn'); await r.page.waitForSelector('.ql-window', { timeout: 120000 });
  const listMs = Date.now() - t;
  t = Date.now(); await r.page.click('.ql-window'); await r.page.click('#windows-start'); await r.page.waitForSelector('#stuck-btn:not(.hidden)', { timeout: 120000 });
  res.realPicker = { listWindowsMs: listMs, pickToSessionOnMs: Date.now() - t };
  await r.close();
  fs.writeFileSync(path.join(out, `baseline-${label}.json`), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
