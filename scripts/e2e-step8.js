// Pet state machine: every state reachable through the real UI, idle variants rotate, CSS follows the attributes, reduced motion.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATES = ['idle', 'working', 'curious', 'thinking', 'helper', 'celebrate', 'sleepy', 'asleep'];

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_TEST: '1', QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'u.jsonl'), QUESTLING_TIME_SCALE: '600' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#bar');
  await page.evaluate(() => {
    window.__states = [];
    window.__idle = [];
    window.__speeds = [];
    const m = document.querySelector('main');
    new MutationObserver((recs) => recs.forEach((r) => {
      if (r.attributeName === 'data-pet-state') window.__states.push(m.dataset.petState);
      if (r.attributeName === 'data-idle') window.__idle.push(m.dataset.idle);
      if (r.attributeName === 'style') window.__speeds.push(m.style.getPropertyValue('--speed'));
    })).observe(m, { attributes: true });
    window.__states.push(m.dataset.petState);
  });
  // idle variants (no task yet -> idle). Delay is 7-16 s / 600 = 12-27 ms.
  await sleep(1500);
  const idle = await page.evaluate(() => window.__idle);
  ok(new Set(idle).size >= 3, `idle: variants rotate (${idle.length} changes, ${new Set(idle).size} distinct)`);
  ok(idle.every((v, i) => i === 0 || v !== idle[i - 1]), 'idle: never the same variant twice in a row');
  const speeds = (await page.evaluate(() => window.__speeds)).map(Number).filter((n) => n > 0);
  ok(speeds.length > 3 && speeds.every((n) => n >= 0.85 && n <= 1.15), 'idle: --speed always within 0.85-1.15');

  // walk the real UI through the other states
  await page.click('#toggle');
  await page.fill('#task-text', 'my water cycle essay');
  await page.click('#make-quests');
  await page.waitForSelector('.ql-quest');
  await page.click('#start-btn');
  await page.waitForSelector('.ql-window');
  await page.click('.ql-window'); await page.click('#windows-start');
  await page.waitForSelector('#stuck-btn:not(.hidden)');            // working, curious (starter card)
  await page.click('#card-quiet');
  await page.click('#stuck-btn');                                    // thinking -> helper
  await page.waitForSelector('.ql-card--step:not(.hidden)');
  await page.click('#card-x');
  await page.click('#done-btn');                                     // thinking -> curious (confirm)
  await page.waitForSelector('.ql-card--confirm:not(.hidden)');
  await page.click('#card-primary');                                 // celebrate
  await page.waitForFunction(() => window.__states.includes('celebrate'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('signal', { ts: Date.now(), changed: false, fgHwnd: 0, fgProcess: null, onWork: false, windowAlive: false, windowVisible: false, idleSec: 0, locked: false }));
  await page.waitForFunction(() => window.__states.includes('asleep'));   // window lost
  await page.click('#pause-btn');                                    // sleepy
  await page.waitForFunction(() => window.__states.includes('sleepy'));
  const seen = await page.evaluate(() => [...new Set(window.__states)]);
  ok(STATES.every((s) => seen.includes(s)), 'all 8 states reached through the UI: ' + seen.join(', '));
  ok(seen.every((s) => STATES.includes(s)), 'no state outside the contract names');

  // CSS follows the attributes: exactly one pet state group shows, and it carries a motion rule
  const anim = await page.evaluate(() => {
    const m = document.querySelector('main'); const pet = document.querySelector('.pet'); const out = {};
    const probe = () => {
      const shown = [...pet.querySelectorAll('.ps')].filter((g) => getComputedStyle(g).display !== 'none');
      if (shown.length !== 1) return 'groups:' + shown.length;
      const a = [...shown[0].querySelectorAll('[class]')].map((n) => getComputedStyle(n).animationName).filter((n) => n !== 'none');
      return shown[0].getAttribute('class') + '|' + a.join(',');
    };
    for (const s of ['working', 'curious', 'thinking', 'helper', 'celebrate', 'sleepy', 'asleep']) { m.dataset.petState = s; out[s] = probe(); }
    m.dataset.petState = 'idle';
    for (const v of ['a', 'b', 'c', 'd']) { m.dataset.idle = v; out['idle-' + v] = probe(); }
    return out;
  });
  ok(Object.values(anim).every((n) => /^ps ps-\w+\|.+/.test(n)), 'every state/variant shows one group with a motion rule: ' + JSON.stringify(anim).slice(0, 160));
  ok(new Set(['idle-a', 'idle-b', 'idle-c', 'idle-d'].map((k) => anim[k])).size === 4, 'the four idle variants are four different motions');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => [...document.querySelectorAll('.pet [class]')].filter((n) => getComputedStyle(n).animationName !== 'none').length);
  ok(reduced === 0, 'prefers-reduced-motion: animations off (static pose)');
  await app.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
