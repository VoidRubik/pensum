const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, powerMonitor, dialog, Tray, Menu, nativeImage } = require('electron');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const ai = require('./ai.js');
const ledger = require('./ledger.js');
const focus = require('./focus.js');
const artifact = require('./artifact.js');
const { nextInterval, dayKey, shouldSkip, artifactDigest, capMiddle, rateGate } = require('./logic.js');

const WIDTH = 400;
const BAR_H = 76;
const MAX_H = 780; // bar + panel + bubble + proposal; also clamped to the work area
const MAX_SIDE = { check: 1600, done: 2048 };

let win = null;
let tray = null;
let watching = false;

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
  // Keeps the pet out of its own screenshots, so Gemini never judges the pet.
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
    { label: 'Pause watching', click: () => { setWatching(false); win.webContents.send('paused'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// Where the user works = the display their cursor last rested on OUTSIDE the pet (clicking the pet
// itself always puts the cursor on the pet's display). Sampled every second while watching.
let workDisplay = null;
function sampleCursor() {
  const pt = screen.getCursorScreenPoint();
  const b = win && !win.isDestroyed() ? win.getBounds() : null;
  const onPet = b && pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
  if (!onPet) workDisplay = screen.getDisplayNearestPoint(pt);
}
setInterval(sampleCursor, 1000).unref();

// Native size of the work display capped to maxSide; primary as fallback.
async function grabScreen(maxSide, quality) {
  sampleCursor();
  const display = workDisplay || screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const all = screen.getAllDisplays();
  const byId = (d) => sources.find((s) => s.display_id === String(d.id));
  // display_id can come back empty: then match by position, else (single source) take it.
  const source = byId(display) || byId(screen.getPrimaryDisplay())
    || (sources.length === all.length ? sources[all.findIndex((d) => d.id === display.id)] : null)
    || (sources.length === 1 ? sources[0] : null);
  if (!source || source.thumbnail.isEmpty()) throw new Error('screen capture returned nothing');
  return {
    jpegBase64: source.thumbnail.toJPEG(quality).toString('base64'),
    thumb: source.thumbnail.resize({ width: 160 }).toDataURL(),
    size: source.thumbnail.getSize(),
  };
}

const BASE_MS = () => Number(process.env.QUESTLING_CHECK_INTERVAL_MS) || 180000;
const DAILY_CAP = () => Number(process.env.QUESTLING_DAILY_CALLS) || 300; // all model kinds
const PER_MIN = () => Number(process.env.QUESTLING_PER_MIN) || 8;
let stamps = [];
// Gate for every model call. Real calls only: mock mode costs nothing. Returns an error reply, or null to proceed.
function gateCall() {
  if (ai.isMock()) return null;
  if (ledger.today().calls >= DAILY_CAP()) return { error: true, limited: true, capped: true, pet_line: 'out of looks for today' };
  const g = rateGate(stamps, Date.now(), { perMin: PER_MIN() });
  stamps = g.stamps;
  if (!g.ok) return { error: true, limited: true, retryMs: g.retryMs, pet_line: 'slow down a little, one moment' };
  return null;
}
let timer = null;
let inflight = null; // single-flight: a check already running is joined, never doubled
let doneInflight = null; // done-check has its own slot: never joins an auto check, works while paused
let cappedDay = null; // local day key when Google said per-day quota is gone
let lastLookAt = null;
let locked = false;
// QUESTLING_FAKE_IDLE_SEC lets tests run on an idle PC.
const idleSec = () => Number(process.env.QUESTLING_FAKE_IDLE_SEC ?? powerMonitor.getSystemIdleTime());

function stopTimer() { clearTimeout(timer); timer = null; }
function schedule(ms) {
  stopTimer();
  timer = setTimeout(() => {
    // Away (locked / idle): skip the paid check silently.
    if (watching && !win.isDestroyed() && !shouldSkip(idleSec(), locked, BASE_MS())) {
      win.webContents.send('auto-check');
    }
    schedule(BASE_MS());
  }, ms);
}

function setWatching(on) {
  watching = !!on;
  stopTimer();
  if (watching) focus.start();
  else { ai.resetMemory(); inflight = null; focus.stop(); lastLookAt = null; }
  if (watching && cappedDay !== dayKey(Date.now())) schedule(BASE_MS());
}

// Screen-derived context for one check, in memory only: time per window since the last look, plus long-work text.
async function gatherSignals(req, { full }) {
  const now = Date.now();
  const focusLine = focus.summary(lastLookAt || now - BASE_MS(), now, { titles: req.titles !== false });
  if (!full) lastLookAt = now; // a done-check must not eat the window the next auto check reports
  const got = await artifact.getText({ focusProc: focus.current()?.process, linkedPath: req.linkedPath });
  return {
    focus: focusLine,
    source: got?.source || null,
    digest: got && !full ? artifactDigest(got.text) : null,
    text: got && full ? capMiddle(got.text, 40000) : null,
  };
}

async function runCheck({ quest, idx, epoch, ctx, auto, ...req }) {
  // Result is stamped with THIS request's idx/epoch; a joiner from another epoch gets dropped as stale.
  let frame;
  try {
    frame = await grabScreen(MAX_SIDE.check, 70);
  } catch {
    return { error: true, pet_line: "couldn't see your screen, trying again soon" };
  }
  const sig = await gatherSignals(req, { full: false });
  const v = await ai.check({ jpegBase64: frame.jpegBase64, quest, ctx: { ...ctx, ...sig }, auto });
  if (v.error && v.status === 429) {
    const next = nextInterval(BASE_MS(), v);
    // Per-day quota gone: keep the timer (rolls over at midnight), the gate below makes every tick free.
    if (next === null) { cappedDay = dayKey(Date.now()); return { ...v, capped: true, pet_line: 'out of looks for today' }; }
    if (watching) schedule(next);
  }
  return { ...(v.error ? v : { ...v, thumb: frame.thumb }), idx, epoch };
}

ipcMain.handle('quests', (_e, req) => gateCall() || ai.quests(req));
ipcMain.handle('check', async (_e, req) => {
  if (!watching) return { error: true, paused: true, pet_line: 'paused' };
  const stamp = { idx: req.idx, epoch: req.epoch };
  if (!ai.isMock() && cappedDay === dayKey(Date.now())) return { error: true, capped: true, pet_line: 'out of looks for today', ...stamp };
  const limited = inflight ? null : gateCall();
  if (limited) return { ...limited, ...stamp };
  if (!inflight) { const p = runCheck(req).finally(() => { if (inflight === p) inflight = null; }); inflight = p; }
  return inflight;
});

// "Am I done?" — own channel and slot, quest model, sharper frame, full linked text. Works while paused.
ipcMain.handle('done-check', async (_e, req) => {
  const limited = doneInflight ? null : gateCall();
  if (limited) return { ...limited, idx: req.idx, epoch: req.epoch };
  if (!doneInflight) {
    const p = (async () => {
      try {
        const frame = await grabScreen(MAX_SIDE.done, 85);
        const sig = await gatherSignals(req, { full: true });
        const r = await ai.doneCheck({ jpegBase64: frame.jpegBase64, quest: req.quest, ctx: { ...req.ctx, ...sig } });
        return { ...r, idx: req.idx, epoch: req.epoch };
      } catch {
        return { error: true, pet_line: "couldn't see your screen, try again", idx: req.idx, epoch: req.epoch };
      }
    })().finally(() => { if (doneInflight === p) doneInflight = null; });
    doneInflight = p;
  }
  return doneInflight;
});

ipcMain.handle('link-work', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['docx', 'txt', 'md', 'js', 'ts', 'py', 'json', 'html', 'css', 'tex'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const text = await artifact.readFile(file);
  return { path: file, name: path.basename(file), readable: !!text, words: text ? artifactDigest(text).words : 0 };
});

ipcMain.on('set-watching', (_e, on) => setWatching(on));
ipcMain.handle('usage', () => ({ ...ledger.today(), cap: DAILY_CAP() }));
ipcMain.on('set-size', (_e, h) => { if (Number.isFinite(h)) placeBottomCenter(h); });
ipcMain.on('set-click-through', (_e, through) => win.setIgnoreMouseEvents(!!through, { forward: true }));
ipcMain.handle('info', () => ({ mock: ai.isMock(), tickMs: Number(process.env.QUESTLING_TICK_MS) || 0 }));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    ledger.init(app.getPath('userData'));
    powerMonitor.on('lock-screen', () => { locked = true; });
    powerMonitor.on('unlock-screen', () => { locked = false; });
    createWindow();
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => focus.stop());
}
