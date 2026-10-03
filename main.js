const fs = require('node:fs');
const path = require('node:path');
const { app, net, BrowserWindow, ipcMain, screen, powerMonitor, dialog, Tray, Menu, nativeImage, nativeTheme, session } = require('electron');

// One-time move from the old app name: copy settings + a user's own key; never overwrite.
// Only for the real profile: e2e runs pass --user-data-dir (a temp dir) and must never inherit the old settings.
if (path.dirname(app.getPath('userData')) === app.getPath('appData') && /^pensum$/i.test(path.basename(app.getPath('userData')))) {
  const oldDir = path.join(app.getPath('appData'), 'questling');
  const newDir = app.getPath('userData');
  for (const f of ['settings.json', '.env']) {
    const from = path.join(oldDir, f), to = path.join(newDir, f);
    try { if (fs.existsSync(from) && !fs.existsSync(to)) { fs.mkdirSync(newDir, { recursive: true }); fs.copyFileSync(from, to); } } catch {}
  }
}

// Key sources, first one wins (an already-set variable is never overridden): the real environment, the repo .env (dev),
// then <userData>/.env (%APPDATA%/pensum/.env: where a packaged build reads a user's own key; never bundled).
for (const dir of [__dirname, app.getPath('userData')]) { try { process.loadEnvFile(path.join(dir, '.env')); } catch {} }
const ai = require('./ai.js');
const remote = require('./remote.js');
const ledger = require('./ledger.js');
const focus = require('./focus.js');
const artifact = require('./artifact.js');
const capture = require('./capture.js');
const { lookFlow } = require('./look-flow.js');
const L = require('./logic.js');

L.setTimeScale(Number(process.env.PENSUM_TIME_SCALE) || 1);
const TEST = !!process.env.PENSUM_TEST && !app.isPackaged; // test hooks never run in the packaged exe

const WIDTH = 404; // v2 artboard: 16 px window padding + 372 px of content
const BAR_H = 128; // bar 66 + 2x16 padding + pet headroom (the art overflows the pill by ~25 px; celebrate jumps ~18 more)
const MAX_H = 780; // bar + panel + bubble + card; also clamped to the work area
const SAMPLE_MS = 15000; // change-detection sampler (spike 0a: capture 100-430 ms)
const CHANGED_T = 0.004; // fraction of pixels moved > 24/255; one typed line measured 5-6 %, idle noise 0 %
const SETTLE_MS = 3000; // ignore diffs right after a foreground change (title-bar recolour is not work)

let win = null;
let tray = null;

// --- placement: anchor { cx, y, dock } + size -> bounds (pure rules in logic.js) ---
// The transparent window is click-through except over the bar / bubble / panel (renderer toggles via set-click-through).
let settings = { anchor: null, size: 'M', theme: 'system', linked: [], capture: 'hidden' }; // settings.json in userData; loaded once the app is ready
let lastCssH = BAR_H; // the renderer reports its content height in CSS px
const zoom = () => L.SIZES[settings.size];
const curAnchor = () => settings.anchor || L.defaultAnchor(screen.getPrimaryDisplay().workArea);
const waFor = (a) => screen.getDisplayNearestPoint(L.anchorProbe(a)).workArea;

function geom() {
  const a = curAnchor();
  return { dock: a.dock, maxH: Math.min(MAX_H, (waFor(a).height - 24) / zoom()) };
}
function place(cssH = lastCssH) {
  if (!win || win.isDestroyed()) return;
  lastCssH = cssH;
  const z = zoom();
  const a = curAnchor();
  const wa = waFor(a);
  const h = Math.max(Math.ceil(BAR_H * z), Math.min(Math.ceil(MAX_H * z), wa.height - 24, Math.ceil(cssH * z)));
  const b = L.placeWindow({ anchor: a, w: Math.ceil(WIDTH * z), h, wa });
  win.setBounds({ x: b.x, y: b.y, width: b.w, height: b.h });
  win.webContents.send('geom', geom());
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch {}
  settings = L.sanitizeSettings(raw, screen.getAllDisplays().map((d) => d.workArea));
}
function saveSettings() {
  try {
    const tmp = settingsFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings));
    fs.renameSync(tmp, settingsFile());
  } catch {} // a failed save only loses the preference
}

