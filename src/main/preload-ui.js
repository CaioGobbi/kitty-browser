'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kittyUI', {
  newTab: () => ipcRenderer.send('tab:new'),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  switchTab: (id) => ipcRenderer.send('tab:switch', id),
  navigate: (input) => ipcRenderer.send('nav:go', input),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  toggleShield: () => ipcRenderer.send('shield:toggle'),
  openHistory: () => ipcRenderer.send('open:history'),
  ready: () => ipcRenderer.send('ui:ready'),
  platform: process.platform,
  onState: (cb) => ipcRenderer.on('tabs:state', (_e, state) => cb(state)),
  onFocusAddress: (cb) => ipcRenderer.on('ui:focus-address', () => cb()),
});
