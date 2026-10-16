'use strict';

// Chrome extensions: installed from the Chrome Web Store (its "Adicionar ao
// Chrome" button works in Kitty), kept in <userData>/Extensions/<id>/<version>_0,
// switched on and off, pinned to the toolbar and removed. Extensions only run in
// the persistent profile, never in private windows (like Chrome's default for
// incognito). Electron provides part of the chrome.* APIs; extension-api.js and
// preload-extensions.js fill in the rest.
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, ipcMain, webContents } = require('electron');
const webStore = require('electron-chrome-web-store');

const api = require('./extension-api');
const { data, allowed } = require('./data');
const { registry } = require('./registry');

const WEB_STORE = 'https://chromewebstore.google.com/';
const UPDATE_EVERY = 5 * 60 * 60 * 1000;

/** @type {Electron.Session | null} */
let ses = null;
let extDir = '';
/** Extensions the person just agreed to add: their window shows the extensions panel once they load. */
const justInstalled = new Map(); // id → KittyWindow

const disabledIds = () => data.settings.get('extensionsDisabled');
const pinnedIds = () => data.settings.get('extensionsPinned');

// ---------------------------------------------------------------------------
// What is on disk

/** Each installed extension's newest version: [{ id, path, manifest }]. */
function discover() {
  let ids = [];
  try {
    ids = fs.readdirSync(extDir).filter((id) => /^[a-p]{32}$/.test(id));
  } catch {
    return [];
  }
  const found = [];
  for (const id of ids) {
    const versions = [];
    for (const dir of fs.readdirSync(path.join(extDir, id), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const full = path.join(extDir, id, dir.name);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(full, 'manifest.json'), 'utf8'));
        versions.push({ id, path: full, manifest });
      } catch {}
    }
    const newer = (a, b) => {
      const pa = String(a.manifest.version).split('.').map(Number);
      const pb = String(b.manifest.version).split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return 0;
    };
    if (versions.length) found.push(versions.sort(newer)[0]);
  }
  return found;
}

/** A manifest text in the person's language ("__MSG_name__" placeholders). */
function localized(entry, key) {
  const value = entry.manifest[key] || '';
  const m = /^__MSG_(\w+)__$/.exec(value);
  if (!m) return value;
  const wanted = m[1].toLowerCase();
  const locale = app.getLocale().replace('-', '_');
  const candidates = [locale, locale.split('_')[0], 'pt_BR', entry.manifest.default_locale, 'en'].filter(Boolean);
  for (const lang of candidates) {
    try {
      const messages = JSON.parse(fs.readFileSync(path.join(entry.path, '_locales', lang, 'messages.json'), 'utf8'));
      const hit = Object.entries(messages).find(([k]) => k.toLowerCase() === wanted);
      if (hit) return hit[1].message;
    } catch {}
  }
  return value;
}

async function load(entry) {
  const ext = await ses.extensions.loadExtension(entry.path);
  if (ext.manifest.manifest_version >= 3 && ext.manifest.background?.service_worker) {
    await ses.serviceWorkers.startWorkerForScope(`chrome-extension://${ext.id}/`).catch(() => {});
  }
  return ext;
}

// ---------------------------------------------------------------------------
// Installing from the Chrome Web Store