// --- drag: the window is click-through, so an OS drag region would eat clicks. The renderer says when a drag starts,
// main follows the cursor with a fixed width/height (plain setPosition drifts the size across mixed-DPI monitors). ---
let drag = null; // { timer, kill, offX, offY, w, h, start }
function dragEnd(cancel) {
  if (!drag) return;
  clearInterval(drag.timer);
  clearTimeout(drag.kill);
  if (!win || win.isDestroyed()) { drag = null; return; }
  if (cancel === true) { // Escape: back to where the drag started
    const s = drag.start;
    drag = null;
    win.setBounds(s);
    win.setIgnoreMouseEvents(false);
    place();
    return;
  }
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  drag = null;
  const dock = L.dockFor(c.y, screen.getDisplayNearestPoint(c).workArea);
  const raw = L.anchorFrom({ x: b.x, y: b.y, w: b.width, h: b.height }, dock);
  if (dock !== curAnchor().dock) raw.y = L.dropAnchorY(dock, c.y, zoom()); // the layout flips: keep the bar under the cursor
  const placed = L.placeWindow({ anchor: raw, w: b.width, h: b.height, wa: waFor(raw) });
  settings.anchor = L.anchorFrom({ x: placed.x, y: placed.y, w: placed.w, h: placed.h }, dock);
  saveSettings();
  win.setIgnoreMouseEvents(false); // until the next mousemove decides
  place();
}
ipcMain.on('drag-start', () => {
  if (drag || !win) return;
  const c = screen.getCursorScreenPoint();
  const b = win.getBounds();
  win.setIgnoreMouseEvents(false);
  drag = {
    offX: c.x - b.x, offY: c.y - b.y, w: b.width, h: b.height, start: b,
    timer: setInterval(() => {
      const p = screen.getCursorScreenPoint();
      win.setBounds({ x: p.x - drag.offX, y: p.y - drag.offY, width: drag.w, height: drag.h });
    }, 16),
    kill: setTimeout(() => dragEnd(), 30000),
  };
});
ipcMain.on('drag-end', (_e, cancel) => dragEnd(cancel));

// Tray "Hide from screen recordings": on = setContentProtection(true), off = the overlay shows up in OBS / screenshots.
// Gemini frames are unaffected either way: they come from the window the user picked (capture.grabWindow), never the overlay.
let lastProtect = null; // test only
function applyCapture() {
  lastProtect = settings.capture === 'hidden';
  if (win && !win.isDestroyed()) win.setContentProtection(lastProtect);
}
function setCapture(hidden) {
  settings.capture = hidden ? 'hidden' : 'visible';
  saveSettings();
  applyCapture();
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: BAR_H,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The window only ever shows index.html: no navigation away (a reload of the same URL is fine), no pop-ups.
  win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.setAlwaysOnTop(true, 'screen-saver');
  applyCapture(); // default: keeps the pet out of any screenshot / recording. (Playwright/CDP page.screenshot is unaffected.)
  Menu.setApplicationMenu(null); // no Ctrl+/- menu zoom: size is the S/M/L switch and Ctrl+wheel
  place(BAR_H);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.on('did-finish-load', () => { win.webContents.setZoomFactor(zoom()); place(); });
  win.webContents.on('zoom-changed', (_e, dir) => setSize(L.stepSize(settings.size, dir)));
  for (const ev of ['blur', 'hide', 'closed']) win.on(ev, () => dragEnd());
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.showInactive());
}

function trayIcon() {
  const s = 16;
  const buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 56) buf.set([0x9e, 0xb9, 0x6f, 0xff], i); // BGRA mint
    }
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

