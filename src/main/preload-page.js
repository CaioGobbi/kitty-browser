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
//
// Wheel events don't say when the fingers leave the trackpad, and macOS keeps
// sending "momentum" events for up to a second afterwards. Waiting for those
// to end felt laggy, so the gesture commits as soon as it's clearly over: the
// speed drops well below its peak (the fingers lifted and momentum is decaying)
// or the events stop for a moment.

const SWIPE_DISTANCE = 140; // px of horizontal scrolling needed to navigate
const RELEASE_SLOWDOWN = 0.75; // speed below 75% of the gesture's peak = released
const RELEASE_PAUSE = 90; // ms without events = released
const GESTURE_GAP = 280; // ms without events = a new gesture may start

let swipe = null;
let releaseTimer = null;
let gapTimer = null;
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

function createIndicator() {
  const el = document.createElement('kitty-swipe');
  const s = el.style;
  s.position = 'fixed';
  s.top = '50%';
  s.left = '0';
  s.zIndex = '2147483647';
  s.width = '46px';
  s.height = '46px';
  s.marginTop = '-23px';
  s.borderRadius = '50%';
  s.display = 'grid';
  s.placeItems = 'center';
  s.pointerEvents = 'none';
  s.font = '600 22px -apple-system, "Segoe UI", sans-serif';
  s.color = '#fff';
  s.boxShadow = '0 6px 20px rgba(0,0,0,.28)';
  s.willChange = 'transform, opacity';
  s.transition = 'background-color .15s ease, transform .06s linear, opacity .06s linear';
  document.documentElement.append(el);
  return el;
}

function showIndicator(direction, progress) {
  indicator ??= createIndicator();
  const p = Math.min(1, progress);
  const ready = progress >= 1;
  const travel = -46 + p * 64; // slides in from the edge
  const x = direction === 'back' ? travel : innerWidth - 46 - travel;
  const s = indicator.style;
  s.background = ready ? '#ff7a45' : 'rgba(40,36,50,.82)';
  s.opacity = String(Math.min(1, p * 1.6));
  s.transform = `translateX(${x}px) scale(${0.7 + p * 0.3 + (ready ? 0.06 : 0)})`;
  indicator.textContent = direction === 'back' ? '←' : '→';
}

function hideIndicator(committed) {
  const el = indicator;
  indicator = null;
  if (!el) return;
  el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease';
  el.style.opacity = '0';
  el.style.transform += committed ? ' scale(1.25)' : ' scale(.6)';
  setTimeout(() => el.remove(), 240);
}

function release() {
  clearTimeout(releaseTimer);
  if (!swipe || swipe.done) return;
  swipe.done = true;
  const committed = Math.abs(swipe.dx) >= SWIPE_DISTANCE;
  hideIndicator(committed);
  if (committed) ipcRenderer.send('gesture:navigate', swipe.dx < 0 ? 'back' : 'forward');
}

window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.deltaMode !== 0) return; // pinch-zoom, or a mouse wheel in lines/pages
    clearTimeout(gapTimer);
    gapTimer = setTimeout(() => {
      release();
      swipe = null;
    }, GESTURE_GAP);
    if (!swipe) {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5;
      // Not a horizontal swipe, or the page scrolls sideways itself: leave it alone.
      swipe = { dx: 0, peak: 0, done: !horizontal || canScrollHorizontally(e.target, e.deltaX) };
    }
    if (swipe.done) return; // momentum after the release, or the page's own gesture

    swipe.dx += e.deltaX;
    const speed = Math.abs(e.deltaX);
    swipe.peak = Math.max(swipe.peak, speed);
    // Natural scrolling: fingers moving right scroll left (negative deltaX) → back.
    showIndicator(swipe.dx < 0 ? 'back' : 'forward', Math.abs(swipe.dx) / SWIPE_DISTANCE);

    if (Math.abs(swipe.dx) >= SWIPE_DISTANCE && swipe.peak > 4 && speed < swipe.peak * RELEASE_SLOWDOWN) {
      release();
      return;
    }
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, RELEASE_PAUSE);
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
