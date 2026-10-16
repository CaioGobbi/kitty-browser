'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, components, ipcMain, net, protocol, session, shell } = require('electron');

const { data, initData, flushData, engine, hostOf, isInternal, SEARCH_ENGINES, DNS_PROVIDERS, EDITABLE_SETTINGS } = require('./data');
const { registry } = require('./registry');
const privacy = require('./privacy');
const downloads = require('./downloads');
const lists = require('./lists');
const updater = require('./updater');
const gestures = require('./gestures');
const importer = require('./importer');
const bookmarkEdits = require('./bookmarks');
const passwords = require('./passwords');
const menus = require('./menus');
const { KittyWindow, hooks, NEW_TAB_URL } = require('./window');
const tabdrag = require('./tabdrag');

app.setName('Kitty');
// A throwaway profile for development and tests: KITTY_PROFILE=/tmp/x npm start
if (process.env.KITTY_PROFILE) app.setPath('userData', path.resolve(process.env.KITTY_PROFILE));
if (process.platform === 'win32') app.setAppUserModelId('app.kitty.browser');

// One Kitty per profile: on Windows every link opened from another app starts
// a new process, which hands its URL to the running Kitty and exits.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

// Settings are read before startup: some only apply as Chromium switches.
initData(app.getPath('userData'));
bookmarkEdits.ensureFolders(); // folders of older imports become items
if (data.settings.get('blockThirdPartyCookies')) {
  // Chromium's own third-party cookie blocking (the one Chrome is testing).
  // Unlike header filtering, it also stops cookies that scripts inside
  // third-party iframes write through document.cookie.
  app.commandLine.appendSwitch('test-third-party-cookie-phaseout');
}

const PAGES_DIR = path.join(__dirname, '..', 'pages');

