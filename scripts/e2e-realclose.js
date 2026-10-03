// B10: a REAL window close, end to end (real desktopCapturer + the PowerShell tracker, mock model: $0).
// Starts Notepad, picks it in the window picker, kills it, and expects the pet asleep + "Pick window again" within 5 s.
// Windows only. Kills every notepad.exe first (and at the end), so close your Notepad windows before running it.
const { _electron } = require('playwright-core');
const { execSync, spawn } = require('node:child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killNotepad = () => { try { execSync('taskkill /im notepad.exe /f', { stdio: 'ignore' }); } catch {} };

(async () => {
  killNotepad();
  await sleep(500);
  spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
  await sleep(2000);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, PENSUM_MOCK: '1', PENSUM_FAKE_IDLE_SEC: '0', PENSUM_LEDGER_PATH: path.join(ud, 'u.jsonl') };
  delete env.PENSUM_TEST;
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#bar');
    await page.click('#toggle');
    await page.fill('#task-text', 'a note in Notepad');
    await page.click('#make-quests');
    await page.waitForSelector('.ql-quest', { timeout: 20000 });
    await page.click('#start-btn');
    await page.waitForSelector('.ql-window', { timeout: 60000 });
    const notepad = page.locator('.ql-window', { hasText: /Notepad|Bloc de notas/i }).first();
    ok(await notepad.count() > 0, 'the picker lists the Notepad window');
    await notepad.click();
    await page.click('#windows-start');
    await page.waitForSelector('#stuck-btn:not(.hidden)', { timeout: 60000 });
    await sleep(3000); // let the tracker settle on the real window
    ok(await page.getAttribute('main', 'data-pet-state') !== 'asleep', 'with Notepad open the pet is awake: ' + await page.getAttribute('main', 'data-pet-state'));
    killNotepad();
    const t0 = Date.now();
    await page.waitForFunction(() => document.querySelector('main').dataset.petState === 'asleep', null, { timeout: 5000 }).catch(() => {});
    ok(await page.getAttribute('main', 'data-pet-state') === 'asleep', `closing Notepad -> asleep within 5 s (${Date.now() - t0} ms)`);
    ok(await page.isVisible('#repick'), '"Pick window again" is shown');
  } finally {
    await app.close();
    killNotepad();
  }
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); killNotepad(); process.exit(2); });
