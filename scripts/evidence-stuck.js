// Opens its OWN staged essay in Notepad, picks that window through the app's IPC, runs 5 real stuck looks.
const { _electron } = require('playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const Q = require('node:path').resolve(__dirname, '..').split(require('node:path').sep).join('/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const txt = path.join(os.tmpdir(), 'ql-evidence-essay.txt');
  fs.writeFileSync(txt, 'Water Cycle Essay\r\n\r\nIntroduction\r\nThe water cycle is how water moves between the ocean, the sky and the land.\r\n\r\nCauses\r\n\r\n\r\nEffects\r\n\r\n');
  const np = spawn('notepad.exe', [txt]); await sleep(2500);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-ud-'));
  const env = { ...process.env, PENSUM_LEDGER_PATH: path.join(ud, 'usage.jsonl') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.PENSUM_MOCK; delete env.PENSUM_TEST;
  const app = await _electron.launch({ executablePath: Q + '/node_modules/electron/dist/electron.exe', args: [Q, '--user-data-dir=' + ud], env });
  const page = await app.firstWindow();
  await page.waitForSelector('#bar');
  const info = await page.evaluate(() => window.pensum.info());
  const picked = await page.evaluate(async () => {
    const w = (await window.pensum.listWindows()).find((x) => x.title.includes('ql-evidence-essay'));
    if (!w) return { ok: false };
    const r = await window.pensum.pickWindow(w.id);
    return { ...r, title: w.title };
  });
  console.log('mock?', info.mock, 'picked:', JSON.stringify(picked));
  const out = [];
  if (picked.ok && !info.mock) {
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const r = await page.evaluate(() => window.pensum.look({ purpose: 'stuck', idx: 2, epoch: 1,
        quest: { title: 'Write the Causes section', finish: 'Three sentences exist under the Causes heading' },
        ctx: { task: 'my water cycle essay', quests: [{ title: 'Write the introduction', done: true }, { title: 'Write the Causes section', done: false }, { title: 'Write the Effects section', done: false }] }, allow: [] }));
      out.push({ try: i + 1, wallMs: Date.now() - t0, ...r });
      await sleep(1500);
    }
    fs.mkdirSync(Q + '/evidence', { recursive: true });
    fs.writeFileSync(Q + '/evidence/stuck-5.json', JSON.stringify(out, null, 1));
    for (const o of out) console.log(`${o.try} | ${o.wallMs}ms | ${o.error ? 'ERROR ' + JSON.stringify(o) : o.nextStep + ' || ' + o.evidence + ' || conf ' + o.confidence}`);
  }
  await app.close();
  try { execFileSync('taskkill', ['/F', '/IM', 'notepad.exe']); } catch {}
})().catch((e) => { console.error(e); process.exit(2); });
