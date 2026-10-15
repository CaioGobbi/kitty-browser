'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);
const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('kittyUI', {
  isPrivate: new URLSearchParams(location.search).get('private') === '1',
  platform: process.platform,

  ready: send('ui:ready'),
  setChrome: send('ui:chrome'),
  newTab: send('tab:new'),
  closeTab: send('tab:close'),
  switchTab: send('tab:switch'),
  moveTab: send('tab:move'),
  tabMenu: send('tab:menu'),
  muteTab: send('tab:mute'),
  navigate: send('nav:go'),
  back: send('nav:back'),
  forward: send('nav:forward'),
  reload: send('nav:reload'),
  stop: send('nav:stop'),
  toggleShield: send('shield:toggle'),
  openInternal: send('open:internal'),
  newPrivateWindow: send('window:private'),
  newWindow: send('window:new'),
  find: send('find:query'),
  stopFind: send('find:stop'),
  answerPermission: send('perm:answer'),
  toggleBookmark: send('bookmark:toggle'),
  openBookmark: send('bookmark:open'),
  bookmarkMenu: send('bookmark:menu'),
  bookmarkFolder: send('bookmark:folder'),
  downloadAction: send('downloads:action'),
  clearDownloads: send('downloads:clear'),
  installUpdate: send('update:install'),
  suggest: (text) => ipcRenderer.invoke('ui:suggest', text),

  onState: on('tabs:state'),
  onBookmarks: on('bookmarks:state'),
  onDownloads: on('downloads:state'),
  onDownloadStarted: on('downloads:started'),
  onToggleDownloads: on('downloads:toggle'),
  onSettings: on('settings:state'),
  onUpdate: on('update:state'),
  onFullscreen: on('ui:fullscreen'),
  onFocusAddress: on('ui:focus-address'),
  onFindOpen: on('find:open'),
  onFindClose: on('find:close'),
  onFindStep: on('find:step'),
  onFindResult: on('find:result'),
});
