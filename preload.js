const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questling', {
  makeQuests: (req) => ipcRenderer.invoke('quests', req),
  check: (req) => ipcRenderer.invoke('check', req),
  doneCheck: (req) => ipcRenderer.invoke('done-check', req),
  linkWork: () => ipcRenderer.invoke('link-work'),
  usage: () => ipcRenderer.invoke('usage'),
  onAutoCheck: (fn) => ipcRenderer.on('auto-check', () => fn()),
  info: () => ipcRenderer.invoke('info'),
  setWatching: (on) => ipcRenderer.send('set-watching', on),
  setSize: (h) => ipcRenderer.send('set-size', h),
  setClickThrough: (on) => ipcRenderer.send('set-click-through', on),
  onPaused: (fn) => ipcRenderer.on('paused', () => fn()),
});
