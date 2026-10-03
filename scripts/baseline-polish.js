// Polish gates, measured in the real Electron window (mock, this machine, rAF deltas - not a compositor capture):
//   Flat first panel open = 0 frames > 20 ms (Soft is printed next to it), celebrate rAF p95 <= 17 ms with 0 frames > 33 ms.
// Usage: node scripts/baseline-polish.js   (needs playwright-core on NODE_PATH; leave the PC idle while it runs)
const { launch, reach, frames, stats, sleep } = require('./ui-drive.js');

(async () => {
  const out = { firstOpen: { soft: [], flat: [] }, celebrate: [] };
  for (let i = 0; i < 4; i++) {
    for (const mode of ['soft', 'flat']) {
      const h = await launch({ env: { QUESTLING_MOCK_DELAY_MS: '0' } });
      if (mode === 'flat') await h.page.evaluate(() => { document.querySelector('main').dataset.shadows = 'flat'; });
      await sleep(400);
      const p = frames(h.page, 900);
      await reach.ask(h);
      out.firstOpen[mode].push(stats(await p));
      if (mode === 'soft') {
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
    celebrate: { worstP95: worst(out.celebrate, 'p95'), worstMax: worst(out.celebrate, 'max'), runs: out.celebrate },
  };
  console.log(JSON.stringify(res, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
