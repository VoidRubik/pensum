const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questling', {
  makeQuests: (req) => ipcRenderer.invoke('quests', req),
  check: (req) => ipcRenderer.invoke('check', req),
  usage: () => ipcRenderer.invoke('usage'),
  onAutoCheck: (fn) => ipcRenderer.on('auto-check', () => fn()),
  info: () => ipcRenderer.invoke('info'),
  setWatching: (on) => ipcRenderer.send('set-watching', on),
  setExpanded: (on) => ipcRenderer.send('set-expanded', on),
  onPaused: (fn) => ipcRenderer.on('paused', () => fn()),
});