/** What an extension may do, in the words Chrome uses when installing it. */
function warnings(manifest) {
  const perms = new Set([...(manifest.permissions || []), ...(manifest.optional_permissions || [])]);
  const hosts = [...(manifest.host_permissions || []), ...(manifest.permissions || []).filter((p) => p.includes('://') || p === '<all_urls>')];
  for (const cs of manifest.content_scripts || []) hosts.push(...(cs.matches || []));
  const out = [];
  const everywhere = hosts.some((h) => h === '<all_urls>' || /^(\*|https?):\/\/\*\//.test(h));
  if (everywhere) out.push('Ler e alterar todos os seus dados em todos os sites');
  else if (hosts.length) {
    const names = [...new Set(hosts.map((h) => (/^[^:]+:\/\/([^/]+)/.exec(h) || [])[1]).filter(Boolean))];
    out.push(`Ler e alterar seus dados em ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` e mais ${names.length - 4} sites` : ''}`);
  }
  if (perms.has('tabs') || perms.has('webNavigation') || perms.has('history')) out.push('Ler seu histórico de navegação');
  if (perms.has('bookmarks')) out.push('Ler e alterar seus favoritos');
  if (perms.has('clipboardRead')) out.push('Ler dados que você copia e cola');
  if (perms.has('clipboardWrite')) out.push('Alterar dados que você copia e cola');
  if (perms.has('downloads')) out.push('Gerenciar seus downloads');
  if (perms.has('notifications')) out.push('Mostrar notificações');
  if (perms.has('privacy')) out.push('Alterar configurações de privacidade');
  if (perms.has('management')) out.push('Gerenciar suas extensões');
  if (perms.has('nativeMessaging')) out.push('Se comunicar com aplicativos instalados (não funciona no Kitty)');
  return out;
}

/** The Web Store's "Adicionar ao Chrome": asks first, in the tab's window. */
async function confirmInstall({ id, localizedName, manifest, icon, frame }) {
  const wc = frame && !frame.isDestroyed() ? webContents.fromFrame(frame) : null;
  const found = wc && registry.tabByWebContentsId(wc.id);
  const kwin = found?.kwin || registry.current({ allowPrivate: false });
  const list = warnings(manifest);
  const options = {
    type: 'question',
    buttons: ['Adicionar extensão', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    message: `Adicionar “${localizedName}” ao Kitty?`,
    detail: `${list.length ? `Ela poderá:\n${list.map((w) => `•  ${w}`).join('\n')}\n\n` : ''}O Kitty roda extensões do Chrome com algumas limitações: se algo não funcionar, dá para desligá-la ou removê-la em Extensões.`,
  };
  if (icon && !icon.isEmpty()) options.icon = icon.resize({ width: 64, height: 64 });
  const { response } = kwin ? await dialog.showMessageBox(kwin.win, options) : await dialog.showMessageBox(options);
  if (response !== 0) return { action: 'deny' };
  if (kwin) justInstalled.set(id, kwin);
  return { action: 'allow' };
}

let updateTimer = null;
function scheduleUpdates() {
  clearInterval(updateTimer);
  const check = () => {
    if (!allowed('autoUpdateExtensions') || !ses.extensions.getAllExtensions().length) return;
    webStore.updateExtensions(ses).catch((err) => console.error('[kitty] extension updates', err));
  };
  setTimeout(check, 60 * 1000);
  updateTimer = setInterval(check, UPDATE_EVERY);
}

// ---------------------------------------------------------------------------
// Managing them

function list() {
  const loaded = new Map(ses.extensions.getAllExtensions().map((e) => [e.id, e]));
  return discover().map((entry) => {
    const ext = loaded.get(entry.id);
    return {
      id: entry.id,
      name: ext?.name || localized(entry, 'name') || entry.id,
      description: localized(entry, 'description'),
      version: entry.manifest.version,
      enabled: !!ext,
      pinned: pinnedIds().includes(entry.id),
      icon: api.extensionIcon(ext || { id: entry.id, path: entry.path, version: entry.manifest.version, manifest: entry.manifest }, 48),
      hasOptions: !!(entry.manifest.options_ui?.page || entry.manifest.options_page),
      storeUrl: `${WEB_STORE}detail/${entry.id}`,
    };
  });
}

async function setEnabled(id, enabled) {
  const disabled = disabledIds().filter((x) => x !== id);
  if (enabled) {
    data.settings.set('extensionsDisabled', disabled);
    const entry = discover().find((e) => e.id === id);
    if (entry && !ses.extensions.getExtension(id)) await load(entry).catch((err) => console.error('[kitty] extension', err));
  } else {
    data.settings.set('extensionsDisabled', [...disabled, id]);
    if (ses.extensions.getExtension(id)) ses.extensions.removeExtension(id);
  }
  broadcast();
}

function setPinned(id, pinned) {
  const others = pinnedIds().filter((x) => x !== id);
  data.settings.set('extensionsPinned', pinned ? [...others, id] : others);
  broadcast();
}

async function uninstall(id) {
  if (!/^[a-p]{32}$/.test(id)) return;
  await webStore.uninstallExtension(id, { session: ses, extensionsPath: extDir });
  data.settings.set('extensionsPinned', pinnedIds().filter((x) => x !== id));
  data.settings.set('extensionsDisabled', disabledIds().filter((x) => x !== id));
  broadcast();
}

async function confirmUninstall(kwin, id) {
  const item = list().find((e) => e.id === id);
  if (!item) return;
  const { response } = await dialog.showMessageBox(kwin.win, {
    type: 'warning',
    buttons: ['Remover', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    message: `Remover “${item.name}”?`,
    detail: 'A extensão e os dados que ela guardou no Kitty serão apagados.',
  });
  if (response === 0) await uninstall(id);
}

function openStore(kwin = registry.current({ allowPrivate: false })) {
  if (kwin && !kwin.isPrivate) {
    kwin.createTab(WEB_STORE);
    kwin.win.focus();
  } else api.hooks.newWindow(WEB_STORE);
}

// ---------------------------------------------------------------------------
// Toolbar state, sent to every window

let broadcastQueued = false;
function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    for (const kwin of registry.windows) sendState(kwin);
  });
}

function sendState(kwin) {
  kwin.sendUi('extensions:state', kwin.isPrivate ? null : api.toolbarState(kwin));
}

