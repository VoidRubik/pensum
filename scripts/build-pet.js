// Generates pet.svg + pet.css from the Claude Design "Questling Pet Motion" study (Tuck / Kip),
// and splices BOTH pets into index.html between <!--pet:start--> and <!--pet:end-->: Tuck inline (the active pet), Kip in
// <template id="pet-kip"> (not rendered, not styled; app.js swaps them). Usage: node scripts/build-pet.js
// One run emits both, so the shared animation classes (a0..aN, deduplicated by their CSS) can never collide.
// Why a generator: the app's CSP forbids inline style="", so every animation the design inlined
// becomes a generated class here. One <g> per state, all but the active one display:none, so the
// hidden states cost nothing. No SVG filter (a blur under an animated group was the lag risk).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const INK = '#2f2b3a';
const S = 'stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"';

const rules = new Map(); // css text -> class name
const an = (name, dur, ox, oy, o = {}) => {
  const css = `transform-box:${o.fill ? 'fill-box' : 'view-box'};transform-origin:${o.fill ? '50% 50%' : ox + 'px ' + oy + 'px'};animation:${name} ${dur} ${o.ease || 'ease-in-out'} ${o.delay || '0s'} infinite;${o.vars || ''}`;
  if (!rules.has(css)) rules.set(css, 'a' + rules.size);
  return ` class="${rules.get(css)}"`;
};
const idle = (s) => `calc(${s}s / var(--speed, 1))`;

const TUCK = {
  col: { body: '#f1ead9', rim: '#958c7b' },
  body: `<path d="M60 36C74 36 84 52 90 70C97 90 90 110 60 110C30 110 23 90 30 70C36 52 46 36 60 36Z" fill="#f1ead9" stroke="#958c7b" ${S}/><ellipse cx="60" cy="94" rx="17" ry="11" fill="#b6e6d8"/><path d="M60 37C59 28 64 22 70 24C75 26 73 33 67 31" fill="none" stroke="#958c7b" stroke-width="2.6" stroke-linecap="round"/><circle cx="41" cy="79" r="4.5" fill="#d9cdf0"/><circle cx="79" cy="79" r="4.5" fill="#d9cdf0"/>`,
  eyeY: 67, eyeX: [52, 68], mouth: [57, 76], L: [34, 80], R: [86, 80], z: [84, 28],
  ground: (a = '') => `<g${a}><rect x="3" y="91" width="17" height="19" rx="2.5" fill="#d9cdf0" stroke="#8b76c4" ${S}/><path d="M8 91v19" stroke="#8b76c4" stroke-width="1.6"/></g>`,
  groundOrigin: [12, 110], reachSide: 'L',
  sil: 'M60 36C74 36 84 52 90 70C97 90 90 110 60 110C30 110 23 90 30 70C36 52 46 36 60 36Z',
  energy: { a: '#eafff6', b: '#7fd8b6', c: '#c4b3ea' },
};
const tBook = (flip) => `<path d="M34 82L60 87L86 82V102L60 107L34 102Z" fill="#d9cdf0" stroke="#8b76c4" ${S}/><path d="M37 82.5L60 87V103L37 99Z" fill="#fffdf8" stroke="#8b76c4" stroke-width="1.5" stroke-linejoin="round"/><path d="M83 82.5L60 87V103L83 99Z" fill="#fffdf8" stroke="#8b76c4" stroke-width="1.5" stroke-linejoin="round"/><path d="M41 88l15 3M41 93l15 3M64 91l15-3M64 96l15-3" stroke="#c9c2d6" stroke-width="1.4" stroke-linecap="round"/>` +
  (flip ? `<path d="M83 82.5L60 87V103L83 99Z" fill="#fffdf8" stroke="#8b76c4" stroke-width="1.5" stroke-linejoin="round"${an('q-flip', '7s', 60, 90)}/>` : '');

