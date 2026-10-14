'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Only Kitty's own pages (kitty://newtab, kitty://history) get this API.
// The main process re-checks the sender's origin on every call.
if (location.protocol === 'kitty:') {
  contextBridge.exposeInMainWorld('kitty', {
    history: (query) => ipcRenderer.invoke('kitty:history', query),
    removeHistory: (time) => ipcRenderer.invoke('kitty:history-remove', time),
    clearHistory: () => ipcRenderer.invoke('kitty:history-clear'),
    stats: () => ipcRenderer.invoke('kitty:stats'),
  });
}