/** Right-click on an extension's button. */
function actionMenu(kwin, id) {
  const { Menu } = require('electron');
  const ext = ses.extensions.getExtension(id);
  if (!ext) return;
  const pinned = pinnedIds().includes(id);
  const tab = kwin.activeTab();
  const template = [{ label: ext.name, enabled: false }, ...api.contextMenuItems({ kwin, tab, target: 'action', onlyExt: id })];
  template.push(
    { type: 'separator' },
    { label: pinned ? 'Desafixar da barra' : 'Fixar na barra', click: () => setPinned(id, !pinned) },
    { label: 'Opções', enabled: !!api.optionsPage(ext), click: () => api.openOptions(ext) },
    { label: 'Gerenciar extensões', click: () => hooks.openInternal('kitty://extensions') },
    { type: 'separator' },
    { label: 'Remover do Kitty…', click: () => confirmUninstall(kwin, id) },
  );
  Menu.buildFromTemplate(template).popup({ window: kwin.win });
}

const hooks = { openInternal() {} };

// ---------------------------------------------------------------------------

/** Loads the installed extensions into the persistent profile. */
async function init(session, { newWindow, adoptWindow, openInternal }) {
  ses = session;
  extDir = path.join(app.getPath('userData'), 'Extensions');
  hooks.openInternal = openInternal;
  Object.assign(api.hooks, {
    newWindow,
    adoptWindow,
    stateChanged: broadcast,
    isPinned: (id) => pinnedIds().includes(id),
  });

  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-extensions.js') });
  ses.registerPreloadScript({ type: 'service-worker', filePath: path.join(__dirname, 'preload-extensions.js') });
  api.init(ses);

  ses.extensions.on('extension-loaded', (_e, ext) => {
    if (disabledIds().includes(ext.id)) data.settings.set('extensionsDisabled', disabledIds().filter((x) => x !== ext.id));
    const kwin = justInstalled.get(ext.id);
    justInstalled.delete(ext.id);
    if (kwin && registry.windows.has(kwin)) {
      if (ext.manifest.manifest_version >= 3 && ext.manifest.background?.service_worker) {
        ses.serviceWorkers.startWorkerForScope(`chrome-extension://${ext.id}/`).catch(() => {});
      }
      setImmediate(() => kwin.sendUi('extensions:installed', ext.id));
    }
    broadcast();
  });
  ses.extensions.on('extension-unloaded', () => broadcast());

  await webStore.installChromeWebStore({
    session: ses,
    extensionsPath: extDir,
    loadExtensions: false,
    autoUpdate: false,
    beforeInstall: confirmInstall,
  });

  const skip = new Set(disabledIds());
  for (const entry of discover()) {
    if (skip.has(entry.id)) continue;
    await load(entry).catch((err) => console.error(`[kitty] extensão ${entry.id} não carregou:`, err.message));
  }
  scheduleUpdates();
}

function registerIpc({ fromPage }) {
  const ui = (channel, fn) =>
    ipcMain.on(channel, (event, ...args) => {
      const kwin = registry.byUi(event.sender);
      if (kwin && !kwin.isPrivate) fn(kwin, ...args);
    });
  ui('ext:ui-ready', (w) => sendState(w));
  ui('ext:ui-click', (w, { id, rect } = {}) => api.clickAction(w, String(id), rect));
  ui('ext:ui-menu', (w, id) => actionMenu(w, String(id)));
  ui('ext:ui-pin', (w, { id, pinned } = {}) => setPinned(String(id), !!pinned));
  ui('ext:ui-manage', () => hooks.openInternal('kitty://extensions'));
  ui('ext:ui-store', (w) => openStore(w));

  const page = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!fromPage(event, 'extensions')) return null;
      await fn(event, ...args);
      return snapshot();
    });
  page('kitty:extensions', () => {});
  page('kitty:extensions-enable', (_e, id, on) => setEnabled(String(id), !!on));
  page('kitty:extensions-pin', (_e, id, on) => setPinned(String(id), !!on));
  page('kitty:extensions-remove', (_e, id) => uninstall(String(id)));
  page('kitty:extensions-options', (_e, id) => {
    const ext = ses.extensions.getExtension(String(id));
    if (ext) api.openOptions(ext);
  });
  page('kitty:extensions-store', () => openStore());
  page('kitty:extensions-update', async () => {
    await webStore.updateExtensions(ses).catch((err) => console.error('[kitty] extension updates', err));
  });
  page('kitty:extensions-auto-update', (_e, on) => data.settings.set('autoUpdateExtensions', !!on));
}

function snapshot() {
  return { extensions: list(), autoUpdate: !!data.settings.get('autoUpdateExtensions'), storeUrl: WEB_STORE };
}

/** The page's right-click menu gets the extensions' items. */
function pageMenuItems(kwin, tab, params) {
  if (!ses || kwin.isPrivate) return [];
  return api.contextMenuItems({ kwin, tab, params });
}

module.exports = {
  init,
  registerIpc,
  broadcast,
  browserChanged: api.browserChanged,
  watchNavigation: api.watchNavigation,
  pageMenuItems,
  openStore,
  WEB_STORE,
};
