// Polish night: dock top/bottom, S/M/L sizes, theme, shadows, power-up, glance. Mock mode, $0, fresh profile.
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
  const launch = () => _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  let app = await launch();
  let page = await app.firstWindow();
  await page.emulateMedia({ colorScheme: null }); // Playwright pins light otherwise, which hides the theme switch
  await page.waitForSelector('#bar');
  const bounds = () => app.evaluate(() => global.__qlBounds());
  const work = () => app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const settle = () => sleep(400);

  // --- default: bottom centre, grows up ---
  let b = await bounds(); const wa = await work();
  ok(await page.getAttribute('main', 'data-dock') === 'bottom', 'default dock is bottom');
  ok(Math.abs(b.x + b.width / 2 - (wa.x + wa.width / 2)) <= 1, 'default: horizontally centred');
  ok(b.y + b.height === wa.y + wa.height - 12, 'default: bottom edge 12 px above the work area');

  // --- size S / M / L ---
  const sizes = {};
  for (const s of ['S', 'M', 'L']) {
    if (!(await page.isVisible('#size-switch'))) await page.click('#toggle');
    await page.click(`#size-switch [data-size=${s}]`);
    await settle();
    const bb = await bounds();
    sizes[s] = bb;
    ok(await page.getAttribute(`#size-switch [data-size=${s}]`, 'aria-checked') === 'true', `size ${s}: switch shows it`);
    ok(bb.x >= wa.x && bb.y >= wa.y && bb.x + bb.width <= wa.x + wa.width && bb.y + bb.height <= wa.y + wa.height, `size ${s}: window inside the work area`);
  }
  ok(sizes.S.width < sizes.M.width && sizes.M.width < sizes.L.width, `bounds scale with size (${sizes.S.width} < ${sizes.M.width} < ${sizes.L.width})`);
  ok(Math.abs(sizes.L.x + sizes.L.width / 2 - (sizes.S.x + sizes.S.width / 2)) <= 1, 'switching size does not shift the window sideways');
  ok(sizes.L.y + sizes.L.height === sizes.S.y + sizes.S.height, 'bottom dock: the bottom edge stays put across sizes');
  ok(await page.evaluate(() => document.querySelector('.ql-switch__opt').getBoundingClientRect().width > 0 && !document.getElementById('panel').classList.contains('hidden')), 'panel still open and laid out at L');
  const fits = await page.evaluate(() => { const r = document.getElementById('panel').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; });
  ok(fits, 'L: panel fits inside the window (no clipping)');

  // --- theme Auto/Light/Dark follows nativeTheme; shadows Soft/Flat is renderer-only ---
  const dark = () => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  await page.click('#theme-switch [data-theme=dark]'); await settle();
  ok(await dark() === true, 'theme Dark -> prefers-color-scheme: dark');
  await page.click('#theme-switch [data-theme=light]'); await settle();
  ok(await dark() === false, 'theme Light -> prefers-color-scheme: light');
  ok(await page.getAttribute('#theme-switch [data-theme=light]', 'aria-checked') === 'true', 'theme switch shows the choice');
  const shadow = () => page.evaluate(() => getComputedStyle(document.getElementById('panel')).boxShadow);
  ok(await shadow() !== 'none', 'shadows Soft (default): the panel has a shadow');
  await page.click('#shadows-switch [data-shadows=flat]');
  ok(await shadow() === 'none', 'shadows Flat -> panel box-shadow none');
  ok(await page.evaluate(() => localStorage.getItem('ql.shadows')) === 'flat', 'Flat is remembered (localStorage ql.shadows)');
  await page.click('#shadows-switch [data-shadows=soft]');
  ok(await shadow() !== 'none', 'back to Soft');
  const prefsFit = await page.evaluate(() => { const p = document.getElementById('panel').getBoundingClientRect(); return [...document.querySelectorAll('#prefs .ql-switch')].every((s) => { const r = s.getBoundingClientRect(); return r.right <= p.right && r.left >= p.left; }); });
  ok(prefsFit, 'footer grid: every switch stays inside the panel');
  await page.click('#size-switch [data-size=M]'); await settle();

  // --- dock top: panel opens downward, pet not clipped ---
  await app.evaluate((_el, a) => global.__qlAnchor(a), { cx: wa.x + wa.width / 2, y: wa.y + 12, dock: 'top' });
  await settle();
  ok(await page.getAttribute('main', 'data-dock') === 'top', 'forced top anchor -> data-dock=top');
  b = await bounds();
  ok(b.y === wa.y + 12, `top dock: window starts at the top edge (y=${b.y})`);
  const geo = await page.evaluate(() => ({
    bar: document.getElementById('bar').getBoundingClientRect().top,
    panel: document.getElementById('panel').getBoundingClientRect().top,
    pet: document.querySelector('.ql-pet-slot svg').getBoundingClientRect().top,
  }));
  ok(geo.panel > geo.bar, `top dock: panel is below the bar (${Math.round(geo.panel)} > ${Math.round(geo.bar)})`);
  ok(geo.pet >= 0, `top dock: pet art not clipped by the window top (y=${Math.round(geo.pet)})`);
  await app.evaluate((_el, a) => global.__qlAnchor(a), { cx: wa.x + wa.width / 2, y: wa.y + wa.height - 12, dock: 'bottom' });
  await settle();
  ok(await page.getAttribute('main', 'data-dock') === 'bottom', 'back to bottom dock');

  // --- settings survive a restart ---
  await app.evaluate((_el, a) => global.__qlAnchor(a), { cx: wa.x + 700, y: wa.y + 300, dock: 'top' });
  await settle();
  const before = await bounds();
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('#bar');
  await settle();
  const after = await bounds();
  ok(after.x === before.x && after.y === wa.y + 300, 'position survives a restart (top edge at the saved y, same x; the tall panel had been clamped to the work area): ' + JSON.stringify([before, after]));
  ok(await page.getAttribute('main', 'data-dock') === 'top', 'dock survives a restart');
  await app.close();

  // --- power-up on every confirmed quest; a second inside 3.6 s restarts it (real time: TIME_SCALE 1) ---
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env2 = { ...env, PENSUM_LEDGER_PATH: path.join(ud2, 'u.jsonl') };
  delete env2.PENSUM_TIME_SCALE;
  app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud2], env: env2 });
  page = await app.firstWindow();
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
  await page.evaluate(() => {
    window.__celeb = [];
    const m = document.querySelector('main');
    new MutationObserver(() => window.__celeb.push(m.dataset.petState)).observe(m, { attributes: true, attributeFilter: ['data-pet-state'] });
  });
  const tick = () => page.evaluate(() => { [...document.querySelectorAll('.ql-quest input[type=checkbox]')].find((x) => !x.checked).click(); });
  const state = () => page.getAttribute('main', 'data-pet-state');
  const powered = () => page.evaluate(() => document.getElementById('bar').classList.contains('is-powered'));
  // --- the glance: leaving the work window -> curious at once, silently; back -> working; no foreground process -> no glance ---
  const sig = (o) => app.evaluate(({ BrowserWindow }, o) => BrowserWindow.getAllWindows()[0].webContents.send('signal', { ts: Date.now(), changed: false, fgHwnd: 0, fgProcess: null, onWork: false, windowAlive: true, windowVisible: true, idleSec: 0, locked: false, ...o }), o);
  if (await page.isVisible('#bubble')) await page.click('#bubble-x'); // the session-start greeting is not what is under test
  await sig({ fgProcess: null, onWork: false });
  await sleep(250);
  ok(await state() === 'working', 'glance: empty focus ring (fgProcess null) -> still working, nothing to look at');
  await sig({ fgProcess: 'spotify.exe', onWork: false });
  await sleep(250);
  ok(await state() === 'curious', 'glance: another app in front -> curious right away');
  ok(await page.isHidden('#bubble') && await page.isHidden('#card'), 'glance: no speech, no card');
  await sig({ fgProcess: 'winword.exe', onWork: true });
  await sleep(250);
  ok(await state() === 'working', 'glance: back in the work window -> working');
  await tick();
  const t1 = Date.now();
  await sleep(300);
  ok(await state() === 'celebrate' && await powered(), 'one confirmed quest -> celebrate + .ql-bar.is-powered');
  await sleep(700);
  await tick(); // ~1 s after the first
  const t2 = Date.now();
  await sleep(2800); // t1 + ~3.8 s: the first power-up would be over by now
  ok(Date.now() - t1 > 3700 && await state() === 'celebrate', 'second quest inside 3.6 s: the power-up keeps going past the first one\'s end');
  const log = await page.evaluate(() => window.__celeb);
  ok(log.filter((x) => x === 'celebrate').length >= 2, 'it restarted: celebrate was left and re-entered (' + log.join(' > ') + ')');
  await sleep(Math.max(0, t2 + 3600 - Date.now()) + 700);
  ok(await state() !== 'celebrate' && !(await powered()), 'it ends 3.6 s after the second quest');
  await app.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