const KIP = {
  col: { body: '#cde0f4', rim: '#5a7fae' },
  body: `<path d="M60 48C80 48 92 58 93 72C94 82 97 90 97 97C97 106 86 110 60 110C34 110 23 106 23 97C23 90 26 82 27 72C28 58 40 48 60 48Z" fill="#cde0f4" stroke="#5a7fae" ${S}/><path d="M60 48V43" stroke="#5a7fae" stroke-width="2.4" stroke-linecap="round"/><circle cx="60" cy="39" r="5.5" fill="#bfe6e8" stroke="#4b9397" ${S}/><circle cx="38" cy="86" r="5" fill="#c9c6ef"/><circle cx="82" cy="86" r="5" fill="#c9c6ef"/>`,
  eyeY: 74, eyeX: [50, 70], mouth: [57, 83], L: [31, 82], R: [89, 82], z: [82, 36],
  ground: (a = '') => `<g${a}><g transform="rotate(14 116 106)"><rect x="110" y="86" width="6.5" height="20" rx="2" fill="#e2e8f1" stroke="#7d8ca5" stroke-width="2"/><rect x="111.6" y="88.5" width="2.6" height="15" rx="1" fill="#9fe0e8"/></g><rect x="99" y="104.5" width="20" height="5" rx="2" fill="#d3dbe7" stroke="#7d8ca5" stroke-width="2" stroke-linejoin="round"/><path d="M102 104.5h11" stroke="#9aa7bb" stroke-width="1.4" stroke-linecap="round"/></g>`,
  groundOrigin: [116, 108], reachSide: 'R',
  sil: 'M60 48C80 48 92 58 93 72C94 82 97 90 97 97C97 106 86 110 60 110C34 110 23 106 23 97C23 90 26 82 27 72C28 58 40 48 60 48Z',
  energy: { a: '#e8fdff', b: '#6fcfe0', c: '#b9b4ef' },
};
const laptop = () => `<ellipse cx="60" cy="84" rx="24" ry="10" fill="#bfe6e8" opacity=".35"${an('q-screen', '3.2s', 0, 0, { fill: 1 })}/>` +
  `<path d="M41 89h38l-2 18h-34z" fill="#e2e8f1" stroke="#7d8ca5" ${S}/><rect x="66" y="99" width="7" height="4" rx="1.5" fill="#c9c6ef"/><rect x="36" y="106" width="48" height="4.5" rx="2" fill="#d3dbe7" stroke="#7d8ca5" stroke-width="2"/>`;
const thinkDots = [0, 1, 2].map((i) => `<circle cx="${84 + i * 7}" cy="${46 - i * 5}" r="${2 + i * 0.6}" fill="#7d8ca5"${an('q-dot', '1.2s', 0, 0, { fill: 1, delay: i * 0.2 + 's' })}/>`).join('');