function resetPosition() { settings.anchor = null; saveSettings(); place(); }

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Pensum');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide', click: () => (win.isVisible() ? win.hide() : win.showInactive()) },
    { label: 'Pause', click: () => { stopSession(); win.webContents.send('paused'); } },
    { label: 'Hide from screen recordings', type: 'checkbox', checked: settings.capture === 'hidden', click: (item) => setCapture(item.checked) },
    { label: 'Reset position', click: resetPosition },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// --- model gateway: every model call passes gateCall() first ---
// aiMode: 'mock' (no network), 'own-key' (ai.js direct, the user's key), 'live' (the Pensum proxy; the key never leaves Vercel).
const API_BASE = () => process.env.PENSUM_API || require('./package.json').pensum.apiBase;
const aiMode = () => remote.aiMode(process.env, { test: TEST });
// 1280 px wide max, JPEG q70, before any upload.
const shrink = (b64) => { const img = nativeImage.createFromBuffer(Buffer.from(b64, 'base64')); const { width } = img.getSize(); return (width > 1280 ? img.resize({ width: 1280, quality: 'good' }) : img).toJPEG(70).toString('base64'); };
const rdeps = () => ({ base: API_BASE(), fetch: net.fetch.bind(net), ai, resize: shrink }); // net.fetch honours the Windows system proxy
const doQuests = (req) => (aiMode() === 'live' ? remote.quests(req, rdeps()) : ai.quests(req));
const doLook = (a) => (aiMode() === 'live' ? remote.look(a, rdeps()) : ai.look(a));
const DAILY_CAP = () => Number(process.env.PENSUM_DAILY_CALLS) || 300; // all model kinds
const PER_MIN = () => Number(process.env.PENSUM_PER_MIN) || 8;
let stamps = [];
let cappedDay = null; // local day key when Google said per-day quota is gone
// Real calls only: mock mode costs nothing. Returns an error reply, or null to proceed.
function gateCall() {
  if (aiMode() === 'mock') return null;
  if (cappedDay === L.dayKey(Date.now()) || ledger.today().calls >= DAILY_CAP()) {
    return { error: true, limited: true, capped: true, pet_line: 'out of looks for today' };
  }
  const g = L.rateGate(stamps, Date.now(), { perMin: PER_MIN() });
  stamps = g.stamps;
  if (!g.ok) return { error: true, limited: true, retryMs: g.retryMs, pet_line: 'slow down a little, one moment' };
  return null;
}

// --- session: the chosen work window, the signal stream ---
let work = null; // { id, hwnd, title } the only window frames are ever taken from
let sampler = null;
let prevGray = null;
let misses = 0; // consecutive sampler frames that came back empty
let lastFgChange = 0;
let winState = { alive: true, visible: true };
let locked = false;
let sessionGen = 0;
let lastFrame = null; // { at, jpegBase64 } the last frame of the work window; RAM only, 10 min, cleared on stop/pause
// PENSUM_FAKE_IDLE_SEC lets tests run on an idle PC.
const idleSec = () => Number(process.env.PENSUM_FAKE_IDLE_SEC ?? powerMonitor.getSystemIdleTime());

function emit(extra = {}) {
  if (!win || win.isDestroyed()) return;
  const fg = focus.current();
  win.webContents.send('signal', {
    ts: Date.now(),
    changed: false,
    fgHwnd: fg?.hwnd || 0,
    fgProcess: fg?.process || null, // process name only, never the window title
    onWork: !!work && fg?.hwnd === work.hwnd,
    windowAlive: winState.alive,
    windowVisible: winState.visible,
    idleSec: idleSec(),
    locked,
    ...extra,
  });
}

