'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  ipcMain,
  net,
  protocol,
  session,
} = require('electron');
const { ElectronBlocker, fromElectronDetails } = require('@ghostery/adblocker-electron');

const { Store } = require('./store');

app.setName('Kitty');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const UI_DIR = path.join(__dirname, '..', 'ui');
const CHROME_HEIGHT = 84; // tab strip (40) + toolbar (44)
const NEW_TAB_URL = 'kitty://newtab';
const SEARCH_URL = 'https://duckduckgo.com/?q=';
const HISTORY_LIMIT = 5000;

protocol.registerSchemesAsPrivileged([
  { scheme: 'kitty', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** @type {Store} */ let settings;
/** @type {Store} */ let history;
/** @type {ElectronBlocker | null} */ let blocker = null;
/** @type {BrowserWindow | null} */ let win = null;

/**
 * @typedef {{ id: number, view: WebContentsView, blocked: Set<string>, favicon: string | null }} Tab
 * @type {Map<number, Tab>}
 */
const tabs = new Map();
let tabOrder = [];
let activeTabId = null;

// ---------------------------------------------------------------------------
// Helpers

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isInternal(url) {
  return typeof url === 'string' && url.startsWith('kitty://');
}

function isShieldUp(url) {
  const host = hostOf(url);
  return !settings.get('allowlist').includes(host);
}

/** Turns whatever the user typed in the address bar into a URL. */
function resolveInput(input) {
  const text = String(input || '').trim();
  if (!text) return NEW_TAB_URL;
  if (/^(https?|kitty|file):\/\//i.test(text) || /^about:/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) {
    return `http://${text}`;
  }
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`;
  return SEARCH_URL + encodeURIComponent(text);
}

// ---------------------------------------------------------------------------
// Tabs

function tabState(tab) {
  const wc = tab.view.webContents;
  const url = wc.getURL();
  return {
    id: tab.id,
    title: wc.getTitle() || (isInternal(url) ? 'Nova aba' : url),
    url,
    favicon: tab.favicon,
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    blocked: tab.blocked.size,
    shieldUp: isInternal(url) ? true : isShieldUp(url),
    internal: isInternal(url),
  };
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('tabs:state', {
    activeTabId,
    tabs: tabOrder.map((id) => tabState(tabs.get(id))),
  });
}

let stateTimer = null;
/** Coalesces bursts of updates (e.g. many blocked requests) into one UI message. */
function sendStateSoon() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    sendState();
  }, 100);
}

function layoutActiveTab() {
  if (!win || activeTabId == null) return;
  const { width, height } = win.getContentBounds();
  tabs.get(activeTabId).view.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width,
    height: Math.max(0, height - CHROME_HEIGHT),
  });
}

function recordHistory(wc) {
  const url = wc.getURL();
  if (!/^https?:/.test(url)) return;
  const entries = history.get('entries');
  const last = entries[0];
  const title = wc.getTitle() || url;
  if (last && last.url === url) {
    last.title = title;
  } else {
    entries.unshift({ url, title, time: Date.now() });
    if (entries.length > HISTORY_LIMIT) entries.length = HISTORY_LIMIT;
  }
  history.save();
}

/** Removes the failed page under the error page, so "back" skips it instead of failing again. */
function dropFailedEntry(wc, errorUrl) {
  const failedUrl = new URL(errorUrl).searchParams.get('url');
  const nav = wc.navigationHistory;
  const index = nav.getActiveIndex() - 1;
  if (index >= 0 && nav.getEntryAtIndex(index)?.url === failedUrl) nav.removeEntryAtIndex(index);
}

function createTab(url = NEW_TAB_URL, { activate = true } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:kitty',
      preload: path.join(__dirname, 'preload-page.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  view.setBackgroundColor('#00000000');
  const wc = view.webContents;
  const tab = { id: wc.id, view, blocked: new Set(), favicon: null };
  tabs.set(tab.id, tab);

  const insertAt = activeTabId != null ? tabOrder.indexOf(activeTabId) + 1 : tabOrder.length;
  tabOrder.splice(insertAt, 0, tab.id);

  wc.setWindowOpenHandler(({ url: target }) => {
    createTab(target);
    return { action: 'deny' };
  });
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      tab.blocked.clear();
      tab.favicon = null;
    }
    sendState();
  });
  wc.on('did-navigate', (_e, url) => {
    if (url.startsWith('kitty://error')) dropFailedEntry(wc, url);
    recordHistory(wc);
    sendState();
  });
  wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
    if (isMainFrame) recordHistory(wc);
    sendState();
  });
  wc.on('page-title-updated', () => {
    recordHistory(wc);
    sendState();
  });
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = favicons[0] || null;
    sendState();
  });
  wc.on('did-start-loading', sendState);
  wc.on('did-stop-loading', sendState);
  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. user hit stop)
    const params = new URLSearchParams({ url: failedUrl, reason: desc });
    wc.loadURL(`kitty://error?${params}`).catch(() => {});
  });

  wc.loadURL(url).catch(() => {}); // failures are handled by did-fail-load
  if (activate) switchTab(tab.id);
  else sendState();
  return tab;
}

function switchTab(id) {
  if (!tabs.has(id) || !win) return;
  if (activeTabId != null && tabs.has(activeTabId)) {
    win.contentView.removeChildView(tabs.get(activeTabId).view);
  }
  activeTabId = id;
  const tab = tabs.get(id);
  win.contentView.addChildView(tab.view);
  layoutActiveTab();
  sendState();

  if (isInternal(tab.view.webContents.getURL()) || tab.view.webContents.getURL() === '') {
    focusAddressBar();
  } else {
    tab.view.webContents.focus();
  }
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const index = tabOrder.indexOf(id);
  tabOrder.splice(index, 1);
  tabs.delete(id);

  if (tabOrder.length === 0) {
    tab.view.webContents.close();
    win.close();
    return;
  }
  if (activeTabId === id) {
    win.contentView.removeChildView(tab.view);
    activeTabId = null;
    switchTab(tabOrder[Math.min(index, tabOrder.length - 1)]);
  }
  tab.view.webContents.close();
  sendState();
}

/** Reloads the page; on the error page, retries the address that failed. */
function reloadActive() {
  const wc = activeWebContents();
  if (!wc) return;
  const url = wc.getURL();
  if (url.startsWith('kitty://error')) {
    const failed = new URL(url).searchParams.get('url');
    if (failed) return wc.loadURL(failed).catch(() => {});
  }
  wc.reload();
}

function activeWebContents() {
  return activeTabId != null ? tabs.get(activeTabId)?.view.webContents : null;
}

function focusAddressBar() {
  if (!win) return;
  win.webContents.focus();
  win.webContents.send('ui:focus-address');
}

// ---------------------------------------------------------------------------
// Privacy: ad/tracker blocking + Global Privacy Control

async function setupBlocker(ses) {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (!blocker || details.resourceType === 'mainFrame' || !details.webContentsId) {
      return callback({});
    }
    const tab = tabs.get(details.webContentsId);
    if (!tab || !isShieldUp(tab.view.webContents.getURL())) return callback({});

    const { match, redirect } = blocker.match(fromElectronDetails(details));
    if (!match && !redirect) return callback({});

    // Count each URL once per page load: some sites retry blocked requests in a tight loop.
    if (!tab.blocked.has(details.url)) {
      tab.blocked.add(details.url);
      settings.set('blockedTotal', settings.get('blockedTotal') + 1);
      sendStateSoon();
    }
    callback(redirect ? { redirectURL: redirect.dataUrl } : { cancel: true });
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'Sec-GPC': '1', DNT: '1' } });
  });

  // Cosmetic filtering: hides the empty boxes ads leave behind. The preload
  // asks for the CSS/scriptlets of each frame; we skip sites with shields down.
  ses.registerPreloadScript({
    type: 'frame',
    filePath: require.resolve('@ghostery/adblocker-electron-preload'),
  });
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
    const tab = tabs.get(event.sender.id);
    if (!blocker || !tab || !isShieldUp(tab.view.webContents.getURL())) return;
    return blocker.onInjectCosmeticFilters(event, url, msg);
  });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) =>
    blocker ? blocker.onIsMutationObserverEnabled(event) : false,
  );

  // Requests pass through untouched until the filter lists are ready.
  const cachePath = path.join(app.getPath('userData'), 'adblock-engine.bin');
  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: fs.promises.readFile,
      write: fs.promises.writeFile,
    });
  } catch (err) {
    console.error('[kitty] Não foi possível carregar as listas de bloqueio:', err);
  }
}