const compose = (P, st) => {
  const arm = (side, a, anim, extra = '') => {
    const s = P[side];
    return `<g${anim || ''}><g transform="rotate(${a} ${s[0]} ${s[1]})"><ellipse cx="${s[0]}" cy="${s[1] + 6}" rx="5.2" ry="8" fill="${P.col.body}" stroke="${P.col.rim}" ${S}/>${extra}</g></g>`;
  };
  const e = Object.assign({ type: 'open', dx: 0, dy: 0, look: '', blink: true }, st.eyes || {});
  const [x1, x2] = P.eyeX, y = P.eyeY + e.dy;
  let eyes;
  if (e.type === 'fierce') eyes = `<circle cx="${x1}" cy="${y}" r="3.6" fill="${INK}"/><circle cx="${x2}" cy="${y}" r="3.6" fill="${INK}"/><path d="M${x1 - 5} ${y - 8}l8 3M${x2 + 5} ${y - 8}l-8 3" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  else if (e.type === 'closed') eyes = `<path d="M${x1 - 4} ${y}q4 3 8 0M${x2 - 4} ${y}q4 3 8 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
  else {
    const dots = `<circle cx="${x1 + e.dx}" cy="${y}" r="3.4" fill="${INK}"/><circle cx="${x2 + e.dx}" cy="${y}" r="3.4" fill="${INK}"/>`;
    eyes = `<g${e.blink ? an('q-blink', e.blinkDur || '4.2s', 60, y) : ''}><g${e.look || ''}>${dots}</g></g>`;
  }
  const [mx, my] = P.mouth;
  const mouth = st.mouth === 'open' ? `<path d="M${mx - 3} ${my}q6 6.5 12 0z" fill="${INK}"/>`
    : st.mouth === 'rest' ? `<path d="M${mx + 1} ${my + 1}h4" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`
      : `<path d="M${mx + (e.dx || 0)} ${my}q3 2.2 6 0" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`;
  const aL = st.armL || [30], aR = st.armR || [-30];
  const armsBehind = (aL[3] ? '' : arm('L', aL[0], aL[1], aL[2])) + (aR[3] ? '' : arm('R', aR[0], aR[1], aR[2]));
  const armsFront = (aL[3] ? arm('L', aL[0], aL[1], aL[2]) : '') + (aR[3] ? arm('R', aR[0], aR[1], aR[2]) : '');
  const shadow = `<g${st.shadow || ''}><ellipse cx="60" cy="112" rx="28" ry="3.5" fill="#000" opacity=".16"/></g>`;
  const ground = st.noGround ? '' : P.ground(st.groundAnim || '');
  const glowBody = st.power ? `<path d="${P.sil}" fill="#fff" opacity="0"${an('q-glowBody', '3.6s', 0, 0)}/>` : '';
  let inner = armsBehind + P.body + glowBody + eyes + mouth + (st.held || '') + armsFront;
  if (st.wrap) inner = `<g transform="${st.wrap}">${inner}</g>`;
  const root = `<g${st.root || ''}>${inner}</g>`;
  let auraFx = '', frontFx = '';
  if (st.power) {
    const E = P.energy;
    // The design blurs the aura with an SVG filter (repaints every frame); a static radial gradient gives the same soft edge, animated by opacity only.
    const gid = `qglow-${E.b.slice(1)}`;
    auraFx = `<defs><radialGradient id="${gid}"><stop offset=".45" stop-color="${E.b}" stop-opacity=".5"/><stop offset="1" stop-color="${E.b}" stop-opacity="0"/></radialGradient></defs>` +
      `<g${an('q-aura', '3.6s', 60, 112)}><ellipse cx="60" cy="68" rx="66" ry="64" fill="url(#${gid})"/><g${an('q-flicker', '.36s', 60, 112)}>` +
      `<path d="M60 2C70 22 80 20 86 10C88 30 108 52 108 82C108 106 88 118 60 118C32 118 12 106 12 82C12 52 32 30 34 10C40 20 50 22 60 2Z" fill="${E.b}" opacity=".55"/>` +
      `<path d="M60 16C68 32 76 30 80 22C82 40 98 58 98 84C98 104 82 112 60 112C38 112 22 104 22 84C22 58 38 40 40 22C44 30 52 32 60 16Z" fill="${E.a}" opacity=".85"/></g></g>` +
      `<g${an('q-shock', '3.6s', 60, 112)}><ellipse cx="60" cy="112" rx="34" ry="6" fill="none" stroke="${E.b}" stroke-width="2.5"/></g>`;
    const rays = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4 + 0.39, c = Math.cos(a), s = Math.sin(a);
      return `<line x1="${(60 + c * 50).toFixed(1)}" y1="${(66 + s * 50).toFixed(1)}" x2="${(60 + c * 58).toFixed(1)}" y2="${(66 + s * 58).toFixed(1)}" stroke="${E.b}" stroke-width="2.4" stroke-linecap="round"/>`; }).join('');
    const parts = [[22, 104], [36, 96], [50, 108], [70, 100], [84, 106], [98, 94]].map(([px, py], i) =>
      `<circle cx="${px}" cy="${py}" r="${i % 2 ? 2 : 2.8}" fill="${i % 2 ? E.c : E.b}"${an('q-rise', '1.2s', 0, 0, { fill: 1, delay: (i * 0.2).toFixed(1) + 's', ease: 'ease-out' })}/>`).join('');
    const crackle = `<path d="M12 62l6 4-4 3 7 5" fill="none" stroke="${E.b}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"${an('q-crackle', '.6s', 0, 0, { fill: 1 })}/><path d="M108 58l-6 4 4 3-7 5" fill="none" stroke="${E.b}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"${an('q-crackle', '.6s', 0, 0, { fill: 1, delay: '.25s' })}/>`;
    frontFx = `<g${an('q-rays', '3.6s', 60, 66)}>${rays}</g><g${an('q-env', '3.6s', 0, 0)}>${crackle}${parts}</g>`;
  }
  const z = st.z ? [0, 1].map((i) => `<g transform="translate(${P.z[0] + i * 8} ${P.z[1] - i * 8}) scale(${i ? 0.75 : 1})"><path d="M0 0h7l-7 8h7" fill="none" stroke="#8a84a0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"${an('q-z', '3s', 0, 0, { fill: 1, delay: i * 1.5 + 's' })}/></g>`).join('') : '';
  const fx = (s) => (s ? `<g class="fx">${s}</g>` : '');
  return fx(auraFx) + shadow + ground + root + z + fx(frontFx);
};

