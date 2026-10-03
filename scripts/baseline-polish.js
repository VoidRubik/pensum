// Polish gates, measured in the real Electron window (mock, this machine, rAF deltas - not a compositor capture):
//   Flat first panel open = 0 frames > 20 ms (Soft is printed next to it); celebrate no slower than idle in the same run
//   (p95 <= idle p95 + 1 ms: this PC's frame period drifts between 16.7 and 18.2 ms, so a fixed 17 ms gate measures the monitor) with 0 frames > 33 ms.
// Writes evidence/ui-v2/baseline-polish-gates.json and exits 1 if a gate fails.
// Usage: node scripts/baseline-polish.js   (needs playwright-core on NODE_PATH; leave the PC idle while it runs)
const fs = require('node:fs'), path = require('node:path');
const { launch, reach, frames, stats, sleep } = require('./ui-drive.js');

(async () => {
  const out = { firstOpen: { soft: [], flat: [] }, celebrate: [], idle: [] };
  for (let i = 0; i < 4; i++) {
    for (const mode of ['soft', 'flat']) {
      const h = await launch({ env: { QUESTLING_MOCK_DELAY_MS: '0' } });
      if (mode === 'flat') await h.page.evaluate(() => { document.querySelector('main').dataset.shadows = 'flat'; });
      await sleep(400);
      const p = frames(h.page, 900);
      await reach.ask(h);
      out.firstOpen[mode].push(stats(await p));
      if (mode === 'soft') {
        await sleep(300);
        out.idle.push(stats(await frames(h.page, 1500)));
        await h.page.evaluate(() => { document.querySelector('main').dataset.petState = 'celebrate'; });
        await sleep(200);
        out.celebrate.push(stats(await frames(h.page, 1500)));
      }
      await h.close();
    }
  }
  const sum = (a, k) => a.map((s) => s[k]);
  const worst = (a, k) => Math.max(...sum(a, k));
  const res = {
    flatFirstOpen: { runs: out.firstOpen.flat.length, totalOver20ms: out.firstOpen.flat.reduce((n, s) => n + s.over20ms, 0), worstMax: worst(out.firstOpen.flat, 'max') },
    softFirstOpen: { runs: out.firstOpen.soft.length, totalOver20ms: out.firstOpen.soft.reduce((n, s) => n + s.over20ms, 0), worstMax: worst(out.firstOpen.soft, 'max') },
    idle: { worstP95: worst(out.idle, 'p95'), worstMax: worst(out.idle, 'max') },
    celebrate: { worstP95: worst(out.celebrate, 'p95'), worstMax: worst(out.celebrate, 'max'), runs: out.celebrate },
  };
  res.gates = {
    flatNoLongFrames: res.flatFirstOpen.totalOver20ms === 0,
    celebrateNoSlowerThanIdle: res.celebrate.worstP95 <= res.idle.worstP95 + 1,
    celebrateNoFrameOver33ms: res.celebrate.worstMax <= 33,
  };
  res.when = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, '..', 'evidence', 'ui-v2', 'baseline-polish-gates.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, celebrate: { worstP95: res.celebrate.worstP95, worstMax: res.celebrate.worstMax } }, null, 1));
  process.exit(Object.values(res.gates).every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
