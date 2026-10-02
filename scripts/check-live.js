// DoD #1 against any deployment: node scripts/check-live.js <baseUrl>
//   - non-public files are not served (404)
//   - no API key pattern in any served static file
//   - the model route answers 429 once a client hammers it (invalid requests count)
// Note: the limiter is per warm instance, so on Vercel the 429 can take a few more requests than locally.
const BASE = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

const KEY = /AIza[0-9A-Za-z_-]{20}|AQ\.[A-Za-z0-9_-]{20}|GEMINI_API_KEY\s*=\s*\S+/;
const NOT_PUBLIC = ['main.js', 'ai.js', 'gemini.js', 'capture.js', 'focus.js', 'artifact.js', 'ledger.js', 'look-flow.js', 'preload.js', 'PROJECT.md', 'DECISIONS.md', 'DESIGN_PROMPT.md', 'evidence/stuck-5.json', 'evidence/injection.json', 'package.json', 'package-lock.json', 'vercel.json', '.env', '.git/config', 'api/model.js', 'scripts/dev-server.js', 'test/logic.test.js'];

(async () => {
  for (const f of NOT_PUBLIC) {
    const r = await fetch(`${BASE}/${f}`, { redirect: 'manual' });
    const body = r.status === 200 ? await r.text() : '';
    // an SPA-style fallback to index.html would be a 200 with the page: that is not the file either
    const isRealFile = r.status === 200 && !/<title>Questling<\/title>/.test(body);
    ok(r.status !== 200 || !isRealFile, `/${f} is not served (${r.status})`);
  }

  // every static file the page references, plus the page itself
  const index = await (await fetch(`${BASE}/`)).text();
  const files = ['index.html', 'style.css', 'app.js', 'logic.js', 'web/shim.js', 'web/web.css', 'demo/recorded.json'];
  let leaked = [];
  for (const f of files) {
    const t = await (await fetch(`${BASE}/${f}`)).text();
    if (KEY.test(t)) leaked.push(f);
  }
  ok(/<title>Questling<\/title>/.test(index), 'the page is served');
  ok(leaked.length === 0, `no key pattern in ${files.length} served static files ${leaked.join(',')}`);
  ok(/connect-src 'self'/.test(index), "CSP carries connect-src 'self'");

  // hammer the route with invalid requests
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch(`${BASE}/api/model`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'garbage' }) });
    codes.push(r.status);
  }
  const first429 = codes.indexOf(429) + 1;
  console.log('     route statuses:', codes.join(' '));
  ok(first429 > 0 && first429 <= 12, `route answers 429 under hammering (first 429 on request ${first429})`);
  ok(codes.slice(0, Math.max(0, first429 - 1)).every((c) => c === 400), 'requests before the limit are plain 400s (nothing reached the model)');

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
