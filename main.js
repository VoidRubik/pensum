const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, powerMonitor, dialog, Tray, Menu, nativeImage } = require('electron');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const ai = require('./ai.js');
const ledger = require('./ledger.js');
const focus = require('./focus.js');
const artifact = require('./artifact.js');
const capture = require('./capture.js');
const L = require('./logic.js');

L.setTimeScale(Number(process.env.QUESTLING_TIME_SCALE) || 1);
const TEST = !!process.env.QUESTLING_TEST;

const WIDTH = 400;
const BAR_H = 92;
const MAX_H = 780; // bar + panel + bubble + card; also clamped to the work area
const SAMPLE_MS = 15000; // change-detection sampler (spike 0a: capture 100-430 ms)
const CHANGED_T = 0.004; // fraction of pixels moved > 24/255; one typed line measured 5-6 %, idle noise 0 %
const SETTLE_MS = 3000; // ignore diffs right after a foreground change (title-bar recolour is not work)

let win = null;
let tray = null;

// Bottom-center of the primary display, growing upward. The transparent window is click-through
// except over the bar / bubble / panel (renderer toggles via set-click-through).
function placeBottomCenter(height) {
  const wa = screen.getPrimaryDisplay().workArea;
  const h = Math.max(BAR_H, Math.min(MAX_H, wa.height - 24, Math.round(height)));
  win.setBounds({
    x: Math.round(wa.x + (wa.width - WIDTH) / 2),
    y: wa.y + wa.height - h - 12,
    width: WIDTH,
    height: h,
  });
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
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Keeps the pet out of any screenshot. (Playwright/CDP page.screenshot is unaffected.)
  win.setContentProtection(true);
  placeBottomCenter(BAR_H);
  win.setIgnoreMouseEvents(true, { forward: true });
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

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Questling');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide', click: () => (win.isVisible() ? win.hide() : win.showInactive()) },
    { label: 'Pause', click: () => { stopSession(); win.webContents.send('paused'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// --- model gateway: every model call passes gateCall() first ---
const DAILY_CAP = () => Number(process.env.QUESTLING_DAILY_CALLS) || 300; // all model kinds
const PER_MIN = () => Number(process.env.QUESTLING_PER_MIN) || 8;
let stamps = [];
let cappedDay = null; // local day key when Google said per-day quota is gone
// Real calls only: mock mode costs nothing. Returns an error reply, or null to proceed.
function gateCall() {
  if (ai.isMock()) return null;
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
let lastFgChange = 0;
let winState = { alive: true, visible: true };
let locked = false;
let sessionGen = 0;
let lastFrame = null; // { at, jpegBase64 } the last frame of the work window; RAM only, 10 min, cleared on stop/pause
// QUESTLING_FAKE_IDLE_SEC lets tests run on an idle PC.
const idleSec = () => Number(process.env.QUESTLING_FAKE_IDLE_SEC ?? powerMonitor.getSystemIdleTime());

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
  if (!gray) { winState = { alive: winState.alive, visible: false }; prevGray = null; return emit(); }
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
      (st) => { winState = st; emit(); },
    );
    focus.setWork(work.hwnd);
  }
  sampler = setInterval(sample, L.dur(SAMPLE_MS));
  sampler.unref?.();
}

ipcMain.handle('list-windows', () => capture.listWindows());

ipcMain.handle('pick-window', async (_e, id) => {
  if (typeof id !== 'string') return { ok: false };
  if (TEST) { startSession({ id, hwnd: capture.hwndOf(id), title: 'test window' }); return { ok: true, title: 'test window' }; }
  const w = (await capture.listWindows()).find((x) => x.id === id);
  if (!w) return { ok: false };
  startSession({ id: w.id, hwnd: w.hwnd, title: w.title });
  return { ok: true, title: w.title };
});

ipcMain.on('stop-session', () => stopSession());

// Test hook: push a scripted signal through the same emitter the sampler uses.
if (TEST) ipcMain.handle('test-signal', (_e, sig) => { emit(sig); return true; });

// --- model IPC ---
ipcMain.handle('quests', (_e, req) => gateCall() || ai.quests(req));

// One vision call about the chosen window. The renderer decides when; main never calls on its own.
ipcMain.handle('look', async (_e, req) => {
  const stamp = { idx: req.idx, epoch: req.epoch, purpose: req.purpose };
  const limited = gateCall();
  if (limited) return { ...limited, ...stamp };
  if (!work) return { error: true, noWindow: true, ...stamp };
  const frame = await capture.grabWindow(work.id, req.purpose === 'done' ? 2048 : 1600, req.purpose === 'done' ? 85 : 70).catch(() => null);
  if (frame) lastFrame = { at: Date.now(), jpegBase64: frame.jpegBase64 };
  // Coming back after the window was minimized or closed: the held frame still shows where the user left off.
  const held = !frame && req.purpose === 'reentry' ? L.freshFrame(lastFrame, Date.now()) : null;
  if (!frame && !held) {
    winState = { ...winState, visible: false };
    emit();
    return { error: true, windowGone: true, ...stamp };
  }
  const got = await artifact.getText({ focusProc: focus.current()?.process, linkedPath: req.linkedPath });
  const ctx = {
    ...req.ctx,
    allow: req.allow,
    source: got?.source || null,
    digest: got && req.purpose !== 'done' ? L.artifactDigest(got.text) : null,
    text: got && req.purpose === 'done' ? L.capMiddle(got.text, 40000) : null,
  };
  const v = await ai.look({ purpose: req.purpose, jpegBase64: frame ? frame.jpegBase64 : held, quest: req.quest, ctx });
  if (v.error && v.status === 429 && v.perDay) cappedDay = L.dayKey(Date.now());
  return { ...v, ...stamp };
});

ipcMain.handle('link-work', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['docx', 'txt', 'md', 'js', 'ts', 'py', 'json', 'html', 'css', 'tex'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const text = await artifact.readFile(file);
  return { path: file, name: path.basename(file), readable: !!text, words: text ? L.artifactDigest(text).words : 0 };
});

ipcMain.handle('usage', () => ({ ...ledger.today(), cap: DAILY_CAP() }));
ipcMain.on('set-size', (_e, h) => { if (Number.isFinite(h)) placeBottomCenter(h); });
ipcMain.on('set-click-through', (_e, through) => win.setIgnoreMouseEvents(!!through, { forward: true }));
ipcMain.handle('info', () => ({ mock: ai.isMock(), test: TEST, timeScale: Number(process.env.QUESTLING_TIME_SCALE) || 1 }));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    ledger.init(app.getPath('userData'));
    powerMonitor.on('lock-screen', () => { locked = true; emit(); });
    powerMonitor.on('unlock-screen', () => { locked = false; emit(); });
    createWindow();
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { stopSession(); });
}
