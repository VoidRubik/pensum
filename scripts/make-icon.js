// Renders the Tuck idle pose (pet.svg) to build/icon.png (256x256) for electron-builder.
//   npx electron scripts/make-icon.js      (VS Code shells: unset ELECTRON_RUN_AS_NODE first)
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'pet.svg'), 'utf8').replace('<svg ', '<svg width="256" height="256" ');
  const html = `<style>html,body{margin:0;background:transparent}.ps{display:none}.ps-idle_a{display:block}</style>${svg}`;
  const w = new BrowserWindow({ show: false, width: 256, height: 256, frame: false, transparent: true, useContentSize: true });
  await w.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), img.toPNG());
  console.log('build/icon.png', img.getSize());
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
