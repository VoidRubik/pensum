const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, Tray, Menu, nativeImage } = require('electron');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const ai = require('./ai.js');
const ledger = require('./ledger.js');
const { nextInterval, dayKey } = require('./logic.js');

const SIZES = { bar: { width: 360, height: 76 }, panel: { width: 360, height: 480 } };
const MAX_SIDE = 1024;

let win = null;
let tray = null;
let watching = false;

function placeBottomCenter(size) {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: Math.round(wa.x + (wa.width - size.width) / 2),
    y: wa.y + wa.height - size.height - 12,
    width: size.width,
    height: size.height,
  });
}

function createWindow() {
  win = new BrowserWindow({
    ...SIZES.bar,
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
  placeBottomCenter(SIZES.bar);
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

async function grabScreen() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
  });
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('screen capture returned nothing');
  return {
    jpegBase64: source.thumbnail.toJPEG(70).toString('base64'),
    thumb: source.thumbnail.resize({ width: 160 }).toDataURL(),
  };
}

const BASE_MS = () => Number(process.env.QUESTLING_CHECK_INTERVAL_MS) || 180000;
const DAILY_CAP = () => Number(process.env.QUESTLING_DAILY_CHECKS) || 150;
let timer = null;
let inflight = null; // single-flight: a check already running is joined, never doubled
let cappedDay = null; // local day key when Google said per-day quota is gone

function stopTimer() { clearTimeout(timer); timer = null; }
function schedule(ms) {
  stopTimer();
  timer = setTimeout(() => {
    if (watching && !win.isDestroyed()) win.webContents.send('auto-check');
    schedule(BASE_MS());
  }, ms);
}

function setWatching(on) {
  watching = !!on;
  stopTimer();
  if (!watching) { ai.resetMemory(); inflight = null; }
  else if (cappedDay !== dayKey(Date.now())) schedule(BASE_MS());
}

async function runCheck({ quest, idx, epoch, ctx, auto }) {
  // Result is stamped with THIS request's idx/epoch; a joiner from another epoch gets dropped as stale.
  let frame;
  try {
    frame = await grabScreen();
  } catch {
    return { error: true, pet_line: "couldn't see your screen, trying again soon" };
  }
  const v = await ai.check({ jpegBase64: frame.jpegBase64, quest, ctx, auto });
  if (v.error && v.status === 429) {
    const next = nextInterval(BASE_MS(), v);
    // Per-day quota gone: keep the timer (rolls over at midnight), the gate below makes every tick free.
    if (next === null) { cappedDay = dayKey(Date.now()); return { ...v, capped: true, pet_line: 'out of looks for today' }; }
    if (watching) schedule(next);
  }
  return { ...(v.error ? v : { ...v, thumb: frame.thumb }), idx, epoch };
}

ipcMain.handle('quests', (_e, req) => ai.quests(req));
ipcMain.handle('check', async (_e, req) => {
  if (!watching) return { error: true, paused: true, pet_line: 'paused' };
  const capped = !ai.isMock() && (cappedDay === dayKey(Date.now()) || (req.auto && ledger.today().checks >= DAILY_CAP()));
  if (capped) {
    return { error: true, capped: true, pet_line: 'out of looks for today', idx: req.idx, epoch: req.epoch };
  }
  if (!inflight) { const p = runCheck(req).finally(() => { if (inflight === p) inflight = null; }); inflight = p; }
  return inflight;
});
ipcMain.on('set-watching', (_e, on) => setWatching(on));
ipcMain.handle('usage', () => ({ ...ledger.today(), cap: DAILY_CAP() }));
ipcMain.on('set-expanded', (_e, expanded) => placeBottomCenter(expanded ? SIZES.panel : SIZES.bar));
ipcMain.handle('info', () => ({ mock: ai.isMock(), tickMs: Number(process.env.QUESTLING_TICK_MS) || 0 }));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    ledger.init(app.getPath('userData'));
    createWindow();
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
}
