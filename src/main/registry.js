'use strict';

// Keeps track of every open Kitty window so other modules can find the window
// and tab behind a webContents (for IPC, permissions, blocking…).

/** @type {Set<import('./window').KittyWindow>} */
const windows = new Set();
let lastFocused = null;

const registry = {
  windows,

  add(kwin) {
    windows.add(kwin);
    lastFocused = kwin;
  },

  remove(kwin) {
    windows.delete(kwin);
    if (lastFocused === kwin) lastFocused = [...windows].at(-1) || null;
  },

  focus(kwin) {
    lastFocused = kwin;
  },

  /** The window menu actions and external links should target. */
  current({ allowPrivate = true } = {}) {
    if (lastFocused && windows.has(lastFocused) && (allowPrivate || !lastFocused.isPrivate)) return lastFocused;
    const list = [...windows].filter((w) => allowPrivate || !w.isPrivate);
    return list.at(-1) || null;
  },

  byUi(webContents) {
    for (const w of windows) if (w.ui.webContents === webContents) return w;
    return null;
  },

  /** @returns {{ kwin: import('./window').KittyWindow, tab: object } | null} */
  tabByWebContentsId(id) {
    if (!id) return null;
    for (const kwin of windows) {
      const tab = kwin.tabs.get(id);
      if (tab) return { kwin, tab };
    }
    return null;
  },

  broadcast(channel, payload) {
    for (const w of windows) w.sendUi(channel, payload);
  },
};

module.exports = { registry };
