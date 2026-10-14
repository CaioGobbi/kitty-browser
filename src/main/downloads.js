'use strict';

// Download manager: saves straight to ~/Downloads (like Chrome), tracks
// progress for the toolbar panel and keeps a short log of finished downloads.
const path = require('node:path');
const fs = require('node:fs');
const { app, shell, BaseWindow } = require('electron');

const { data } = require('./data');
const { registry } = require('./registry');

const LOG_LIMIT = 100;

/** Live and recent downloads, newest first. */
let items = [];
/** @type {Map<string, Electron.DownloadItem>} */
const live = new Map();
/** URLs the user asked to "save as…": these get a save dialog. */
const saveAsUrls = new Set();
let nextId = 1;
let broadcastTimer = null;

function publicItem(d) {
  const { item, ...rest } = d;
  return rest;
}

function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    registry.broadcast('downloads:state', items.map(publicItem));
    updateProgressBar();
  }, 200);
}

function updateProgressBar() {
  const active = items.filter((d) => d.state === 'progressing' && d.total > 0);
  const total = active.reduce((sum, d) => sum + d.total, 0);
  const received = active.reduce((sum, d) => sum + d.received, 0);
  const progress = active.length ? received / total : -1;
  for (const win of BaseWindow.getAllWindows()) win.setProgressBar(progress);
}

function persist() {
  const log = items.filter((d) => !d.private && d.state !== 'progressing').slice(0, LOG_LIMIT);
  data.downloads.set('items', log.map(publicItem));
}

/** ~/Downloads/name.ext, or name (1).ext, name (2).ext… if taken. */
function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext) || 'download';
  let candidate = path.join(dir, `${base}${ext}`);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${base} (${n})${ext}`);
  return candidate;
}

function attach(ses, { isPrivate }) {
  ses.on('will-download', (_event, item) => {
    const id = String(nextId++);
    const url = item.getURL();
    if (saveAsUrls.delete(url)) {
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    } else {
      item.setSavePath(uniquePath(app.getPath('downloads'), item.getFilename()));
    }

    const entry = {
      id,
      url,
      filename: item.getFilename(),
      path: item.getSavePath(),
      state: 'progressing',
      paused: false,
      received: 0,
      total: item.getTotalBytes(),
      startTime: Date.now(),
      private: isPrivate,
    };
    items.unshift(entry);
    live.set(id, item);
    registry.broadcast('downloads:started', id);
    broadcast();

    item.on('updated', (_e, state) => {
      entry.path = item.getSavePath() || entry.path;
      entry.filename = path.basename(entry.path) || entry.filename;
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      entry.paused = item.isPaused();
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      broadcast();
    });
    item.once('done', (_e, state) => {
      live.delete(id);
      entry.path = item.getSavePath() || entry.path;
      entry.filename = path.basename(entry.path) || entry.filename;
      entry.received = item.getReceivedBytes();
      entry.state = state; // completed | cancelled | interrupted
      if (state === 'completed' && process.platform === 'darwin') app.dock.downloadFinished(entry.path);
      persist();
      broadcast();
    });
  });
}

function saveAs(webContents, url) {
  saveAsUrls.add(url);
  webContents.downloadURL(url);
}

function action(id, what) {
  const entry = items.find((d) => d.id === String(id));
  if (!entry) return;
  const item = live.get(entry.id);
  switch (what) {
    case 'open':
      if (entry.state === 'completed') shell.openPath(entry.path);
      break;
    case 'show':
      if (fs.existsSync(entry.path)) shell.showItemInFolder(entry.path);
      else shell.openPath(app.getPath('downloads'));
      break;
    case 'pause':
      item?.pause();
      break;
    case 'resume':
      if (item?.canResume()) item.resume();
      break;
    case 'cancel':
      item?.cancel();
      break;
    case 'remove':
      if (item) item.cancel();
      items = items.filter((d) => d !== entry);
      persist();
      break;
    default:
      return;
  }
  broadcast();
}

function clearFinished() {
  items = items.filter((d) => d.state === 'progressing');
  persist();
  broadcast();
}

function list() {
  return items.map(publicItem);
}

function loadLog() {
  items = data.downloads.get('items').map((d) => ({
    ...d,
    state: d.state === 'completed' && !fs.existsSync(d.path) ? 'removed' : d.state,
  }));
  nextId = items.reduce((max, d) => Math.max(max, Number(d.id) || 0), 0) + 1;
}

module.exports = { attach, saveAs, action, clearFinished, list, loadLog };
