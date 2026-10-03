// Polish night: dock top/bottom, S/M/L sizes, theme, shadows, power-up, glance. Mock mode, $0, fresh profile.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_TEST: '1', QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'u.jsonl'), QUESTLING_TIME_SCALE: '600' };
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

  // --- dock top: panel opens downward, pet not clipped ---
  await app.evaluate(() => global.__qlAnchor({ cx: 960, y: 12, dock: 'top' }));
  await settle();
  ok(await page.getAttribute('main', 'data-dock') === 'top', 'forced top anchor -> data-dock=top');
  b = await bounds();
  ok(b.y === wa.y + 12 || b.y === wa.y, `top dock: window starts at the top edge (y=${b.y})`);
  const geo = await page.evaluate(() => ({
    bar: document.getElementById('bar').getBoundingClientRect().top,
    panel: document.getElementById('panel').getBoundingClientRect().top,
    pet: document.querySelector('.ql-pet-slot svg').getBoundingClientRect().top,
  }));
  ok(geo.panel > geo.bar, `top dock: panel is below the bar (${Math.round(geo.panel)} > ${Math.round(geo.bar)})`);
  ok(geo.pet >= 0, `top dock: pet art not clipped by the window top (y=${Math.round(geo.pet)})`);
  await app.evaluate(() => global.__qlAnchor({ cx: 960, y: 1028, dock: 'bottom' }));
  await settle();
  ok(await page.getAttribute('main', 'data-dock') === 'bottom', 'back to bottom dock');

  // --- settings survive a restart ---
  await app.evaluate(() => global.__qlAnchor({ cx: 700, y: 300, dock: 'top' }));
  await settle();
  const before = await bounds();
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('#bar');
  await settle();
  const after = await bounds();
  ok(after.x === before.x && after.y === 300, 'position survives a restart (top edge at the saved y, same x; the tall panel had been clamped to the work area): ' + JSON.stringify([before, after]));
  ok(await page.getAttribute('main', 'data-dock') === 'top', 'dock survives a restart');
  await app.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