const shared = (P) => {
  const reach = P.reachSide === 'L'
    ? { armL: [30, an('q-reachL', idle(4.5), P.L[0], P.L[1])], eyes: { dx: -3, dy: 2 } }
    : { armR: [-30, an('q-reachR', idle(4.5), P.R[0], P.R[1])], eyes: { dx: 3, dy: 2 } };
  return {
    idle_a: { root: an('q-breathe', idle(4), 60, 110), eyes: { look: an('q-look', idle(7), 0, 0) } },
    idle_b: { root: an('q-stretch', idle(5), 60, 110), armL: [30, an('q-armUpL', idle(5), P.L[0], P.L[1])], armR: [-30, an('q-armUpR', idle(5), P.R[0], P.R[1])], eyes: { blinkDur: '5s' } },
    idle_c: { root: an('q-hop', idle(3.4), 60, 110), shadow: an('q-shadowHop', idle(3.4), 60, 112) },
    idle_d: Object.assign({ root: an('q-breathe', idle(4.5), 60, 110), groundAnim: an('q-fiddle', idle(4.5), P.groundOrigin[0], P.groundOrigin[1]) }, reach),
    curious: { root: an('q-tilt', '2.4s', 60, 110), eyes: { dx: 2.5, dy: -2 }, armR: [-70, '', '', 1] },
    helper: { root: an('q-nudge', '1.6s', 60, 110), eyes: { dx: 2.5, dy: -2.5 }, armR: [-150, an('q-point', '1.6s', P.R[0], P.R[1]), '', 1] },
    sleepy: { root: an('q-sleep', '4s', 60, 110), wrap: 'rotate(-4 60 110)', eyes: { type: 'closed', dy: 2 }, mouth: 'rest', armL: [20], armR: [-20] },
    celebrate: { power: 1, root: an('q-pRoot', '3.6s', 60, 110), shadow: an('q-shadowPower', '3.6s', 60, 112), eyes: { type: 'fierce' }, mouth: 'open', noGround: true, armL: [38], armR: [-38] },
    asleep: { root: an('q-sleep', '5s', 60, 110), wrap: 'translate(60 110) scale(1.06 0.9) translate(-60 -110)', eyes: { type: 'closed', dy: 2 }, mouth: 'rest', armL: [15], armR: [-15], z: true },
  };
};

const STATES = {
  tuck: Object.assign(shared(TUCK), {
    working: { root: an('q-bob', '6.5s', 60, 110), eyes: { dy: 3, look: an('q-scan', '6s', 0, 0), blinkDur: '5.5s' }, noGround: true, held: tBook(true), armL: [-20, '', '', 1], armR: [20, '', '', 1] },
    thinking: { root: an('q-sway', '3s', 60, 110), eyes: { dx: -2.5, dy: -2.5 }, armR: [101, an('q-tap', '2.4s', TUCK.R[0], TUCK.R[1]), '', 1] },
  }),
  kip: Object.assign(shared(KIP), {
    working: { root: an('q-bob', '6.5s', 60, 110), eyes: { dy: 3, blinkDur: '5s' }, mouth: 'rest', noGround: true, held: laptop(),
      armL: [-35, an('q-typeL', '1.3s', KIP.L[0], KIP.L[1]), '', 1], armR: [35, an('q-typeR', '1.3s', KIP.R[0], KIP.R[1], { delay: '.35s' }), '', 1] },
    thinking: { root: an('q-sway', '3s', 60, 110), eyes: { dx: -2.5, dy: -2.5 }, noGround: true, held: laptop() + thinkDots,
      armL: [-35, '', '', 1], armR: [100, an('q-tap', '2.4s', KIP.R[0], KIP.R[1]), '', 1] },
  }),
};

const svgOf = (name, P) => {
  const groups = Object.entries(STATES[name]).map(([k, st]) => `<g class="ps ps-${k}">${compose(P, st)}</g>`).join('\n');
  return `<svg class="pet" data-pet="${name}" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
${groups}
</svg>`;
};
const tuck = svgOf('tuck', TUCK);
const kip = svgOf('kip', KIP);

