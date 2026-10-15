'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Only Kitty's own pages (kitty://…) get this API. The main process re-checks
// the sender's page on every call, so one page can't use another page's API.
if (location.protocol === 'kitty:') {
  const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
  contextBridge.exposeInMainWorld('kitty', {
    platform: process.platform,
    context: invoke('kitty:context'),
    stats: invoke('kitty:stats'),
    history: invoke('kitty:history'),
    removeHistory: invoke('kitty:history-remove'),
    clearHistory: invoke('kitty:history-clear'),
    bookmarks: invoke('kitty:bookmarks'),
    removeBookmark: invoke('kitty:bookmark-remove'),
    renameBookmark: invoke('kitty:bookmark-rename'),
    bypassThreat: invoke('kitty:threat-bypass'),
    settings: {
      get: invoke('kitty:settings'),
      set: invoke('kitty:settings-set'),
      removeAllowlisted: invoke('kitty:settings-allowlist-remove'),
      removePermission: invoke('kitty:settings-permission-remove'),
      clearData: invoke('kitty:settings-clear'),
      makeDefaultBrowser: invoke('kitty:settings-default-browser'),
      openDownloads: invoke('kitty:settings-open-downloads'),
      updateLists: invoke('kitty:settings-update-lists'),
    },
  });
}