async function sample() {
  const gen = sessionGen;
  if (lastFrame && !L.freshFrame(lastFrame, Date.now())) lastFrame = null;
  if (!work || TEST) return; // test mode: scripted signals only (see test-signal / webContents.send)
  const gray = await capture.grabGray(work.id).catch(() => null);
  if (gen !== sessionGen) return; // session ended or window re-picked while capturing
  const st = L.stepWindow(winState, misses, !!gray);
  winState = st.win;
  misses = st.misses;
  if (!gray) { prevGray = null; return emit(); }
  const settled = Date.now() - lastFgChange > SETTLE_MS;
  const changed = !!prevGray && settled && L.diffFraction(prevGray, gray) >= CHANGED_T;
  prevGray = gray;
  emit({ changed });
}

function stopSession() {
  sessionGen++;
  clearInterval(sampler);
  sampler = null;
  work = null;
  prevGray = null;
  misses = 0;
  lastFrame = null;
  winState = { alive: true, visible: true };
  ai.resetMemory();
  focus.stop();
}

function startSession(picked) {
  stopSession();
  work = picked;
  winState = { alive: true, visible: true };
  lastFgChange = Date.now();
  if (!TEST) { // test mode: the fake window has no real HWND, so no tracker (it would report it closed)
    focus.start(
      () => { lastFgChange = Date.now(); emit(); },
      (st) => { winState = { alive: st.alive, visible: st.visible }; if (st.proc && work) work.proc = st.proc; emit(); },
    );
    focus.setWork(work.hwnd);
  }
  sampler = setInterval(sample, L.dur(SAMPLE_MS));
  sampler.unref?.();
}

ipcMain.handle('list-windows', () => capture.listWindows());

ipcMain.handle('pick-window', async (_e, id) => {
  if (typeof id !== 'string') return { ok: false };
  if (TEST) {
    const d = Number(process.env.PENSUM_PICK_DELAY_MS); // test hook: a slow picker reply, to race New task / Pause against it
    if (d) await new Promise((r) => setTimeout(r, d));
    startSession({ id, hwnd: capture.hwndOf(id), title: 'test window' });
    return { ok: true, title: 'test window' };
  }
  const w = (await capture.listWindows()).find((x) => x.id === id);
  if (!w) return { ok: false };
  startSession({ id: w.id, hwnd: w.hwnd, title: w.title });
  return { ok: true, title: w.title };
});

ipcMain.on('stop-session', () => stopSession());

// Test hook: what main is holding (no content), to prove pause/stop clears it.
if (TEST) global.__qlState = () => ({ hasFrame: !!lastFrame, hasWork: !!work, sampling: !!sampler, lookCalls, lastGetText, linked: settings.linked, capture: settings.capture, protect: lastProtect });

// Own Gemini key (optional): saved to <userData>/.env, never echoed back to the renderer.
const KEY_RE = /^[A-Za-z0-9_-]{20,80}$/;
const userEnv = () => path.join(app.getPath('userData'), '.env');
ipcMain.handle('set-key', (_e, k) => {
  if (typeof k !== 'string' || !KEY_RE.test(k.trim())) return { ok: false };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userEnv(), `GEMINI_API_KEY=${k.trim()}
`);
  process.env.GEMINI_API_KEY = k.trim();
  return { ok: true, aiMode: aiMode() };
});
ipcMain.handle('clear-key', () => { try { fs.rmSync(userEnv()); } catch {} delete process.env.GEMINI_API_KEY; return { ok: true, aiMode: aiMode() }; });
ipcMain.on('reset-position', resetPosition);

// Test hook: push a scripted signal through the same emitter the sampler uses.
if (TEST) ipcMain.handle('test-signal', (_e, sig) => { emit(sig); return true; });

// --- model IPC ---
ipcMain.handle('quests', (_e, req) => gateCall() || doQuests({ ...req, text: String(req?.text || '').slice(0, 300) }));