const KEYFRAMES = `@keyframes q-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,.975)}}
@keyframes q-look{0%,14%{transform:translateX(0)}24%,44%{transform:translateX(-3px)}54%,74%{transform:translateX(2.5px)}84%,100%{transform:translateX(0)}}
@keyframes q-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes q-stretch{0%,18%{transform:scale(1,1)}36%,54%{transform:scale(.95,1.1)}66%{transform:scale(1.05,.95)}76%,100%{transform:scale(1,1)}}
@keyframes q-armUpL{0%,18%{transform:rotate(0)}36%,54%{transform:rotate(115deg)}70%,100%{transform:rotate(0)}}
@keyframes q-armUpR{0%,18%{transform:rotate(0)}36%,54%{transform:rotate(-115deg)}70%,100%{transform:rotate(0)}}
@keyframes q-hop{0%,46%{transform:translateY(0) scale(1,1)}54%{transform:translateY(0) scale(1.08,.9)}66%{transform:translateY(-10px) scale(.94,1.07)}77%{transform:translateY(0) scale(1.08,.92)}85%{transform:translateY(0) scale(.98,1.02)}92%,100%{transform:translateY(0) scale(1,1)}}
@keyframes q-shadowHop{0%,54%,77%,100%{transform:scale(1);opacity:1}66%{transform:scale(.72);opacity:.6}}
@keyframes q-fiddle{0%,28%{transform:rotate(0)}40%{transform:rotate(-10deg)}52%{transform:rotate(7deg)}62%{transform:rotate(-4deg)}70%,100%{transform:rotate(0)}}
@keyframes q-reachL{0%,26%{transform:rotate(0)}38%,62%{transform:rotate(14deg)}72%,100%{transform:rotate(0)}}
@keyframes q-reachR{0%,26%{transform:rotate(0)}38%,62%{transform:rotate(-14deg)}72%,100%{transform:rotate(0)}}
@keyframes q-bob{0%,100%{transform:translateY(0)}28%{transform:translateY(-1.4px)}52%{transform:translateY(0)}68%{transform:translateY(-.7px)}82%{transform:translateY(0)}}
@keyframes q-scan{0%{transform:translateX(-2.5px)}28%{transform:translateX(2.5px)}32%{transform:translateX(-2.5px)}60%{transform:translateX(2.5px)}64%,100%{transform:translateX(-2.5px)}}
@keyframes q-flip{0%,76%{transform:scaleX(1);opacity:0}78%{transform:scaleX(1);opacity:1}90%{transform:scaleX(-1);opacity:1}93%,100%{transform:scaleX(-1);opacity:0}}
@keyframes q-tilt{0%,100%{transform:rotate(6deg) translateY(0)}45%{transform:rotate(8deg) translateY(-2.5px)}60%{transform:rotate(7.5deg) translateY(-1.5px)}}
@keyframes q-sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
@keyframes q-tap{0%,40%,100%{transform:rotate(0)}48%{transform:rotate(-9deg)}56%{transform:rotate(0)}64%{transform:rotate(-9deg)}72%{transform:rotate(0)}}
@keyframes q-nudge{0%,100%{transform:translateY(0)}35%{transform:translateY(-3.5px)}50%{transform:translateY(-2.5px)}}
@keyframes q-point{0%,100%{transform:rotate(0)}35%{transform:rotate(-10deg)}50%{transform:rotate(-7deg)}}
@keyframes q-sleep{0%,100%{transform:scale(1,1)}50%{transform:scale(1.03,.97)}}
@keyframes q-typeL{0%,100%{transform:rotate(0)}10%{transform:rotate(-7deg)}20%{transform:rotate(0)}30%{transform:rotate(-6deg)}40%,62%{transform:rotate(0)}72%{transform:rotate(-7deg)}82%{transform:rotate(0)}}
@keyframes q-typeR{0%,100%{transform:rotate(0)}10%{transform:rotate(7deg)}20%{transform:rotate(0)}30%{transform:rotate(6deg)}40%,62%{transform:rotate(0)}72%{transform:rotate(7deg)}82%{transform:rotate(0)}}
@keyframes q-screen{0%,100%{opacity:.25}40%{opacity:.5}70%{opacity:.3}}
@keyframes q-dot{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
@keyframes q-pRoot{0%{transform:translate(0,0) scale(1,1)}8%{transform:translate(0,0) scale(1.08,.9)}12%{transform:translate(-.8px,0) scale(1.08,.9)}16%{transform:translate(.8px,0) scale(1.09,.89)}20%{transform:translate(-.8px,0) scale(1.09,.89)}24%{transform:translate(0,0) scale(1.1,.88)}32%{transform:translate(0,-8px) scale(.93,1.1)}40%,76%{transform:translate(0,-6px) scale(1.03,1.03)}58%{transform:translate(0,-9px) scale(1.03,1.03)}88%{transform:translate(0,0) scale(1.06,.94)}95%,100%{transform:translate(0,0) scale(1,1)}}
@keyframes q-shadowPower{0%,24%,92%,100%{transform:scale(1);opacity:1}34%,82%{transform:scale(.75);opacity:.6}}
@keyframes q-aura{0%,20%{opacity:0;transform:scale(.5)}32%{opacity:1;transform:scale(1.15)}40%,80%{opacity:.95;transform:scale(1)}94%,100%{opacity:0;transform:scale(1.1)}}
@keyframes q-flicker{0%,100%{transform:scale(1,1)}50%{transform:scale(.96,1.08)}}
@keyframes q-env{0%,26%{opacity:0}34%,82%{opacity:1}94%,100%{opacity:0}}
@keyframes q-rise{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-40px);opacity:0}}
@keyframes q-crackle{0%,100%{opacity:0}10%,30%{opacity:1}40%{opacity:0}60%,70%{opacity:1}}
@keyframes q-shock{0%,28%{opacity:0;transform:scale(.3)}32%{opacity:1;transform:scale(.6)}62%,100%{opacity:0;transform:scale(1.9)}}
@keyframes q-rays{0%,28%{opacity:0;transform:scale(.6)}34%{opacity:1;transform:scale(1)}50%,100%{opacity:0;transform:scale(1.3)}}
@keyframes q-glowBody{0%,24%{opacity:0}34%{opacity:.6}42%,80%{opacity:.3}94%,100%{opacity:0}}
@keyframes q-z{0%{opacity:0;transform:translate(0,0) scale(.7)}25%{opacity:.9}80%{opacity:0;transform:translate(8px,-18px) scale(1.15)}100%{opacity:0;transform:translate(8px,-18px)}}`;

