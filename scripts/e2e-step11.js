// Privacy + pause: exact privacy text, watching dot only during a session, pause/stop clears what main holds.
const { _electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

const PRIVACY = "Questling only looks at the window you pick, only during a session. Frames are never saved to disk. Each look sends one frame of that window, its title, and (if you link a doc or use Word) the doc's text to Google Gemini; on the free tier Google may use it to improve its products. Window previews in the picker stay on this PC.";

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, QUESTLING_TEST: '1', QUESTLING_MOCK: '1', QUESTLING_FAKE_IDLE_SEC: '0', QUESTLING_LEDGER_PATH: path.join(ud, 'u.jsonl') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#bar');
  const held = () => app.evaluate(() => global.__qlState());
  await page.click('#toggle');
  ok((await page.textContent('#privacy-note')).replace(/\s+/g, ' ').trim() === PRIVACY, 'privacy text is exactly the specified wording');
  ok(await page.isHidden('#company'), 'watching dot hidden before a session');
  ok(!(await held()).hasWork, 'main holds nothing before a session');
  await page.fill('#task-text', 'my water cycle essay');
  await page.click('#make-quests');
  await page.waitForSelector('.ql-quest');
  await page.click('#start-btn');
  await page.waitForSelector('.ql-window');
  await page.click('.ql-window');
  await page.waitForSelector('#stuck-btn:not(.hidden)');
  if (await page.isVisible('.ql-card--starter')) await page.click('#card-quiet');
  ok(await page.isVisible('#company'), 'watching dot visible during a session');
  let h = await held();
  ok(h.hasWork && h.sampling, 'session: work window chosen and sampler running');
  await page.click('#stuck-btn');
  await page.waitForSelector('.ql-card--step:not(.hidden)');
  h = await held();
  ok(h.hasFrame, 'after a look main holds the last work frame in RAM');
  await page.click('#card-x');
  await page.click('#pause-btn');
  h = await held();
  ok(!h.hasFrame && !h.hasWork && !h.sampling, 'pause clears the frame, the chosen window and the sampler');
  ok(await page.isHidden('#company'), 'watching dot hidden while paused');
  await page.click('#pause-btn'); // resume
  await page.waitForSelector('#stuck-btn:not(.hidden)');
  ok((await held()).hasWork, 'resume re-picks the same window without a new dialog');
  await page.click('#toggle');
  await page.click('#end-btn');
  h = await held();
  ok(!h.hasFrame && !h.hasWork && !h.sampling, 'End session clears everything too');
  ok(await page.isHidden('#company'), 'watching dot hidden after the session');
  await app.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
