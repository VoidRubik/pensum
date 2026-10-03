// Window capture for the chosen work window. Main process only.
// Frames come ONLY from the window the user picked: there is no display fallback, ever.
// A minimized or closed window drops out of getSources, which is how "windowVisible:false" is detected.
const { desktopCapturer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const hwndOf = (id) => Number(String(id).split(':')[1]) || 0;

// PENSUM_TEST=1: frames come from demo/samples/<name>.jpg instead of a real window (PENSUM_SAMPLE).
const testSample = () => {
  const f = path.join(__dirname, 'demo', 'samples', `${process.env.PENSUM_SAMPLE || 'essay-blank'}.jpg`);
  try { return fs.readFileSync(f); } catch { return null; }
};

async function findSource(id, size) {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size });
  return sources.find((s) => s.id === id) || null;
}

/** Windows to pick from: id, title, small preview (stays on this PC). The pet's own window is excluded. */
async function listWindows() {
  // 1x1 transparent PNG; the test never lists (or shows) the real desktop.
  if (process.env.PENSUM_TEST) return [{ id: 'window:111:0', hwnd: 111, title: 'Docs - Water Cycle essay', thumb: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }];
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 200, height: 125 } });
  return sources
    .filter((s) => s.name && s.name !== 'Pensum' && !s.thumbnail.isEmpty())
    .map((s) => ({ id: s.id, hwnd: hwndOf(s.id), title: s.name, thumb: s.thumbnail.toDataURL() }));
}

/** JPEG of the chosen window at up to maxSide px on its long edge. null = gone, minimized or blank. */
async function grabWindow(id, maxSide = 1600, quality = 70) {
  if (process.env.PENSUM_TEST) {
    const buf = testSample();
    return buf ? { jpegBase64: buf.toString('base64'), title: 'test window' } : null;
  }
  const src = await findSource(id, { width: maxSide, height: maxSide });
  if (!src || src.thumbnail.isEmpty()) return null;
  return { jpegBase64: src.thumbnail.toJPEG(quality).toString('base64'), title: src.name };
}

/** 160x100 grayscale of the chosen window for change detection; never stored, never sent. null = gone. */
async function grabGray(id) {
  const src = await findSource(id, { width: 640, height: 400 });
  if (!src || src.thumbnail.isEmpty()) return null;
  const b = src.thumbnail.resize({ width: 160, height: 100, quality: 'good' }).toBitmap(); // BGRA
  const g = new Uint8Array(160 * 100);
  for (let i = 0; i < g.length; i++) g[i] = (b[i * 4] * 0.114 + b[i * 4 + 1] * 0.587 + b[i * 4 + 2] * 0.299) | 0;
  return g;
}

module.exports = { listWindows, grabWindow, grabGray, hwndOf };
