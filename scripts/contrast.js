// WCAG contrast of the real token pairs in ui.css, both themes. Exit 1 if any pair is under its threshold.
// Text (and text-sized glyphs) need 4.5:1; fills/rings/icons/large shapes need 3:1.
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'ui.css'), 'utf8');
const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('html, body {'));
const tokens = (block) => Object.fromEntries([...block.matchAll(/--ql-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// [foreground token, background token, minimum, where it is used]
const PAIRS = [
  ['ink', 'surface', 4.5, 'body text, titles'],
  ['muted', 'surface', 4.5, 'secondary text, placeholders, quest finish line'],
  ['accent-text', 'surface', 4.5, 'tags, links, current quest number'],
  ['accent-ink', 'accent', 4.5, 'primary button label, done check'],
  ['fill', 'surface', 3, 'rings, progress, fit meter, done badges (graphics)'],
  ['fill', 'surface-2', 3, 'a fill against its own track'],
  ['on-fill', 'fill', 3, 'check mark on a done badge (glyph, 3:1)'],
  ['attention', 'surface', 3, 'fit meter when short'],
];
let bad = 0;
for (const [name, block] of [['light (2a)', light], ['dark (2b)', dark]]) {
  const t = { ...tokens(light), ...tokens(block) };
  console.log(name);
  for (const [f, b, min, use] of PAIRS) {
    const r = ratio(t[f], t[b]);
    const ok = r >= min;
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${r.toFixed(2)}:1 (min ${min}) ${f} ${t[f]} on ${b} ${t[b]}  ${use}`);
  }
}
process.exit(bad ? 1 : 0);
