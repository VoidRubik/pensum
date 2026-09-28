const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, Tray, Menu, nativeImage } = require('electron');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const ai = require('./ai.js');

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
    { label: 'Pause watching', click: () => { watching = false; win.webContents.send('paused'); } },
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

ipcMain.handle('quests', (_e, req) => ai.quests(req));
ipcMain.handle('check', async (_e, { quest }) => {
  if (!watching) return { error: 'paused', pet_line: 'paused — hit Start to resume' };
  let frame;
  try {
    frame = await grabScreen();
  } catch (e) {
    return { error: String(e.message || e), pet_line: "couldn't see your screen, trying again soon" };
  }
  const verdict = await ai.check({ jpegBase64: frame.jpegBase64, quest });
  return { ...verdict, thumb: frame.thumb };
});
ipcMain.on('set-watching', (_e, on) => { watching = !!on; });
ipcMain.on('set-expanded', (_e, expanded) => placeBottomCenter(expanded ? SIZES.panel : SIZES.bar));
ipcMain.handle('info', () => ({ mock: ai.isMock() }));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
}