// Selectors follow the DESIGN_PROMPT contract: the data attributes pick which state group shows.
const show = [['idle', 'a'], ['idle', 'b'], ['idle', 'c'], ['idle', 'd']]
  .map(([s, v]) => `main[data-pet-state="${s}"][data-idle="${v}"] .ps-idle_${v}`)
  .concat(['working', 'curious', 'thinking', 'helper', 'celebrate', 'sleepy', 'asleep'].map((s) => `main[data-pet-state="${s}"] .ps-${s}`));

const css = `/* GENERATED by scripts/build-pet.js (tuck + kip) from the Claude Design motion study. Do not edit by hand. */
${KEYFRAMES}
.ps { display: none; }
${show.join(',\n')} { display: inline; }
${[...rules].map(([c, n]) => `.${n}{${c}}`).join('\n')}
/* Reduced motion: static pose, no energy effects. */
@media (prefers-reduced-motion: reduce) {
  .pet [class] { animation: none !important; }
  .pet .fx { display: none; }
}
`;

fs.writeFileSync(path.join(root, 'pet.svg'), tuck + '\n');
fs.writeFileSync(path.join(root, 'pet-kip.svg'), kip + '\n');
fs.writeFileSync(path.join(root, 'pet.css'), css);
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const MARK = /<!--pet:start-->[\s\S]*?<!--pet:end-->/;
if (!MARK.test(html)) { console.error('index.html: no <!--pet:start-->...<!--pet:end--> block to replace'); process.exit(1); }
fs.writeFileSync(htmlPath, html.replace(MARK, () => `<!--pet:start-->\n${tuck}\n<template id="pet-kip">${kip}</template>\n<!--pet:end-->`));
console.log(`pets: ${rules.size} animation classes, tuck ${tuck.length} B, kip ${kip.length} B, css ${css.length} B`);
