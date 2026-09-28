const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('questling', {
  makeQuests: (req) => ipcRenderer.invoke('quests', req),
  checkNow: (quest) => ipcRenderer.invoke('check', { quest }),
  info: () => ipcRenderer.invoke('info'),
  setWatching: (on) => ipcRenderer.send('set-watching', on),
  setExpanded: (on) => ipcRenderer.send('set-expanded', on),
  onPaused: (fn) => ipcRenderer.on('paused', () => fn()),
});
