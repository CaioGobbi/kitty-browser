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
      checkUpdate: invoke('kitty:settings-check-update'),
    },
  });
}

// ---------------------------------------------------------------------------
// Swipe back/forward: a two-finger horizontal swipe on the trackpad arrives as
// horizontal wheel events. When the page itself can't scroll that way, Kitty
// navigates — with an arrow at the edge that follows the fingers, like Safari.

const SWIPE_DISTANCE = 160; // px of horizontal scrolling needed to navigate
const GESTURE_GAP = 350; // ms without wheel events = the gesture is over

let swipe = null;
let swipeTimer = null;
let indicator = null;

/** Could the element under the pointer (or an ancestor) still scroll this way? */
function canScrollHorizontally(target, deltaX) {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const scrollable = /(auto|scroll)/.test(style.overflowX) || el === document.scrollingElement;
    if (!scrollable || el.scrollWidth <= el.clientWidth + 1) continue;
    if (deltaX < 0 && el.scrollLeft > 0) return true;
    if (deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  return false;
}

function showIndicator(direction, progress) {
  if (!indicator) {
    indicator = document.createElement('kitty-swipe');
    const s = indicator.style;
    s.position = 'fixed';
    s.top = '50%';
    s.zIndex = '2147483647';
    s.width = '44px';
    s.height = '44px';
    s.marginTop = '-22px';
    s.borderRadius = '50%';
    s.display = 'grid';
    s.placeItems = 'center';
    s.pointerEvents = 'none';
    s.font = '600 22px -apple-system, "Segoe UI", sans-serif';
    s.color = '#fff';
    s.boxShadow = '0 6px 18px rgba(0,0,0,.3)';
    s.transition = 'background .12s';
    document.documentElement.append(indicator);
  }
  const s = indicator.style;
  const ready = progress >= 1;
  s.background = ready ? '#ff7a45' : 'rgba(40,36,50,.82)';
  s.opacity = String(Math.min(1, progress * 1.4));
  indicator.textContent = direction === 'back' ? '←' : '→';
  const offset = -44 + Math.min(1, progress) * 60;
  s.left = direction === 'back' ? `${offset}px` : 'auto';
  s.right = direction === 'forward' ? `${offset}px` : 'auto';
}

function endSwipe() {
  if (swipe && !swipe.done && Math.abs(swipe.dx) >= SWIPE_DISTANCE) {
    ipcRenderer.send('gesture:navigate', swipe.dx < 0 ? 'back' : 'forward');
  }
  swipe = null;
  indicator?.remove();
  indicator = null;
}

window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.deltaMode !== 0) return; // pinch-zoom, or a mouse wheel in lines/pages
    clearTimeout(swipeTimer);
    swipeTimer = setTimeout(endSwipe, GESTURE_GAP);
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5;
    if (!swipe) {
      if (!horizontal || canScrollHorizontally(e.target, e.deltaX)) {
        swipe = { dx: 0, done: true }; // this gesture belongs to the page
        return;
      }
      swipe = { dx: 0, done: false };
    }
    if (swipe.done) return;
    swipe.dx += e.deltaX;
    // Natural scrolling: fingers moving right scroll left (negative deltaX) → back.
    showIndicator(swipe.dx < 0 ? 'back' : 'forward', Math.abs(swipe.dx) / SWIPE_DISTANCE);
  },
  { passive: true, capture: true },
);

// Mouse side buttons (back/forward). Windows also reports them as app-commands
// (handled in window.js), so listening here too would navigate twice.
if (process.platform !== 'win32') {
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) ipcRenderer.send('gesture:navigate', 'back');
    if (e.button === 4) ipcRenderer.send('gesture:navigate', 'forward');
  });
}
