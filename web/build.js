// Vercel build: copy ONLY the public renderer into public/ (the repo also holds main.js, .env-adjacent
// files, DECISIONS.md, evidence/ ... none of which may be served). Required files must exist.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
const REQUIRED = ['index.html', 'style.css', 'app.js', 'logic.js', 'web', 'demo/samples', 'demo/recorded.json'];
const OPTIONAL = ['pet.css', 'ui.css']; // Claude Design assets, added when they land

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const rel of [...REQUIRED, ...OPTIONAL]) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) {
    if (REQUIRED.includes(rel)) { console.error(`build: missing required ${rel}`); process.exit(1); }
    continue;
  }
  const dst = path.join(out, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, filter: (p) => !/build\.js$/.test(p) });
}
console.log('build: public/ =', fs.readdirSync(out).join(', '));
