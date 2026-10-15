'use strict';

// Ad-blocking scriptlets (uBlock-style "+js(...)" rules) must run before any of
// the page's own scripts: sites like YouTube keep references to fetch,
// JSON.parse and XMLHttpRequest from their first lines, and a scriptlet that
// arrives later can no longer intercept them — ads then slip through when
// YouTube switches videos and the player stalls on an ad it can't load.
// webFrame.executeJavaScript from a preload runs synchronously in the page's
// main world, before the document's first script.
const { ipcRenderer, webFrame } = require('electron');

if (/^https?:$/.test(location.protocol)) {
  let scripts = [];
  try {
    scripts = ipcRenderer.sendSync('kitty:scriptlets', location.href) || [];
  } catch {
    // main process busy or not ready: the page loads without scriptlets
  }
  for (const script of scripts) {
    webFrame.executeJavaScript(script).catch(() => {});
  }
}
