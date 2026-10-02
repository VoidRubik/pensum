const { contextBridge, ipcRenderer } = require('electron');

// The complete surface the renderer gets. The key, frames and device access all stay in main.
contextBridge.exposeInMainWorld('questling', {
  makeQuests: (req) => ipcRenderer.invoke('quests', req),
  look: (req) => ipcRenderer.invoke('look', req),
  listWindows: () => ipcRenderer.invoke('list-windows'),
  pickWindow: (id) => ipcRenderer.invoke('pick-window', id),
  stopSession: () => ipcRenderer.send('stop-session'),
  onSignal: (fn) => ipcRenderer.on('signal', (_e, sig) => fn(sig)),
  linkWork: () => ipcRenderer.invoke('link-work'),
  usage: () => ipcRenderer.invoke('usage'),
  info: () => ipcRenderer.invoke('info'),
  setSize: (h) => ipcRenderer.send('set-size', h),
  setClickThrough: (on) => ipcRenderer.send('set-click-through', on),
  onPaused: (fn) => ipcRenderer.on('paused', () => fn()),
});
