'use strict';

// macOS trackpad gesture phases, from the native swipe-phase module. Pages only
// see wheel deltas, which look the same whether the fingers are resting on the
// trackpad or have already left it. AppKit knows, so the swipe-to-navigate
// arrow can stay up while the fingers are down and fire exactly on release.
const path = require('node:path');
const { ipcMain } = require('electron');

const { registry } = require('./registry');

const PHASE = { began: 1, stationary: 2, changed: 4, ended: 8, cancelled: 16, mayBegin: 32 };

let available = false;
/** The tab receiving the current gesture (fixed when the fingers touch down). */
let target = null;

function send(phase) {
  if (target && !target.isDestroyed()) target.send('gesture:phase', phase);
}

function onScroll(event) {
  if (event.momentumPhase) return; // inertia after the fingers left: not part of the gesture
  if (event.phase & (PHASE.mayBegin | PHASE.began)) {
    if (event.phase & PHASE.began || !target) {
      target = registry.current()?.activeWebContents() || null;
      send('began');
    }
  } else if (event.phase & PHASE.ended) {
    send('ended');
    target = null;
  } else if (event.phase & PHASE.cancelled) {
    send('cancelled');
    target = null;
  }
}

function init() {
  if (process.platform !== 'darwin') return;
  try {
    // Built by `npm run build:native`; unpacked from the asar in the packaged app.
    const native = require(path.join(__dirname, 'native', 'swipe_phase.node'));
    native.start(onScroll);
    available = true;
  } catch (err) {
    console.error('[kitty] Fases de gesto indisponíveis (usando detecção aproximada):', err.message);
  }
}

// Asked synchronously by preload-page.js when a page loads.
ipcMain.on('gesture:native', (event) => {
  event.returnValue = available;
});

module.exports = { init };
