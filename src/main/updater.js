'use strict';

// Automatic updates on Windows, from the GitHub Releases of
// caiogobbi/kitty-browser (configured in package.json → build.publish).
// New versions download in the background and install when Kitty restarts.
// macOS needs a paid Apple Developer ID signature for this, so it's off there.
const { app } = require('electron');

const { registry } = require('./registry');

const CHECK_EVERY = 4 * 3_600_000;

const state = {
  supported: process.platform === 'win32' && app.isPackaged,
  status: 'idle', // idle | checking | downloading | ready | latest | error
  version: app.getVersion(),
  available: null, // version being downloaded / ready to install
  progress: 0,
  error: null,
  checkedAt: null,
};

let autoUpdater = null;
let beforeInstall = () => {};

function publish() {
  registry.broadcast('update:state', { ...state });
}

function set(changes) {
  Object.assign(state, changes);
  publish();
}

function init({ onBeforeInstall } = {}) {
  if (onBeforeInstall) beforeInstall = onBeforeInstall;
  if (!state.supported) return;

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', available: info.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', available: info.version, checkedAt: Date.now() }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err?.message || err).split('\n')[0] }));

  // First check shortly after startup, then every few hours.
  setTimeout(check, 15_000);
  setInterval(check, CHECK_EVERY);
}

function check() {
  if (!autoUpdater || state.status === 'downloading' || state.status === 'ready') return;
  autoUpdater.checkForUpdates().catch(() => {}); // errors arrive through the 'error' event
}

/** Restarts into the downloaded version. */
function install() {
  if (!autoUpdater || state.status !== 'ready') return;
  beforeInstall(); // save the open tabs before windows start closing
  autoUpdater.quitAndInstall(true, true); // silent installer, reopen Kitty afterwards
}

function snapshot() {
  return { ...state };
}

module.exports = { init, check, install, snapshot };