protocol.registerSchemesAsPrivileged([
  { scheme: 'kitty', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let quitting = false;
let ready = false;
/** Links macOS asked us to open before the app was ready. */
const pendingUrls = [];

// ---------------------------------------------------------------------------
// Profiles: the persistent one and each private window's in-memory session

function setupProfile(ses, { isPrivate }) {
  registerKittyProtocol(ses);
  privacy.setupSession(ses);
  downloads.attach(ses, { isPrivate });
}

function registerKittyProtocol(ses) {
  ses.protocol.handle('kitty', (request) => {
    const url = new URL(request.url);
    const page = url.hostname;
    const file = url.pathname === '/' || url.pathname === '' ? `${page}.html` : url.pathname.slice(1);
    const resolved = path.resolve(PAGES_DIR, file);
    if (!resolved.startsWith(PAGES_DIR + path.sep) || !fs.existsSync(resolved)) {
      return new Response('Página não encontrada', { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

/**
 * A plain Chrome user agent. Electron's default adds "Electron/x" and the app
 * name, which almost nobody sends — a tag that makes Kitty users stand out.
 * Like Chrome, it only reports the major version.
 */
function cleanUserAgent(ua) {
  return ua
    .replace(/ Electron\/\S+/, '')
    .replace(/ Kitty\/\S+/i, '')
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0');
}

/** Encrypted DNS: falls back to the system resolver only if the provider can't be reached. */
function applyDns() {
  const provider = DNS_PROVIDERS[data.settings.get('secureDns')];
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: provider ? 'automatic' : 'off',
    secureDnsServers: provider ? [provider.url] : [],
  });
}

/** Turns a favicon URL into a data: URL, fetched through the tab's session (shields apply). */
async function inlineFavicon(ses, url) {
  if (!url || url.startsWith('data:')) return url || null;
  try {
    const res = await ses.fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = res.headers.get('content-type') || '';
    const body = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !type.startsWith('image/') || body.length > 64 * 1024) return null;
    return `data:${type.split(';')[0]};base64,${body.toString('base64')}`;
  } catch {
    return null;
  }
}

const FAVICON_LIMIT = 300;

/** Keeps the latest favicon of each visited site (inlined), for the new tab page. */
async function rememberFavicon(ses, pageUrl, iconUrl) {
  const host = hostOf(pageUrl);
  if (!host || !/^https?:/.test(pageUrl)) return;
  const icons = data.favicons.get('icons');
  if (icons[host]?.src === iconUrl) return;
  const icon = await inlineFavicon(ses, iconUrl);
  if (!icon) return;
  delete icons[host]; // re-insert so the oldest hosts are dropped first
  icons[host] = { src: iconUrl, data: icon };
  const hosts = Object.keys(icons);
  for (const old of hosts.slice(0, Math.max(0, hosts.length - FAVICON_LIMIT))) delete icons[old];
  data.favicons.save();
}

// ---------------------------------------------------------------------------
// Windows

function newWindow(url) {
  const kwin = new KittyWindow();
  if (url) kwin.ui.webContents.once('did-finish-load', () => kwin.navigate(url));
  return kwin;
}

function newPrivateWindow(url) {
  const kwin = new KittyWindow({ isPrivate: true });
  if (url) kwin.ui.webContents.once('did-finish-load', () => kwin.navigate(url));
  return kwin;
}

/** Opens a kitty:// page, reusing a tab that already shows it. */
function openInternal(url) {
  const kwin = registry.current() || newWindow();
  const existing = kwin.order.find((id) => kwin.tabState(kwin.tabs.get(id)).url.startsWith(url));
  if (existing != null) {
    kwin.switchTab(existing);
    kwin.tabs.get(existing).view.webContents.reload();
  } else {
    kwin.createTab(url);
  }
}

/** URLs and .html files Windows passes on the command line (Kitty as default browser). */
function urlsFromArgv(argv) {
  return argv
    .slice(1)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => {
      if (/^https?:\/\//i.test(arg)) return arg;
      if (/\.x?html?$/i.test(arg) && fs.existsSync(arg)) return pathToFileURL(path.resolve(arg)).toString();
      return null;
    })
    .filter(Boolean);
}

/** Links from other apps (Kitty as default browser) and .html files from Finder. */
function openExternalUrl(url) {
  if (!/^(https?|file):/i.test(url)) return;
  if (!ready) return void pendingUrls.push(url);
  const kwin = registry.current({ allowPrivate: false });
  if (kwin) {
    kwin.createTab(url);
    kwin.win.focus();
  } else {
    const fresh = new KittyWindow();
    fresh.ui.webContents.once('did-finish-load', () => fresh.navigate(url));
  }
}

let sessionTimer = null;
function persistSession() {
  if (quitting) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSessionNow, 1000);
}

function saveSessionNow() {
  clearTimeout(sessionTimer);
  const windows = [...registry.windows].filter((w) => !w.isPrivate && w.order.length).map((w) => w.snapshot());
  data.session.set('windows', windows);
}

// ---------------------------------------------------------------------------
// Bookmarks

function broadcastBookmarks() {
  bookmarkEdits.ensureFolders(); // imports only record folder paths
  registry.broadcast('bookmarks:state', data.bookmarks.get('items'));
  for (const w of registry.windows) w.sendState();
}

function toggleBookmark(kwin) {
  const tab = kwin.activeTab();
  if (!tab) return;
  const { url, title, favicon } = kwin.tabState(tab);
  if (!/^https?:/.test(url)) return;
  const items = data.bookmarks.get('items');
  const existing = items.find((b) => b.url === url);
  if (existing) {
    data.bookmarks.set('items', items.filter((b) => b !== existing));
    return broadcastBookmarks();
  }
  const bookmark = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url, title, favicon: null, time: Date.now() };
  data.bookmarks.set('items', [...items, bookmark]);
  broadcastBookmarks();
  // Stored inline so the bookmarks bar never contacts the sites by itself.
  inlineFavicon(kwin.session, favicon).then((icon) => {
    if (!icon) return;
    bookmark.favicon = icon;
    data.bookmarks.save();
    broadcastBookmarks();
  });
}

/** Older bookmarks kept remote favicon URLs: inline them once. */
async function inlineBookmarkFavicons() {
  const ses = session.fromPartition('persist:kitty');
  const remote = data.bookmarks.get('items').filter((b) => b.favicon && !b.favicon.startsWith('data:'));
  for (const b of remote) b.favicon = await inlineFavicon(ses, b.favicon);
  if (remote.length) {
    data.bookmarks.save();
    broadcastBookmarks();
  }
}

function editBookmarks(op) {
  const result = bookmarkEdits.run(op);
  broadcastBookmarks();
  return result;
}

/** "Adicionar página…" and friends: the edit dialog lives in the window's UI. */
function bookmarkDialog(kwin, dialog) {
  if (dialog.mode === 'add') {
    const tab = kwin.activeTab();
    const { url, title } = tab ? kwin.tabState(tab) : {};
    if (/^https?:/.test(url || '')) Object.assign(dialog, { url, title });
  }
  kwin.ui.webContents.focus();
  kwin.sendUi('bookmark:dialog', dialog);
}

// ---------------------------------------------------------------------------
// Address bar suggestions

function localSuggestions(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const matches = (title, url) => {
    const hay = `${title} ${url}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const byUrl = new Map();
  const now = Date.now();
  for (const b of data.bookmarks.get('items')) {
    if (b.url && matches(b.title, b.url)) byUrl.set(b.url, { url: b.url, title: b.title, score: 40, bookmark: true });
  }
  for (const e of data.history.get('entries')) {
    if (!matches(e.title, e.url)) continue;
    const entry = byUrl.get(e.url) || { url: e.url, title: e.title, score: 0, bookmark: false };
    const ageDays = (now - e.time) / 86_400_000;
    entry.score += 10 / (1 + ageDays); // frecency: recent and frequent visits weigh more
    byUrl.set(e.url, entry);
  }
  const q = words[0];
  for (const entry of byUrl.values()) {
    const host = hostOf(entry.url);
    if (host.startsWith(q)) entry.score += 60;
    if (new URL(entry.url).pathname === '/') entry.score += 5;
  }
  return [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ url, title, bookmark }) => ({ type: bookmark ? 'bookmark' : 'history', url, title }));
}

async function remoteSuggestions(query) {
  const api = engine().suggest;
  if (!api || !data.settings.get('searchSuggestions')) return [];
  try {
    const res = await fetch(api + encodeURIComponent(query), { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    const list = Array.isArray(body) && Array.isArray(body[1]) ? body[1] : [];
    return list
      .filter((s) => typeof s === 'string' && s.toLowerCase() !== query.toLowerCase())
      .slice(0, 5)
      .map((text) => ({ type: 'search', text }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Settings

function isDefaultBrowser() {
  if (process.platform === 'win32') {
    // Windows keeps the user's choice per protocol; the installer registers Kitty as "KittyURL".
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'], { encoding: 'utf8', windowsHide: true });
      return out.includes('KittyURL');
    } catch {
      return false;
    }
  }
  return app.isDefaultProtocolClient('https') && app.isDefaultProtocolClient('http');
}

function settingsSnapshot() {
  const s = data.settings;
  return {
    values: Object.fromEntries(Object.keys(EDITABLE_SETTINGS).map((k) => [k, s.get(k)])),
    engines: Object.entries(SEARCH_ENGINES).map(([id, e]) => ({ id, name: e.name, suggest: !!e.suggest })),
    dnsProviders: Object.entries(DNS_PROVIDERS).map(([id, p]) => ({ id, name: p.name })),
    lists: lists.status(),
    allowlist: s.get('allowlist'),
    permissions: privacy.permissionList(),
    isDefaultBrowser: isDefaultBrowser(),
    canBeDefault: app.isPackaged,
    platform: process.platform,
    update: updater.snapshot(),
    downloadsDir: app.getPath('downloads'),
    version: app.getVersion(),
  };
}

function uiSettings() {
  return {
    showBookmarksBar: data.settings.get('showBookmarksBar'),
    engineName: engine().name,
  };
}

function broadcastSettings() {
  registry.broadcast('settings:state', uiSettings());
}

async function clearBrowsingData(kinds) {
  const ses = session.fromPartition('persist:kitty');
  if (kinds.includes('history')) {
    data.history.set('entries', []);
    data.favicons.set('icons', {});
  }
  if (kinds.includes('cookies')) await ses.clearStorageData();
  if (kinds.includes('cache')) await ses.clearCache();
  if (kinds.includes('downloads')) downloads.clearFinished();
}

// ---------------------------------------------------------------------------
// IPC

/** Only lets kitty:// pages (optionally only some of them) use an API. */
function fromPage(event, ...hosts) {
  const url = event.senderFrame?.url;
  if (!isInternal(url)) return false;
  return hosts.length === 0 || hosts.includes(new URL(url).hostname);
}

function registerIpc() {
  // ---- Browser UI (tab strip, toolbar, bars). Each call targets its window.
  const ui = (channel, fn) =>
    ipcMain.on(channel, (event, ...args) => {
      const kwin = registry.byUi(event.sender);
      if (kwin) fn(kwin, ...args);
    });
  ui('ui:ready', (w) => {
    w.sendState();
    w.sendUi('bookmarks:state', data.bookmarks.get('items'));
    w.sendUi('downloads:state', downloads.list());
    w.sendUi('settings:state', uiSettings());
    w.sendUi('ui:fullscreen', w.win.isFullScreen());
    w.sendUi('update:state', updater.snapshot());
  });
  ui('update:install', () => updater.install());
  ui('ui:chrome', (w, layout) => w.setChrome(layout || {}));
  ui('tab:new', (w) => w.createTab());
  ui('tab:close', (w, id) => w.closeTab(id ?? w.activeId));
  ui('tab:switch', (w, id) => w.switchTab(id));
  ui('tab:move', (w, id, index) => w.moveTab(id, Number(index)));
  ui('tab:menu', (w, id) => menus.tabContextMenu(w, id));
  ui('tab:drag-out', (w, id, grab) => tabdrag.start(w, Number(id), grab));
  ui('tab:drag-move', () => tabdrag.move());
  ui('tab:drag-end', () => tabdrag.end());
  ui('tab:drag-cancel', () => tabdrag.cancel());
  ui('tab:mute', (w, id) => w.toggleMute(id));
  ui('nav:go', (w, input) => w.navigate(input));
  ui('nav:back', (w) => w.activeWebContents()?.navigationHistory.goBack());
  ui('nav:forward', (w) => w.activeWebContents()?.navigationHistory.goForward());
  ui('nav:reload', (w) => w.reload());
  ui('nav:stop', (w) => w.activeWebContents()?.stop());
  ui('shield:toggle', (w) => {
    const wc = w.activeWebContents();
    if (!wc || isInternal(wc.getURL())) return;
    const host = hostOf(wc.getURL());
    if (!host) return;
    const allowlist = data.settings.get('allowlist');
    data.settings.set('allowlist', allowlist.includes(host) ? allowlist.filter((h) => h !== host) : [...allowlist, host]);
    wc.reload();
  });
  ui('open:internal', (_w, page) => {
    if (['history', 'bookmarks', 'settings', 'passwords'].includes(page)) openInternal(`kitty://${page}`);
  });
  ui('window:private', () => newPrivateWindow());
  ui('window:new', () => newWindow());
  ui('find:query', (w, { text, forward, next } = {}) => w.find(text, { forward: forward !== false, next: !!next }));
  ui('find:stop', (w) => w.stopFind());
  ui('perm:answer', (w, { tabId, promptId, allow } = {}) => w.answerPrompt(tabId, promptId, allow));
  ui('pw:answer', (w, answer) => passwords.answerOffer(w, answer));
  ui('bookmark:toggle', (w) => toggleBookmark(w));
  ui('bookmark:open', (w, { id, newTab } = {}) => {
    const b = data.bookmarks.get('items').find((x) => x.id === id);
    if (!b?.url) return;
    if (newTab) w.createTab(b.url, { activate: false });
    else w.navigate(b.url);
  });
  ui('bookmark:menu', (w, { id, parentId } = {}) => menus.bookmarkContextMenu(w, id, parentId));
  ipcMain.handle('ui:bookmark-op', (event, op) => (registry.byUi(event.sender) ? editBookmarks(op) : null));
  ui('downloads:action', (_w, { id, what } = {}) => downloads.action(id, what));
  ui('downloads:clear', () => downloads.clearFinished());

  // Two-finger swipe and mouse buttons, reported by preload-page.js.
  ipcMain.on('gesture:navigate', (event, direction) => {
    const found = registry.tabByWebContentsId(event.sender.id);
    if (!found || found.tab.id !== found.kwin.activeId) return;
    // macOS momentum keeps scrolling into the page we just navigated to, which
    // would read as a second swipe and go back twice. Ignore it for a moment.
    const now = Date.now();
    if (now - (found.tab.lastGestureAt || 0) < 900) return;
    found.tab.lastGestureAt = now;
    if (direction === 'back') found.kwin.goBack();
    if (direction === 'forward') found.kwin.goForward();
  });

  ipcMain.handle('ui:suggest', async (event, query) => {
    const kwin = registry.byUi(event.sender);
    const text = String(query || '').trim().slice(0, 200);
    if (!kwin || !text) return { query: text, items: [] };
    const local = localSuggestions(text);
    // Private windows don't send keystrokes to the search engine.
    const remote = kwin.isPrivate ? [] : await remoteSuggestions(text);
    return { query: text, items: [...local, ...remote] };
  });

  // ---- Internal pages
  ipcMain.handle('kitty:context', (event) => {
    if (!fromPage(event)) return null;
    const found = registry.tabByWebContentsId(event.sender.id);
    const e = engine();
    return { isPrivate: !!found?.kwin.isPrivate, engineName: e.name, searchUrl: e.search };
  });
  ipcMain.handle('kitty:history', (event, query = '') => {
    if (!fromPage(event, 'history')) return [];
    const q = String(query).toLowerCase();
    const entries = data.history.get('entries');
    const found = q ? entries.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)) : entries;
    return found.slice(0, 500);
  });
  ipcMain.handle('kitty:history-remove', (event, time) => {
    if (!fromPage(event, 'history')) return;
    data.history.set('entries', data.history.get('entries').filter((e) => e.time !== time));
  });
  ipcMain.handle('kitty:history-clear', (event) => {
    if (!fromPage(event, 'history')) return;
    data.history.set('entries', []);
    data.favicons.set('icons', {});
  });
  ipcMain.handle('kitty:stats', (event) => {
    if (!fromPage(event, 'newtab')) return null;
    const found = registry.tabByWebContentsId(event.sender.id);
    const recent = [];
    const seen = new Set();
    if (!found?.kwin.isPrivate) {
      for (const e of data.history.get('entries')) {
        const host = hostOf(e.url);
        if (seen.has(host)) continue;
        seen.add(host);
        recent.push({ host, url: e.url, title: e.title, favicon: data.favicons.get('icons')[host]?.data || null });
        if (recent.length === 8) break;
      }
    }
    return { blockedTotal: data.settings.get('blockedTotal'), recent };
  });
  ipcMain.handle('kitty:bookmarks', (event) => (fromPage(event, 'bookmarks') ? data.bookmarks.get('items') : []));
  ipcMain.handle('kitty:bookmark-op', (event, op) => (fromPage(event, 'bookmarks') ? editBookmarks(op) : null));
  ipcMain.handle('kitty:settings', (event) => (fromPage(event, 'settings') ? settingsSnapshot() : null));
  ipcMain.handle('kitty:settings-set', (event, key, value) => {
    if (!fromPage(event, 'settings') || !EDITABLE_SETTINGS[key]?.(value)) return settingsSnapshot();
    data.settings.set(key, value);
    if (key === 'secureDns') applyDns();
    broadcastSettings();
    return settingsSnapshot();
  });
  ipcMain.handle('kitty:settings-update-lists', async (event) => {
    if (!fromPage(event, 'settings')) return null;
    await lists.refresh({ force: true });
    return settingsSnapshot();
  });
  ipcMain.handle('kitty:settings-check-update', (event) => {
    if (!fromPage(event, 'settings')) return null;
    updater.check();
    return settingsSnapshot();
  });
  ipcMain.handle('kitty:threat-bypass', (event, url) => {
    if (!fromPage(event, 'blocked') || !/^https?:/.test(String(url))) return false;
    return privacy.bypassThreat(String(url));
  });
  ipcMain.handle('kitty:settings-allowlist-remove', (event, host) => {
    if (!fromPage(event, 'settings')) return null;
    data.settings.set('allowlist', data.settings.get('allowlist').filter((h) => h !== host));
    for (const w of registry.windows) w.sendState();
    return settingsSnapshot();
  });
  ipcMain.handle('kitty:settings-permission-remove', (event, origin, permission) => {
    if (!fromPage(event, 'settings')) return null;
    privacy.removePermission(String(origin), String(permission));
    return settingsSnapshot();
  });
  ipcMain.handle('kitty:settings-clear', async (event, kinds) => {
    if (!fromPage(event, 'settings') || !Array.isArray(kinds)) return null;
    await clearBrowsingData(kinds.map(String));
    return settingsSnapshot();
  });
  ipcMain.handle('kitty:settings-default-browser', (event) => {
    if (!fromPage(event, 'settings')) return null;
    if (!app.isPackaged) return settingsSnapshot();
    if (process.platform === 'win32') {
      // Windows 10/11 only let the user pick the default browser, in Settings.
      shell.openExternal('ms-settings:defaultapps?registeredAppUser=Kitty');
    } else {
      app.setAsDefaultProtocolClient('http');
      app.setAsDefaultProtocolClient('https');
    }
    return settingsSnapshot();
  });
  ipcMain.handle('kitty:settings-open-downloads', (event) => {
    if (fromPage(event, 'settings')) shell.openPath(app.getPath('downloads'));
  });
  ipcMain.handle('kitty:import-sources', (event) => {
    if (!fromPage(event, 'settings')) return { sources: [], blocked: [] };
    return {
      sources: importer.listSources().map(({ id, name }) => ({ id, name })),
      blocked: importer.blockedBrowsers(),
    };
  });
  ipcMain.handle('kitty:import-open-privacy', (event) => {
    // macOS only lets Kitty read other browsers' data with Full Disk Access.
    if (fromPage(event, 'settings') && process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
    }
  });
  ipcMain.handle('kitty:import-run', (event, id, kinds) => {
    if (!fromPage(event, 'settings') || !Array.isArray(kinds)) return null;
    try {
      const result = importer.importFrom(String(id), kinds.map(String), { bookmarks: data.bookmarks, history: data.history });
      broadcastBookmarks(); // even with nothing new, older imports may have gained folders
      return result;
    } catch (err) {
      console.error('import failed', err);
      return { error: err.message };
    }
  });
}

// ---------------------------------------------------------------------------

app.on('open-url', (event, url) => {
  event.preventDefault();
  openExternalUrl(url);
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openExternalUrl(pathToFileURL(filePath).toString());
});

app.on('second-instance', (_event, argv) => {
  const urls = urlsFromArgv(argv);
  if (urls.length) return urls.forEach(openExternalUrl);
  const kwin = registry.current({ allowPrivate: false });
  if (kwin) {
    if (kwin.win.isMinimized()) kwin.win.restore();
    kwin.win.focus();
  } else if (ready) {
    new KittyWindow();
  }
});

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  // Castlabs Electron ships Widevine as a component; DRM video only plays
  // once it is installed and ready.
  if (components) {
    await components.whenReady().catch((err) => console.error('[kitty] Widevine indisponível:', err));
  }

  downloads.loadLog();
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  applyDns();

  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock.setIcon(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  }

  hooks.setupProfile = setupProfile;
  hooks.onChange = persistSession;
  hooks.contextMenu = menus.pageContextMenu;
  hooks.shortcut = menus.handleShortcut;
  hooks.favicon = rememberFavicon;
  hooks.tabCreated = passwords.watchTab;
  hooks.passwordOffer = passwords.offerFor;
  Object.assign(menus.actions, {
    newWindow,
    newPrivateWindow,
    openInternal,
    toggleBookmark,
    editBookmarks,
    bookmarkDialog,
    toggleBookmarksBar: () => {
      data.settings.set('showBookmarksBar', !data.settings.get('showBookmarksBar'));
      broadcastSettings();
    },
  });

  gestures.init();
  setupProfile(session.fromPartition('persist:kitty'), { isPrivate: false });
  privacy.registerPrivacyIpc();
  registerIpc();
  passwords.registerIpc({ fromPage, openPasswords: () => openInternal('kitty://passwords') });
  menus.buildAppMenu();
  const listsReady = lists.init();

  const saved = data.settings.get('restoreSession') ? data.session.get('windows') : [];
  if (saved.length) for (const restore of saved) new KittyWindow({ restore });
  else new KittyWindow();

  ready = true;
  updater.init({
    onBeforeInstall: () => {
      saveSessionNow();
      quitting = true;
      flushData();
    },
  });
  if (process.platform !== 'darwin') pendingUrls.push(...urlsFromArgv(process.argv));
  for (const url of pendingUrls.splice(0)) openExternalUrl(url);

  app.on('activate', () => {
    if (registry.windows.size === 0) new KittyWindow();
  });
  await listsReady;
  inlineBookmarkFavicons();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (data.session && !quitting) saveSessionNow();
  quitting = true;
  flushData();
});

module.exports = { NEW_TAB_URL };