function toggleShield() {
  const wc = activeWebContents();
  if (!wc || isInternal(wc.getURL())) return;
  const host = hostOf(wc.getURL());
  if (!host) return;
  const allowlist = settings.get('allowlist');
  settings.set(
    'allowlist',
    allowlist.includes(host) ? allowlist.filter((h) => h !== host) : [...allowlist, host],
  );
  wc.reload();
}

// ---------------------------------------------------------------------------
// kitty:// internal pages

function registerKittyProtocol(ses) {
  const handler = (request) => {
    const url = new URL(request.url);
    const page = url.hostname;
    const file = url.pathname === '/' || url.pathname === '' ? `${page}.html` : url.pathname.slice(1);
    const resolved = path.resolve(PAGES_DIR, file);
    if (!resolved.startsWith(PAGES_DIR + path.sep) || !fs.existsSync(resolved)) {
      return new Response('Página não encontrada', { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  };
  ses.protocol.handle('kitty', handler);
}

function fromInternalPage(event) {
  return isInternal(event.senderFrame?.url);
}

function fromUI(event) {
  return win && event.sender === win.webContents;
}

function registerIpc() {
  // Browser chrome (tab strip + toolbar)
  const ui = (channel, fn) =>
    ipcMain.on(channel, (event, ...args) => {
      if (fromUI(event)) fn(...args);
    });
  ui('tab:new', () => createTab());
  ui('tab:close', (id) => closeTab(id ?? activeTabId));
  ui('tab:switch', (id) => switchTab(id));
  ui('nav:go', (input) => {
    const wc = activeWebContents();
    if (!wc) return;
    wc.loadURL(resolveInput(input)).catch(() => {});
    wc.focus();
  });
  ui('nav:back', () => activeWebContents()?.navigationHistory.goBack());
  ui('nav:forward', () => activeWebContents()?.navigationHistory.goForward());
  ui('nav:reload', reloadActive);
  ui('nav:stop', () => activeWebContents()?.stop());
  ui('shield:toggle', toggleShield);
  ui('open:history', () => openInternal('kitty://history'));
  ui('ui:ready', sendState);

  // Internal pages (kitty://newtab, kitty://history)
  ipcMain.handle('kitty:history', (event, query = '') => {
    if (!fromInternalPage(event)) return [];
    const q = String(query).toLowerCase();
    const entries = history.get('entries');
    const found = q
      ? entries.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
      : entries;
    return found.slice(0, 500);
  });
  ipcMain.handle('kitty:history-remove', (event, time) => {
    if (!fromInternalPage(event)) return;
    history.set('entries', history.get('entries').filter((e) => e.time !== time));
  });
  ipcMain.handle('kitty:history-clear', (event) => {
    if (!fromInternalPage(event)) return;
    history.set('entries', []);
  });
  ipcMain.handle('kitty:stats', (event) => {
    if (!fromInternalPage(event)) return null;
    const recent = [];
    const seen = new Set();
    for (const e of history.get('entries')) {
      const host = hostOf(e.url);
      if (seen.has(host)) continue;
      seen.add(host);
      recent.push({ host, url: e.url, title: e.title });
      if (recent.length === 8) break;
    }
    return { blockedTotal: settings.get('blockedTotal'), recent };
  });
}

function openInternal(url) {
  const existing = tabOrder.find((id) => tabs.get(id).view.webContents.getURL().startsWith(url));
  if (existing != null) {
    switchTab(existing);
    tabs.get(existing).view.webContents.reload();
  } else {
    createTab(url);
  }
}

// ---------------------------------------------------------------------------
// Window + menu

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 320,
    title: 'Kitty',
    backgroundColor: '#17151c',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    titleBarOverlay: process.platform === 'darwin' ? false : { height: 40, color: '#00000000' },
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadFile(path.join(UI_DIR, 'index.html'));
  win.on('resize', layoutActiveTab);
  win.on('closed', () => {
    win = null;
    tabs.clear();
    tabOrder = [];
    activeTabId = null;
  });
  win.webContents.once('did-finish-load', () => createTab());
}

function buildMenu() {
  const tabAt = (n) => () => {
    const id = n === 9 ? tabOrder.at(-1) : tabOrder[n - 1];
    if (id != null) switchTab(id);
  };
  const cycle = (delta) => () => {
    if (tabOrder.length < 2) return;
    const i = tabOrder.indexOf(activeTabId);
    switchTab(tabOrder[(i + delta + tabOrder.length) % tabOrder.length]);
  };

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu', label: 'Kitty' }] : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Nova aba', accelerator: 'CmdOrCtrl+T', click: () => (win ? createTab() : createWindow()) },
        { label: 'Nova janela', accelerator: 'CmdOrCtrl+N', click: () => !win && createWindow() },
        { label: 'Abrir local', accelerator: 'CmdOrCtrl+L', click: focusAddressBar },
        { type: 'separator' },
        { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeTabId) },
      ],
    },
    { role: 'editMenu', label: 'Editar' },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: reloadActive },
        {
          label: 'Ferramentas do desenvolvedor',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => activeWebContents()?.toggleDevTools(),
        },
        { type: 'separator' },
        { label: 'Ampliar', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.5) },
        { label: 'Reduzir', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
        { label: 'Tamanho real', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
    {
      label: 'Histórico',
      submenu: [
        { label: 'Voltar', accelerator: 'CmdOrCtrl+[', click: () => activeWebContents()?.navigationHistory.goBack() },
        { label: 'Avançar', accelerator: 'CmdOrCtrl+]', click: () => activeWebContents()?.navigationHistory.goForward() },
        { type: 'separator' },
        { label: 'Mostrar histórico', accelerator: 'CmdOrCtrl+Y', click: () => openInternal('kitty://history') },
      ],
    },
    {
      label: 'Abas',
      submenu: [
        { label: 'Próxima aba', accelerator: 'Ctrl+Tab', click: cycle(1) },
        { label: 'Aba anterior', accelerator: 'Ctrl+Shift+Tab', click: cycle(-1) },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: n === 9 ? 'Última aba' : `Aba ${n}`,
          accelerator: `CmdOrCtrl+${n}`,
          click: tabAt(n),
        })),
      ],
    },
    { role: 'windowMenu', label: 'Janela' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function zoom(delta) {
  const wc = activeWebContents();
  if (!wc) return;
  wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta);
}

// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  settings = new Store(path.join(userData, 'settings.json'), { allowlist: [], blockedTotal: 0 });
  history = new Store(path.join(userData, 'history.json'), { entries: [] });

  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock.setIcon(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
  }

  const ses = session.fromPartition('persist:kitty');
  registerKittyProtocol(ses);
  registerIpc();
  buildMenu();
  const ready = setupBlocker(ses);
  createWindow();
  await ready;

  app.on('activate', () => {
    if (!win) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  settings?.flush();
  history?.flush();
});