// One vision call about the chosen window. The renderer decides when; main never calls the model on its own.
let lookCalls = 0; // test counter only
let lastGetText = null; // test only: what the look pipeline asked artifact.getText to read
ipcMain.handle('look', async (_e, req) => {
  const stamp = { idx: req.idx, epoch: req.epoch, purpose: req.purpose };
  const limited = gateCall();
  if (limited) return { ...limited, ...stamp };
  lookCalls++;
  // Main reads only files the user picked in the link-work dialog, never a path the renderer merely names.
  const linkedPath = settings.linked.includes(req.linkedPath) ? req.linkedPath : null;
  const v = await lookFlow({ ...req, linkedPath }, {
    gen: () => sessionGen,
    work: () => work,
    grab: (id, side, q) => capture.grabWindow(id, side, q),
    heldFrame: () => L.freshFrame(lastFrame, Date.now()),
    setFrame: (f) => { lastFrame = { at: Date.now(), jpegBase64: f.jpegBase64 }; },
    onGone: () => { winState = { ...winState, visible: false }; emit(); },
    getText: (a) => { if (TEST) lastGetText = a; return artifact.getText(a); },
    aiLook: doLook,
    redactTitle: (p, t) => L.redactTitle(p, t),
  });
  if (v.error && v.status === 429 && v.perDay) cappedDay = L.dayKey(Date.now());
  return v;
});

ipcMain.handle('link-work', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['docx', 'txt', 'md', 'js', 'ts', 'py', 'json', 'html', 'css', 'tex'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  settings.linked = L.addLinked(settings.linked, file);
  saveSettings();
  const text = await artifact.readFile(file);
  return { path: file, name: path.basename(file), readable: !!text, words: text ? L.artifactDigest(text).words : 0 };
});

ipcMain.handle('usage', () => ({ ...ledger.today(), cap: DAILY_CAP() }));
ipcMain.on('set-size', (_e, h) => { if (!Number.isFinite(h)) return; if (drag) lastCssH = h; else place(h); }); // the drag owns the bounds until it ends
ipcMain.on('set-click-through', (_e, through) => { if (!drag) win.setIgnoreMouseEvents(!!through, { forward: true }); });
// S/M/L: native zoom of the page, the window scales with it. ResizeObserver does not fire on zoom, so main re-places itself.
function setSize(size) {
  if (!Object.hasOwn(L.SIZES, size) || size === settings.size) return;
  settings.size = size;
  saveSettings();
  win.webContents.setZoomFactor(zoom());
  place();
  win.webContents.send('prefs', { size: settings.size, theme: settings.theme });
}
ipcMain.handle('info', () => ({ mock: aiMode() === 'mock', aiMode: aiMode(), hasKey: !!process.env.GEMINI_API_KEY, test: TEST, timeScale: Number(process.env.PENSUM_TIME_SCALE) || 1, lookTimeoutMs: TEST ? Number(process.env.PENSUM_LOOK_TIMEOUT_MS) || undefined : undefined, ...geom(), size: settings.size, theme: settings.theme }));
ipcMain.on('set-pref', (_e, p) => {
  if (!p) return;
  if (typeof p.size === 'string') setSize(p.size);
  if (['system', 'light', 'dark'].includes(p.theme) && p.theme !== settings.theme) {
    settings.theme = p.theme;
    nativeTheme.themeSource = p.theme; // ui.css follows prefers-color-scheme, which follows this
    saveSettings();
    win.webContents.send('prefs', { size: settings.size, theme: settings.theme });
  }
});

// Test hooks: force an anchor / read the window bounds (Playwright cannot move the OS cursor).
if (TEST) {
  global.__qlAnchor = (a) => { settings.anchor = a; saveSettings(); place(); };
  global.__qlBounds = () => win.getBounds();
  global.__qlSetCapture = setCapture; // the tray checkbox's handler
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    ledger.init(app.getPath('userData'));
    loadSettings();
    nativeTheme.themeSource = settings.theme; // before the window loads: no flash of the wrong theme
    // The renderer needs no camera, mic, screen-share, clipboard or notification permission (capture runs in main).
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    const replace = () => place();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, replace);
    powerMonitor.on('lock-screen', () => { dragEnd(); locked = true; emit(); });
    powerMonitor.on('unlock-screen', () => { locked = false; emit(); });
    createWindow();
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { stopSession(); });
}
