// UI v2 end to end: the real Electron overlay (mock model, no key) walked through all 8 design screens, in both themes
// (Electron nativeTheme, not a Playwright override) and both pets. Writes 32 screenshots to evidence/ui-v2/.
// Screenshots are page captures (CDP) of the real window; the OS-level capture is blocked by setContentProtection.
const fs = require('node:fs'), path = require('node:path');
const { launch, reach, sleep, Q } = require('./ui-drive.js');
const out = path.join(__dirname, '..', 'evidence', 'ui-v2');
fs.mkdirSync(out, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

const html = fs.readFileSync(path.join(Q, 'index.html'), 'utf8');
ok(!/\sstyle=/i.test(html), 'index.html has no inline style="" attribute (CSP style-src self)');
ok(!/[✓✕▴▾❪▶]|❙❙/.test(html.replace(/<symbol[\s\S]*?<\/symbol>/g, '')), 'index.html has no text glyph icons');

async function run(theme, pet) {
  const tag = `${theme}-${pet}`;
  const h = await launch({ env: { PENSUM_MOCK_QUESTS_MS: '1200' } });
  const { page } = h;
  await h.theme(theme);
  const shot = async (n, name) => { await sleep(450); await page.screenshot({ path: path.join(out, `ui-v2-${tag}-${n}-${name}.png`) }); };
  const inWindow = () => page.evaluate(() => { const r = document.getElementById('bar').getBoundingClientRect(); return r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5 && r.left >= 0 && document.documentElement.scrollWidth <= innerWidth; });
  const state = () => page.getAttribute('main', 'data-pet-state');

  await reach.ask(h);
  await page.click(`#pet-switch [data-pet=${pet}]`);
  ok(await page.getAttribute('.pet', 'data-pet') === pet, `${tag}: pet is ${pet}`);
  ok(await page.evaluate((d) => matchMedia('(prefers-color-scheme: dark)').matches === d, theme === 'dark'), `${tag}: the real window reports ${theme}`);
  ok(/finish today/.test(await page.textContent('#task-title')), `${tag} 01: ask screen`);
  await shot('01', 'ask');

  await reach.making(h);
  ok((await page.$$('.ql-skel__row')).length === 4 && await state() === 'thinking' && /Making quests/.test(await page.textContent('#quest-line')), `${tag} 02: skeleton rows, bar says Making quests, pet thinking`);
  await shot('02', 'making');

  await reach.review(h);
  ok((await page.textContent('#fit-work')).length > 0 && /spare|short by/.test(await page.textContent('#fit-spare')) && /left|past due/.test(await page.textContent('#time-left')), `${tag} 03: fit meter ${await page.textContent('#fit-work')} work / ${await page.textContent('#fit-spare')}`);
  const n0 = (await page.$$('.ql-quest')).length;
  await page.click('#add-quest');
  ok((await page.$$('.ql-quest')).length === n0 + 1, `${tag} 03: + Add a quest adds a row`);
  await shot('03', 'review');

  await reach.windows(h);
  await page.click('.ql-window');
  ok(/^Start in /.test(await page.textContent('#windows-start')), `${tag} 04: selecting a window offers "${await page.textContent('#windows-start')}"`);
  await shot('04', 'window');

  await page.click('#windows-start');
  await page.waitForSelector('.ql-card--starter:not(.hidden)');
  await page.click('#card-primary');
  await sleep(100);
  ok(await page.isVisible('#card-count') && (await page.textContent('#card-primary')) === 'Did it', `${tag} 05: Tiny start counts down, Did it / Skip`);
  await shot('05', 'tinystart');

  await reach.drift(h);
  ok((await page.textContent('#card-tag')) === 'Quick check' && (await page.textContent('#card-primary')) === 'Back on track', `${tag} 06: Quick check, Back on track`);
  await shot('06', 'drift');

  await reach.questDone(h);
  ok(/^Quest 1 of \d+ done/.test(await page.textContent('#qd-tag')), `${tag} 07: ${await page.textContent('#qd-tag')}`);
  await shot('07', 'questdone');
  await page.click('#qd-start');

  await reach.allDone(h);
  ok(/^All \d+ quests done/.test(await page.textContent('#recap-tag')), `${tag} 08: ${await page.textContent('#recap-tag')}`);
  await shot('08', 'alldone');

  ok(await inWindow(), `${tag}: bar and content stay inside the window, no horizontal scroll`);
  ok(h.errs.length === 0, `${tag}: no console/CSP errors ${JSON.stringify(h.errs.slice(0, 2))}`);
  await h.close();
}

(async () => {
  for (const theme of ['light', 'dark']) for (const pet of ['tuck', 'kip']) await run(theme, pet);
  // privacy: the one-liner by default, the full text byte-identical behind Details
  const h = await launch();
  await reach.ask(h);
  const { page } = h;
  const PRIVACY = 'Pensum only looks at the window you pick, only during a session. Frames are never saved to disk. Each look sends one frame of that window, its title, and (if you link a doc or use Word) the doc\'s text to Google Gemini; on the free tier Google may use it to improve its products. Window previews in the picker stay on this PC.';
  ok(await page.isHidden('#privacy-note') && await page.isVisible('#privacy-line'), 'privacy: short line visible, full text hidden by default');
  await page.click('#privacy-toggle');
  ok(await page.isVisible('#privacy-note') && (await page.textContent('#privacy-note')) === PRIVACY, 'privacy: Details shows the full text, byte-identical');
  await h.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
