'use strict';

// The chrome.* APIs Electron doesn't provide, answered from Kitty's own tabs and
// windows: tabs, windows, action (the toolbar button and its popup),
// contextMenus, webNavigation, notifications, permissions and a few smaller
// ones. preload-extensions.js puts them in each extension's world and sends the
// calls here; events go back to the contexts that listen to them, waking the
// extension's service worker when it is asleep.
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, Notification, ipcMain, nativeImage, screen, webFrameMain } = require('electron');

const { registry } = require('./registry');
const { NEW_TAB_URL } = require('./window');

/** Set by extensions.js / main.js. */
const hooks = {
  newWindow: () => null, // (url) → KittyWindow
  adoptWindow: () => null, // (tab, bounds) → KittyWindow holding a tab moved out of its window
  stateChanged() {}, // the toolbar buttons need redrawing
  isPinned: () => false,
};

/** @type {Electron.Session | null} the persistent profile; extensions only run there */
let ses = null;

const extension = (id) => (id && ses ? ses.extensions.getExtension(id) : null);
const loadedIds = () => (ses ? ses.extensions.getAllExtensions().map((e) => e.id) : []);
const manifestAction = (ext) => ext.manifest.action || ext.manifest.browser_action || ext.manifest.page_action || {};

// ---------------------------------------------------------------------------
// Files and icons inside an extension

/** A path inside the extension's folder, or null if it points outside it. */
function extensionFile(ext, relative) {
  if (typeof relative !== 'string' || !relative) return null;
  const clean = relative.split(/[?#]/)[0].replace(/^\/+/, '');
  const full = path.resolve(ext.path, clean);
  return full.startsWith(path.resolve(ext.path) + path.sep) ? full : null;
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp' };
const iconCache = new Map();

/** An icon from the extension (a path or a { size: path } set) as a data: URL, around `wanted` pixels. */
function iconDataUrl(ext, icon, wanted = 32) {
  if (!ext || !icon) return null;
  let relative = icon;
  if (typeof icon === 'object') {
    const sizes = Object.keys(icon).map(Number).filter(Boolean).sort((a, b) => a - b);
    if (!sizes.length) return null;
    relative = icon[sizes.find((s) => s >= wanted) ?? sizes.at(-1)];
  }
  const file = extensionFile(ext, relative);
  if (!file) return null;
  const key = `${file}:${ext.version}`;
  if (iconCache.has(key)) return iconCache.get(key);
  let url = null;
  try {
    const type = MIME[path.extname(file).toLowerCase()] || 'image/png';
    url = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {}
  iconCache.set(key, url);
  return url;
}

/** The extension's own icon (manifest "icons"), for lists. */
function extensionIcon(ext, wanted = 48) {
  return iconDataUrl(ext, ext.manifest.icons, wanted) || iconDataUrl(ext, manifestAction(ext).default_icon, wanted);
}

/** A URL an extension gave (relative ones are inside the extension). */
function resolveUrl(ext, url) {
  if (url == null || url === '') return NEW_TAB_URL;
  const text = String(url);
  if (/^chrome:\/\/newtab\/?$/i.test(text)) return NEW_TAB_URL;
  let resolved;
  try {
    resolved = new URL(text, `chrome-extension://${ext.id}/`);
  } catch {
    throw new Error(`URL inválida: ${text}`);
  }
  if (!['http:', 'https:', 'chrome-extension:', 'about:', 'data:'].includes(resolved.protocol)) {
    throw new Error(`O Kitty não abre este endereço para extensões: ${text}`);
  }
  return resolved.href;
}

// ---------------------------------------------------------------------------
// Windows and tabs as extensions see them. Private windows don't exist for
// extensions (like Chrome's incognito without permission). Windows opened by
// extensions themselves (windows.create, e.g. Bitwarden's "pop out") are small
// windows with a single page.

/** @type {Map<number, { id: number, bw: Electron.BrowserWindow, extId: string, type: string }>} */
const extWindows = new Map();

const kittyWindows = () => [...registry.windows].filter((w) => !w.isPrivate);
const allWindows = () => [...kittyWindows(), ...extWindows.values()];
const isKitty = (w) => !!w?.tabs;
const windowId = (w) => (isKitty(w) ? w.win.id : w.id);
const windowById = (id) => allWindows().find((w) => windowId(w) === id) || null;

function focusedWindow() {
  for (const w of extWindows.values()) if (!w.bw.isDestroyed() && w.bw.isFocused()) return w;
  return registry.current({ allowPrivate: false });
}

function windowInfo(w, { populate = false } = {}) {
  const win = isKitty(w) ? w.win : w.bw;
  const b = win.getBounds();
  const state = win.isFullScreen() ? 'fullscreen' : win.isMinimized() ? 'minimized' : win.isMaximized() ? 'maximized' : 'normal';
  const info = {
    id: windowId(w),
    focused: win.isFocused(),
    top: b.y,
    left: b.x,
    width: b.width,
    height: b.height,
    incognito: false,
    type: isKitty(w) ? 'normal' : w.type,
    state,
    alwaysOnTop: win.isAlwaysOnTop(),
  };
  if (populate) info.tabs = tabsOf(w).map(tabInfo);
  return info;
}

/** A tab, wherever it is: { w, tab } for Kitty tabs, { w, wc } for an extension window's page. */
function tabsOf(w) {
  if (isKitty(w)) return w.order.map((id) => ({ w, tab: w.tabs.get(id) })).filter((t) => t.tab);
  return w.bw.isDestroyed() ? [] : [{ w, wc: w.bw.webContents }];
}

const allTabs = () => allWindows().flatMap(tabsOf);
const tabId = (t) => (t.tab ? t.tab.id : t.wc.id);
const tabById = (id) => allTabs().find((t) => tabId(t) === id) || null;
const tabWebContents = (t) => (t.tab ? t.tab.view.webContents : t.wc);

function tabInfo(t) {
  const { w } = t;
  if (!t.tab) {
    const wc = t.wc;
    return {
      id: wc.id,
      index: 0,
      windowId: w.id,
      active: true,
      highlighted: true,
      selected: true,
      pinned: false,
      audible: wc.isCurrentlyAudible(),
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      mutedInfo: { muted: wc.isAudioMuted() },
      url: wc.getURL(),
      title: wc.getTitle(),
      status: wc.isLoading() ? 'loading' : 'complete',
      incognito: false,
      groupId: -1,
      width: w.bw.getContentBounds().width,
      height: w.bw.getContentBounds().height,
    };
  }
  const { tab } = t;
  const wc = tab.view.webContents;
  const lazy = !!tab.pendingUrl;
  const url = tab.pendingUrl || wc.getURL();
  const active = w.activeId === tab.id;
  const bounds = tab.view.getBounds();
  return {
    id: tab.id,
    index: w.order.indexOf(tab.id),
    windowId: w.win.id,
    active,
    highlighted: active,
    selected: active,
    pinned: !!tab.pinned,
    audible: !lazy && wc.isCurrentlyAudible(),
    discarded: lazy,
    autoDiscardable: true,
    frozen: false,
    mutedInfo: { muted: wc.isAudioMuted() },
    url,
    title: (lazy ? tab.pendingTitle : wc.getTitle()) || url,
    favIconUrl: tab.favicon || undefined,
    status: lazy ? 'unloaded' : wc.isLoading() ? 'loading' : 'complete',
    incognito: false,
    groupId: -1,
    width: bounds.width,
    height: bounds.height,
    lastAccessed: tab.lastAccessed || Date.now(),
  };
}

/** The window an extension context belongs to (chrome.windows.WINDOW_ID_CURRENT). */
function windowOf(ctx) {
  const wc = ctx.sender;
  if (wc) {
    const found = registry.tabByWebContentsId(wc.id);
    if (found && !found.kwin.isPrivate) return found.kwin;
    const popup = popups.get(wc.id);
    if (popup && registry.windows.has(popup.kwin)) return popup.kwin;
    for (const w of extWindows.values()) if (!w.bw.isDestroyed() && w.bw.webContents === wc) return w;
  }
  return focusedWindow();
}

/** "<all_urls>", "*://*.example.com/*" and friends. */
function matchesPattern(pattern, url) {
  if (pattern === '<all_urls>') return /^(https?|wss?|ftp|file):/.test(url);
  const m = /^(\*|https?|wss?|ftp|file|chrome-extension):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const [, scheme, host, pathPart] = m;
  const proto = u.protocol.slice(0, -1);
  if (scheme === '*' ? !['http', 'https', 'ws', 'wss'].includes(proto) : proto !== scheme) return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (u.hostname !== base && !u.hostname.endsWith(`.${base}`)) return false;
    } else if (u.hostname !== host.replace(/:\d+$/, '')) return false;
  }
  const glob = new RegExp(`^${pathPart.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return glob.test(u.pathname + u.search);
}

const globMatch = (pattern, text) =>
  new RegExp(`^${String(pattern).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(text || '');

function queryTabs(ctx, q = {}) {
  let windows = allWindows();
  const current = windowOf(ctx);
  if (q.currentWindow === true) windows = windows.filter((w) => w === current);
  if (q.currentWindow === false) windows = windows.filter((w) => w !== current);
  if (q.lastFocusedWindow === true) windows = windows.filter((w) => w === focusedWindow());
  if (q.lastFocusedWindow === false) windows = windows.filter((w) => w !== focusedWindow());
  if (q.windowId != null) {
    const id = q.windowId === -2 ? windowId(current) : q.windowId;
    windows = windows.filter((w) => windowId(w) === id);
  }
  if (q.windowType) windows = windows.filter((w) => (isKitty(w) ? 'normal' : w.type) === q.windowType);
  const urls = q.url == null ? null : [].concat(q.url);
  return windows
    .flatMap(tabsOf)
    .map(tabInfo)
    .filter(
      (t) =>
        (q.active == null || t.active === q.active) &&
        (q.highlighted == null || t.highlighted === q.highlighted) &&
        (q.pinned == null || t.pinned === q.pinned) &&
        (q.audible == null || t.audible === q.audible) &&
        (q.muted == null || t.mutedInfo.muted === q.muted) &&
        (q.discarded == null || t.discarded === q.discarded) &&
        (q.status == null || t.status === q.status) &&
        (q.index == null || t.index === q.index) &&
        (q.title == null || globMatch(q.title, t.title)) &&
        (!urls || urls.some((p) => matchesPattern(p, t.url))),
    );
}

function requireTab(id) {
  const t = tabById(Number(id));
  if (!t) throw new Error(`Nenhuma aba com o id ${id}.`);
  return t;
}

/** The tab an omitted tabId means: the active tab of the caller's window. */
function tabOrActive(ctx, id) {
  if (id != null) return requireTab(id);
  const w = windowOf(ctx);
  const t = w && (isKitty(w) ? (w.activeTab() ? { w, tab: w.activeTab() } : null) : tabsOf(w)[0]);
  if (!t) throw new Error('Nenhuma aba ativa.');
  return t;
}

function kittyWindowFor(ctx, id) {
  if (id != null && id !== -2) {
    const w = windowById(id);
    if (!w) throw new Error(`Nenhuma janela com o id ${id}.`);
    if (isKitty(w)) return w;
  }
  const w = windowOf(ctx);
  return isKitty(w) ? w : registry.current({ allowPrivate: false });
}

const tabsApi = {
  get: (ctx, id) => tabInfo(requireTab(id)),
  getCurrent: (ctx) => {
    const found = ctx.sender && registry.tabByWebContentsId(ctx.sender.id);
    return found && !found.kwin.isPrivate ? tabInfo({ w: found.kwin, tab: found.tab }) : undefined;
  },
  query: (ctx, q) => queryTabs(ctx, q || {}),
  create: (ctx, props = {}) => {
    const url = resolveUrl(ctx.ext, props.url);
    let kwin = kittyWindowFor(ctx, props.windowId);
    if (!kwin) kwin = hooks.newWindow();
    const index = Number.isInteger(props.index) ? props.index : null;
    const tab = kwin.createTab(url, { activate: props.active !== false, index });
    if (props.pinned) kwin.togglePin(tab.id);
    if (props.active !== false) kwin.win.focus();
    return tabInfo({ w: kwin, tab });
  },
  update: (ctx, ...args) => {
    const [id, props = {}] = typeof args[0] === 'object' && args[0] !== null ? [null, args[0]] : args;
    const t = tabOrActive(ctx, id);
    const wc = tabWebContents(t);
    if (props.url != null) {
      const url = resolveUrl(ctx.ext, props.url);
      if (t.tab?.pendingUrl) t.tab.pendingUrl = url;
      else wc.loadURL(url).catch(() => {});
    }
    if (t.tab && (props.active || props.highlighted)) {
      t.w.switchTab(t.tab.id);
      t.w.win.focus();
    }
    if (t.tab && typeof props.pinned === 'boolean' && props.pinned !== !!t.tab.pinned) t.w.togglePin(t.tab.id);
    if (typeof props.muted === 'boolean') {
      wc.setAudioMuted(props.muted);
      if (t.tab) t.w.sendState();
    }
    return tabInfo(t);
  },
  remove: (ctx, ids) => {
    for (const id of [].concat(ids)) {
      const t = requireTab(id);
      if (t.tab) t.w.closeTab(t.tab.id);
      else t.w.bw.close();
    }
  },
  duplicate: (ctx, id) => {
    const t = requireTab(id);
    if (!t.tab) throw new Error('Esta aba não pode ser duplicada.');
    const tab = t.w.createTab(tabInfo(t).url, { index: t.w.order.indexOf(t.tab.id) + 1 });
    return tabInfo({ w: t.w, tab });
  },
  highlight: (ctx, { windowId: wid, tabs } = {}) => {
    const w = kittyWindowFor(ctx, wid);
    const index = [].concat(tabs)[0];
    const id = w.order[index];
    if (id == null) throw new Error(`Nenhuma aba na posição ${index}.`);
    w.switchTab(id);
    return windowInfo(w, { populate: true });
  },
  move: (ctx, ids, { windowId: wid, index = -1 } = {}) => {
    const moved = [];
    for (const id of [].concat(ids)) {
      const t = requireTab(id);
      if (!t.tab) continue;
      const target = wid != null ? kittyWindowFor(ctx, wid) : t.w;
      const at = index < 0 ? target.order.length : index;
      if (target === t.w) t.w.moveTab(t.tab.id, at);
      else {
        const tab = t.w.releaseTab(t.tab.id);
        if (tab) target.adoptTab(tab, at, { focus: false });
      }
      moved.push(tabInfo(requireTab(id)));
    }
    return Array.isArray(ids) ? moved : moved[0];
  },
  goBack: (ctx, id) => tabWebContents(tabOrActive(ctx, id)).navigationHistory.goBack(),
  goForward: (ctx, id) => tabWebContents(tabOrActive(ctx, id)).navigationHistory.goForward(),
  captureVisibleTab: async (ctx, ...args) => {
    const wid = typeof args[0] === 'number' ? args.shift() : null;
    const options = args[0] || {};
    const w = wid == null ? windowOf(ctx) : windowById(wid);
    const t = w && (isKitty(w) ? (w.activeTab() ? { w, tab: w.activeTab() } : null) : tabsOf(w)[0]);
    if (!t) throw new Error('Nenhuma aba visível.');
    const image = await tabWebContents(t).capturePage();
    return options.format === 'jpeg' ? `data:image/jpeg;base64,${image.toJPEG(options.quality ?? 92).toString('base64')}` : image.toDataURL();
  },
  discard: (ctx, id) => tabInfo(tabOrActive(ctx, id)),
};

const windowsApi = {
  get: (ctx, id, opts = {}) => {
    const w = id === -2 ? windowOf(ctx) : windowById(id);
    if (!w) throw new Error(`Nenhuma janela com o id ${id}.`);
    return windowInfo(w, opts);
  },
  getCurrent: (ctx, opts = {}) => windowInfo(windowOf(ctx), opts),
  getLastFocused: (ctx, opts = {}) => {
    const w = focusedWindow();
    if (!w) throw new Error('Nenhuma janela aberta.');
    return windowInfo(w, opts);
  },
  getAll: (ctx, opts = {}) =>
    allWindows()
      .filter((w) => !opts.windowTypes || opts.windowTypes.includes(isKitty(w) ? 'normal' : w.type))
      .map((w) => windowInfo(w, opts)),
  create: (ctx, props = {}) => {
    if (props.incognito) throw new Error('Extensões não funcionam em janelas privativas.');
    const urls = props.url == null ? [] : [].concat(props.url).map((u) => resolveUrl(ctx.ext, u));
    const bounds = ['left', 'top', 'width', 'height'].every((k) => props[k] == null)
      ? null
      : { x: props.left, y: props.top, width: props.width, height: props.height };
    if (props.type === 'popup' || props.type === 'panel') return windowInfo(openExtensionWindow(ctx.ext, urls[0] || NEW_TAB_URL, props, bounds), { populate: true });
    let kwin;
    if (props.tabId != null) {
      const t = requireTab(props.tabId);
      const tab = t.tab && t.w.releaseTab(t.tab.id);
      if (!tab) throw new Error('Esta aba não pode mudar de janela.');
      kwin = hooks.adoptWindow(tab, bounds);
    } else {
      kwin = hooks.newWindow(urls[0]);
      for (const url of urls.slice(1)) kwin.ui.webContents.once('did-finish-load', () => kwin.createTab(url, { activate: false }));
    }
    if (props.focused === false) kwin.win.blur();
    return windowInfo(kwin, { populate: true });
  },
  update: (ctx, id, props = {}) => {
    const w = id === -2 ? windowOf(ctx) : windowById(id);
    if (!w) throw new Error(`Nenhuma janela com o id ${id}.`);
    const win = isKitty(w) ? w.win : w.bw;
    if (props.state === 'minimized') win.minimize();
    if (props.state === 'maximized') win.maximize();
    if (props.state === 'fullscreen') win.setFullScreen(true);
    if (props.state === 'normal') {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
      if (win.isMinimized()) win.restore();
    }
    const b = win.getBounds();
    if (['left', 'top', 'width', 'height'].some((k) => props[k] != null)) {
      win.setBounds({ x: props.left ?? b.x, y: props.top ?? b.y, width: props.width ?? b.width, height: props.height ?? b.height });
    }
    if (props.focused === true) win.focus();
    if (props.focused === false) win.blur();
    if (props.drawAttention && process.platform === 'darwin') require('electron').app.dock?.bounce('informational');
    return windowInfo(w);
  },
  remove: (ctx, id) => {
    const w = windowById(id);
    if (!w) throw new Error(`Nenhuma janela com o id ${id}.`);
    (isKitty(w) ? w.win : w.bw).close();
  },
};

/** A small window of the extension's own (windows.create with type "popup"). */
function openExtensionWindow(ext, url, props, bounds) {
  const parent = focusedWindow();
  const pb = parent ? (isKitty(parent) ? parent.win : parent.bw).getBounds() : null;
  const width = bounds?.width || 420;
  const height = bounds?.height || 620;
  const bw = new BrowserWindow({
    width,
    height,
    x: bounds?.x ?? (pb ? Math.round(pb.x + (pb.width - width) / 2) : undefined),
    y: bounds?.y ?? (pb ? Math.round(pb.y + 60) : undefined),
    title: ext.name,
    autoHideMenuBar: true,
    show: props.focused !== false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true },
  });
  const w = { id: bw.id, bw, extId: ext.id, type: props.type === 'panel' ? 'panel' : 'popup' };
  extWindows.set(w.id, w);
  const wc = bw.webContents;
  wc.setWindowOpenHandler(({ url: link }) => {
    const kwin = registry.current({ allowPrivate: false }) || hooks.newWindow();
    kwin.createTab(link);
    kwin.win.focus();
    return { action: 'deny' };
  });
  watchNavigation(wc);
  for (const ev of ['did-navigate', 'page-title-updated', 'did-start-loading', 'did-stop-loading', 'focus']) wc.on(ev, () => browserChanged());
  bw.on('focus', () => browserChanged());
  bw.on('closed', () => {
    extWindows.delete(w.id);
    browserChanged();
  });
  wc.loadURL(url).catch(() => {});
  browserChanged();
  return w;
}

// ---------------------------------------------------------------------------
// chrome.action: the toolbar button, with per-tab values

/** @type {Map<string, { global: object, tabs: Map<number, object> }>} */
const actions = new Map();

function actionState(extId) {
  let state = actions.get(extId);
  if (!state) {
    state = { global: {}, tabs: new Map() };
    actions.set(extId, state);
  }
  return state;
}

/** What the button shows for a tab: per-tab values over the extension's own, over the manifest. */
function effectiveAction(ext, tabIdValue) {
  const declared = manifestAction(ext);
  const state = actionState(ext.id);
  const perTab = tabIdValue != null ? state.tabs.get(tabIdValue) || {} : {};
  const pick = (key, fallback) => (key in perTab ? perTab[key] : key in state.global ? state.global[key] : fallback);
  return {
    title: pick('title', declared.default_title || ext.name),
    icon: pick('icon', null) || iconDataUrl(ext, declared.default_icon, 32) || extensionIcon(ext, 32),
    popup: pick('popup', declared.default_popup || ''),
    badgeText: pick('badgeText', ''),
    badgeBackground: pick('badgeBackground', '#d93025'),
    badgeColor: pick('badgeColor', '#ffffff'),
    enabled: pick('enabled', true),
  };
}

function setActionValue(ext, details, key, value) {
  const state = actionState(ext.id);
  const id = details?.tabId;
  if (id != null) {
    if (!state.tabs.has(id)) state.tabs.set(id, {});
    state.tabs.get(id)[key] = value;
  } else state.global[key] = value;
  hooks.stateChanged();
}

function cssColor(color) {
  if (Array.isArray(color)) {
    const [r, g, b, a = 255] = color.map(Number);
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  }
  return typeof color === 'string' ? color : '#d93025';
}

function actionTabId(ctx, details) {
  return details?.tabId ?? null;
}

const actionApi = {
  setTitle: (ctx, d = {}) => setActionValue(ctx.ext, d, 'title', String(d.title ?? '')),
  getTitle: (ctx, d = {}) => effectiveAction(ctx.ext, actionTabId(ctx, d)).title,
  setBadgeText: (ctx, d = {}) => setActionValue(ctx.ext, d, 'badgeText', d.text == null ? '' : String(d.text)),
  getBadgeText: (ctx, d = {}) => effectiveAction(ctx.ext, actionTabId(ctx, d)).badgeText,
  setBadgeBackgroundColor: (ctx, d = {}) => setActionValue(ctx.ext, d, 'badgeBackground', cssColor(d.color)),
  getBadgeBackgroundColor: (ctx, d = {}) => colorArray(effectiveAction(ctx.ext, actionTabId(ctx, d)).badgeBackground),
  setBadgeTextColor: (ctx, d = {}) => setActionValue(ctx.ext, d, 'badgeColor', cssColor(d.color)),
  getBadgeTextColor: (ctx, d = {}) => colorArray(effectiveAction(ctx.ext, actionTabId(ctx, d)).badgeColor),
  setPopup: (ctx, d = {}) => setActionValue(ctx.ext, d, 'popup', String(d.popup ?? '')),
  getPopup: (ctx, d = {}) => {
    const popup = effectiveAction(ctx.ext, actionTabId(ctx, d)).popup;
    return popup ? new URL(popup, `chrome-extension://${ctx.ext.id}/`).href : '';
  },
  setIcon: (ctx, d = {}) => {
    const icon = d.dataUrl || iconDataUrl(ctx.ext, d.path, 32);
    if (!icon) throw new Error('Ícone inválido.');
    setActionValue(ctx.ext, d, 'icon', icon);
  },
  enable: (ctx, id) => setActionValue(ctx.ext, { tabId: id ?? undefined }, 'enabled', true),
  disable: (ctx, id) => setActionValue(ctx.ext, { tabId: id ?? undefined }, 'enabled', false),
  isEnabled: (ctx, id) => effectiveAction(ctx.ext, id ?? null).enabled,
  openPopup: (ctx, opts = {}) => {
    const w = opts.windowId != null ? windowById(opts.windowId) : windowOf(ctx);
    if (!isKitty(w)) throw new Error('Nenhuma janela do navegador.');
    if (!effectiveAction(ctx.ext, w.activeId).popup) throw new Error('Esta extensão não tem pop-up.');
    w.win.focus();
    w.sendUi('extensions:open-popup', ctx.ext.id); // the UI answers with where the button is
  },
  getUserSettings: (ctx) => ({ isOnToolbar: hooks.isPinned(ctx.ext.id) }),
};

function colorArray(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css || '');
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map(Number);
    return [r, g, b, Math.round(a * 255)];
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(css || '');
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(255);
  return [217, 48, 37, 255];
}

/** The state of every extension's button for a window's active tab, for its toolbar. */
function toolbarState(kwin) {
  const active = kwin.activeId;
  return loadedIds()
    .map(extension)
    .filter(Boolean)
    .map((ext) => {
      const a = effectiveAction(ext, active);
      return {
        id: ext.id,
        name: ext.name,
        title: a.title,
        icon: a.icon,
        badgeText: a.badgeText,
        badgeBackground: a.badgeBackground,
        badgeColor: a.badgeColor,
        enabled: a.enabled,
        hasPopup: !!a.popup,
        pinned: hooks.isPinned(ext.id),
      };
    });
}

// ---------------------------------------------------------------------------
// The popup: a small window under the button, sized by its page (like Chrome,
// between 25×25 and 800×600), closed when it loses focus.

/** @type {Map<number, { kwin: object, extId: string, bw: Electron.BrowserWindow }>} by the popup's webContents id */
const popups = new Map();

function closePopups() {
  for (const p of popups.values()) if (!p.bw.isDestroyed()) p.bw.close();
}

/**
 * The button was clicked: shows the popup, or tells the extension (action.onClicked).
 * `anchor` is the button's rectangle in the window's content coordinates.
 */
function clickAction(kwin, extId, anchor) {
  const ext = extension(extId);
  if (!ext || kwin.isPrivate) return;
  const open = [...popups.values()].find((p) => p.extId === extId && p.kwin === kwin);
  if (open) {
    open.bw.close();
    return;
  }
  closePopups();
  const tab = kwin.activeTab();
  const a = effectiveAction(ext, tab?.id ?? null);
  if (!a.enabled) return;
  if (a.popup) return openPopup(kwin, ext, a.popup, anchor);
  if (sidePanelState(ext.id).openPanelOnActionClick && sidePanelPath(ext)) {
    return void kwin.createTab(resolveUrl(ext, sidePanelPath(ext)));
  }
  if (tab) dispatch(ext.id, 'action.onClicked', [tabInfo({ w: kwin, tab })]);
  if (tab) dispatch(ext.id, 'browserAction.onClicked', [tabInfo({ w: kwin, tab })]);
}

function openPopup(kwin, ext, popupPath, anchor) {
  const content = kwin.win.getContentBounds();
  const rect = anchor || { x: content.width - 40, y: 40, width: 30, height: 30 };
  const bw = new BrowserWindow({
    parent: kwin.win,
    width: 25,
    height: 25,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#ffffff',
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, enablePreferredSizeMode: true },
  });
  const wc = bw.webContents;
  const entry = { kwin, extId: ext.id, bw };
  popups.set(wc.id, entry);
  const place = (width, height) => {
    const w = Math.max(25, Math.min(800, Math.ceil(width)));
    const h = Math.max(25, Math.min(600, Math.ceil(height)));
    const area = screen.getDisplayMatching(content).workArea;
    let x = Math.round(content.x + rect.x + rect.width - w);
    let y = Math.round(content.y + rect.y + rect.height + 4);
    x = Math.max(area.x + 4, Math.min(x, area.x + area.width - w - 4));
    y = Math.max(area.y, Math.min(y, area.y + area.height - h - 4));
    bw.setBounds({ x, y, width: w, height: h });
  };
  let shown = false;
  const show = () => {
    if (shown || bw.isDestroyed()) return;
    shown = true;
    bw.show();
    wc.focus();
  };
  wc.on('preferred-size-changed', (_e, size) => {
    place(size.width, size.height);
    if (wc.getURL() && !wc.isLoading()) show();
  });
  wc.on('did-finish-load', () => setTimeout(show, 60));
  wc.setWindowOpenHandler(({ url }) => {
    kwin.createTab(url);
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => {
    const { Menu } = require('electron');
    Menu.buildFromTemplate([{ label: 'Inspecionar pop-up', click: () => wc.inspectElement(params.x, params.y) }]).popup({ window: bw });
  });
  bw.on('blur', () => {
    if (!bw.isDestroyed() && !wc.isDevToolsOpened()) bw.close();
  });
  bw.on('closed', () => {
    popups.delete(wc.id);
    kwin.sendUi('extensions:popup', null);
  });
  place(25, 25);
  kwin.sendUi('extensions:popup', ext.id);
  wc.loadURL(new URL(popupPath, `chrome-extension://${ext.id}/`).href).catch(() => {});
}

// ---------------------------------------------------------------------------
// chrome.contextMenus: items extensions add to the page's right-click menu

/** @type {Map<string, Map<string|number, object>>} */
const menus = new Map();
const menusOf = (extId) => menus.get(extId) || menus.set(extId, new Map()).get(extId);

const MENU_PROPS = ['type', 'title', 'checked', 'contexts', 'visible', 'parentId', 'documentUrlPatterns', 'targetUrlPatterns', 'enabled'];

const contextMenusApi = {
  create: (ctx, props = {}) => {
    const items = menusOf(ctx.ext.id);
    if (items.has(props.id)) throw new Error(`Cannot create item with duplicate id ${props.id}`);
    if (props.parentId != null && !items.has(props.parentId)) throw new Error(`Cannot find menu item with id ${props.parentId}`);
    const item = { id: props.id, type: 'normal', contexts: ['page'], enabled: true, visible: true };
    for (const k of MENU_PROPS) if (props[k] !== undefined) item[k] = props[k];
    items.set(props.id, item);
  },
  update: (ctx, id, props = {}) => {
    const item = menusOf(ctx.ext.id).get(id);
    if (!item) throw new Error(`Cannot find menu item with id ${id}`);
    for (const k of MENU_PROPS) if (props[k] !== undefined) item[k] = props[k];
  },
  remove: (ctx, id) => {
    const items = menusOf(ctx.ext.id);
    if (!items.has(id)) throw new Error(`Cannot find menu item with id ${id}`);
    const drop = (key) => {
      items.delete(key);
      for (const [k, v] of items) if (v.parentId === key) drop(k);
    };
    drop(id);
  },
  removeAll: (ctx) => menus.delete(ctx.ext.id),
};

function menuContexts(params) {
  const contexts = new Set(['all']);
  if (params.linkURL) contexts.add('link');
  if (params.isEditable) contexts.add('editable');
  if (params.selectionText?.trim()) contexts.add('selection');
  if (['image', 'video', 'audio'].includes(params.mediaType)) contexts.add(params.mediaType);
  if (params.frameURL) contexts.add('frame');
  if (contexts.size === 1 || (contexts.size === 2 && contexts.has('frame'))) contexts.add('page');
  return contexts;
}

function frameIdOf(wc, frame) {
  if (!frame || frame.isDestroyed?.()) return 0;
  return frame === wc.mainFrame ? 0 : frame.frameTreeNodeId;
}

/**
 * Electron menu items for the extensions' entries, for a right-click on a page
 * (`target` 'page') or on an extension's button (`target` 'action').
 */
function contextMenuItems({ kwin, tab, params = {}, target = 'page', onlyExt = null }) {
  const wc = tab?.view.webContents;
  const contexts = target === 'action' ? new Set(['all', 'action', 'browser_action', 'page_action']) : menuContexts(params);
  const pageUrl = params.pageURL || wc?.getURL() || '';
  const out = [];
  for (const extId of loadedIds()) {
    if (onlyExt && extId !== onlyExt) continue;
    const ext = extension(extId);
    const items = menus.get(extId);
    if (!ext || !items?.size) continue;
    const fits = (item) => {
      if (item.visible === false) return false;
      if (item.parentId == null) {
        const wants = item.contexts || ['page'];
        if (!wants.some((c) => contexts.has(c) && (c !== 'all' || target === 'page'))) return false;
      }
      if (item.documentUrlPatterns?.length && !item.documentUrlPatterns.some((p) => matchesPattern(p, params.frameURL || pageUrl))) return false;
      const targetUrl = params.linkURL || params.srcURL;
      if (item.targetUrlPatterns?.length && targetUrl && !item.targetUrlPatterns.some((p) => matchesPattern(p, targetUrl))) return false;
      return true;
    };
    const build = (parentId) =>
      [...items.values()]
        .filter((item) => (item.parentId ?? null) === parentId && fits(item))
        .map((item) => {
          if (item.type === 'separator') return { type: 'separator' };
          const children = build(item.id);
          const label = String(item.title || ext.name).replace(/%s/g, (params.selectionText || '').trim().slice(0, 40));
          const entry = { label, enabled: item.enabled !== false };
          if (children.length) entry.submenu = children;
          else {
            if (item.type === 'checkbox' || item.type === 'radio') Object.assign(entry, { type: item.type, checked: !!item.checked });
            entry.click = () => {
              const wasChecked = !!item.checked;
              if (item.type === 'checkbox') item.checked = !wasChecked;
              if (item.type === 'radio') {
                for (const other of items.values()) if (other.type === 'radio' && other.parentId === item.parentId) other.checked = false;
                item.checked = true;
              }
              const info = {
                menuItemId: item.id,
                parentMenuItemId: item.parentId,
                editable: !!params.isEditable,
                pageUrl,
                frameId: frameIdOf(wc, params.frame),
              };
              if (params.frameURL) info.frameUrl = params.frameURL;
              if (params.linkURL) info.linkUrl = params.linkURL;
              if (params.srcURL) info.srcUrl = params.srcURL;
              if (params.mediaType && params.mediaType !== 'none') info.mediaType = params.mediaType;
              if (params.selectionText) info.selectionText = params.selectionText;
              if (item.type === 'checkbox' || item.type === 'radio') Object.assign(info, { wasChecked, checked: item.checked });
              dispatch(extId, 'contextMenus.onClicked', [info, tab ? tabInfo({ w: kwin, tab }) : undefined]);
            };
          }
          return entry;
        });
    const top = build(null);
    if (!top.length) continue;
    const icon = extensionIcon(ext, 16);
    const image = icon ? nativeImage.createFromDataURL(icon).resize({ width: 16, height: 16 }) : undefined;
    if (top.length === 1 && top[0].type !== 'separator') out.push({ ...top[0], icon: image });
    else out.push({ label: ext.name, icon: image, submenu: top });
  }
  return out;
}

// ---------------------------------------------------------------------------
// chrome.webNavigation, from each tab's navigation events

const navTracked = new WeakSet();

function frameDetails(wc, frame) {
  const parent = frame?.parent;
  return {
    tabId: wc.id,
    frameId: frameIdOf(wc, frame),
    parentFrameId: parent ? frameIdOf(wc, parent) : -1,
    processId: frame?.processId ?? -1,
    frameType: !frame || frame === wc.mainFrame ? 'outermost_frame' : 'sub_frame',
    documentLifecycle: 'active',
    timeStamp: Date.now(),
  };
}

function watchNavigation(wc) {
  if (navTracked.has(wc)) return;
  navTracked.add(wc);
  const frameFrom = (processId, routingId) => {
    try {
      return webFrameMain.fromId(processId, routingId) || null;
    } catch {
      return null;
    }
  };
  const send = (name, details) => {
    if (!anyListener(`webNavigation.${name}`)) return;
    broadcast(`webNavigation.${name}`, [details]);
  };
  wc.on('did-start-navigation', (details) => {
    if (details.isSameDocument) return;
    send('onBeforeNavigate', { ...frameDetails(wc, details.frame), url: details.url });
  });
  wc.on('did-frame-navigate', (_e, url, _code, _status, isMainFrame, processId, routingId) => {
    if (isMainFrame) clearTabActions(wc.id);
    send('onCommitted', { ...frameDetails(wc, frameFrom(processId, routingId)), url, transitionType: 'link', transitionQualifiers: [] });
  });
  wc.on('dom-ready', () => send('onDOMContentLoaded', { ...frameDetails(wc, wc.mainFrame), url: wc.getURL() }));
  wc.on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
    const frame = frameFrom(processId, routingId);
    const details = { ...frameDetails(wc, frame), url: frame?.url || wc.getURL() };
    if (!isMainFrame) send('onDOMContentLoaded', details);
    send('onCompleted', details);
  });
  wc.on('did-fail-load', (_e, code, desc, url, _isMainFrame, processId, routingId) => {
    if (code === -3) return;
    send('onErrorOccurred', { ...frameDetails(wc, frameFrom(processId, routingId)), url, error: desc || `net::${code}` });
  });
  wc.on('did-navigate-in-page', (_e, url, _isMainFrame, processId, routingId) => {
    send('onHistoryStateUpdated', { ...frameDetails(wc, frameFrom(processId, routingId)), url, transitionType: 'link', transitionQualifiers: [] });
  });
}

/** Tab-specific button values (badge, icon…) end when the tab goes to another page, like in Chrome. */
function clearTabActions(id) {
  let changed = false;
  for (const state of actions.values()) changed = state.tabs.delete(id) || changed;
  if (changed) hooks.stateChanged();
}

function frameInfo(wc, frame) {
  const d = frameDetails(wc, frame);
  return { frameId: d.frameId, parentFrameId: d.parentFrameId, processId: d.processId, url: frame.url, errorOccurred: false, frameType: d.frameType, documentLifecycle: 'active' };
}

const webNavigationApi = {
  getFrame: (ctx, { tabId: id, frameId } = {}) => {
    const t = tabById(Number(id));
    if (!t) return null;
    const wc = tabWebContents(t);
    const frame = frameId === 0 ? wc.mainFrame : wc.mainFrame.framesInSubtree.find((f) => f.frameTreeNodeId === frameId);
    return frame ? frameInfo(wc, frame) : null;
  },
  getAllFrames: (ctx, { tabId: id } = {}) => {
    const t = tabById(Number(id));
    if (!t) return null;
    const wc = tabWebContents(t);
    return wc.mainFrame.framesInSubtree.filter((f) => !f.isDestroyed()).map((f) => frameInfo(wc, f));
  },
};

// ---------------------------------------------------------------------------
// Notifications, permissions, commands, side panel, privacy, runtime extras

const notifications = new Map(); // `${extId}:${id}` → Notification

const notificationsApi = {
  create: (ctx, id, options = {}) => {
    const nid = id || `kitty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = `${ctx.ext.id}:${nid}`;
    notifications.get(key)?.close();
    let icon;
    if (typeof options.iconUrl === 'string') {
      if (options.iconUrl.startsWith('data:')) icon = nativeImage.createFromDataURL(options.iconUrl);
      else {
        const file = extensionFile(ctx.ext, options.iconUrl.replace(`chrome-extension://${ctx.ext.id}/`, ''));
        if (file) icon = nativeImage.createFromPath(file);
      }
    }
    if (!Notification.isSupported()) return nid;
    const n = new Notification({ title: options.title || ctx.ext.name, body: options.message || '', icon, silent: !!options.silent });
    n.on('click', () => dispatch(ctx.ext.id, 'notifications.onClicked', [nid]));
    n.on('close', () => {
      notifications.delete(key);
      dispatch(ctx.ext.id, 'notifications.onClosed', [nid, true]);
    });
    notifications.set(key, n);
    n.show();
    return nid;
  },
  update: (ctx, id) => notifications.has(`${ctx.ext.id}:${id}`),
  clear: (ctx, id) => {
    const n = notifications.get(`${ctx.ext.id}:${id}`);
    n?.close();
    notifications.delete(`${ctx.ext.id}:${id}`);
    return !!n;
  },
  getAll: (ctx) => Object.fromEntries([...notifications.keys()].filter((k) => k.startsWith(`${ctx.ext.id}:`)).map((k) => [k.slice(ctx.ext.id.length + 1), true])),
  getPermissionLevel: () => 'granted',
};

/** Optional permissions extensions asked for (Kitty grants them; extensions are trusted on install). */
const granted = new Map();

function declaredPermissions(ext) {
  const m = ext.manifest;
  const extra = granted.get(ext.id) || { permissions: new Set(), origins: new Set() };
  const hosts = m.manifest_version >= 3 ? m.host_permissions || [] : (m.permissions || []).filter((p) => p.includes('://') || p === '<all_urls>');
  const perms = (m.permissions || []).filter((p) => !hosts.includes(p));
  return { permissions: [...new Set([...perms, ...extra.permissions])], origins: [...new Set([...hosts, ...extra.origins])] };
}

const permissionsApi = {
  contains: (ctx, { permissions = [], origins = [] } = {}) => {
    const have = declaredPermissions(ctx.ext);
    return permissions.every((p) => have.permissions.includes(p)) && origins.every((o) => have.origins.includes(o) || have.origins.includes('<all_urls>') || have.origins.some((h) => matchesPattern(h, o.replace(/\*$/, ''))));
  },
  getAll: (ctx) => declaredPermissions(ctx.ext),
  request: (ctx, { permissions = [], origins = [] } = {}) => {
    const extra = granted.get(ctx.ext.id) || { permissions: new Set(), origins: new Set() };
    permissions.forEach((p) => extra.permissions.add(p));
    origins.forEach((o) => extra.origins.add(o));
    granted.set(ctx.ext.id, extra);
    dispatch(ctx.ext.id, 'permissions.onAdded', [{ permissions, origins }]);
    return true;
  },
  remove: (ctx, { permissions = [], origins = [] } = {}) => {
    const extra = granted.get(ctx.ext.id);
    if (extra) {
      permissions.forEach((p) => extra.permissions.delete(p));
      origins.forEach((o) => extra.origins.delete(o));
    }
    return true;
  },
};

const commandsApi = {
  getAll: (ctx) =>
    Object.entries(ctx.ext.manifest.commands || {}).map(([name, c]) => ({ name, description: c.description || '', shortcut: '' })),
};

const sidePanels = new Map();
const sidePanelState = (extId) => sidePanels.get(extId) || sidePanels.set(extId, { openPanelOnActionClick: false, options: {} }).get(extId);
const sidePanelPath = (ext) => sidePanelState(ext.id).options.path || ext.manifest.side_panel?.default_path || '';

const sidePanelApi = {
  setPanelBehavior: (ctx, b = {}) => {
    if (typeof b.openPanelOnActionClick === 'boolean') sidePanelState(ctx.ext.id).openPanelOnActionClick = b.openPanelOnActionClick;
  },
  getPanelBehavior: (ctx) => ({ openPanelOnActionClick: sidePanelState(ctx.ext.id).openPanelOnActionClick }),
  setOptions: (ctx, o = {}) => {
    if (o.tabId == null) Object.assign(sidePanelState(ctx.ext.id).options, o);
  },
  getOptions: (ctx) => ({ enabled: true, path: sidePanelPath(ctx.ext) }),
  // Kitty has no side panel: the page opens in a tab.
  open: (ctx) => {
    const page = sidePanelPath(ctx.ext);
    if (!page) throw new Error('Esta extensão não tem painel lateral.');
    const kwin = kittyWindowFor(ctx) || hooks.newWindow();
    kwin.createTab(resolveUrl(ctx.ext, page));
  },
};

const privacyValues = new Map();
const PRIVACY_DEFAULTS = {
  'services.passwordSavingEnabled': true,
  'services.autofillEnabled': false,
  'services.autofillAddressEnabled': false,
  'services.autofillCreditCardEnabled': false,
  'services.searchSuggestEnabled': true,
  'network.networkPredictionEnabled': false,
  'network.webRTCIPHandlingPolicy': 'default_public_interface_only',
  'websites.thirdPartyCookiesAllowed': false,
  'websites.hyperlinkAuditingEnabled': false,
  'websites.doNotTrackEnabled': true,
};

const privacyApi = {
  get: (ctx, key) => ({
    value: privacyValues.has(`${ctx.ext.id}:${key}`) ? privacyValues.get(`${ctx.ext.id}:${key}`) : PRIVACY_DEFAULTS[key] ?? false,
    levelOfControl: 'controllable_by_this_extension',
  }),
  set: (ctx, key, details = {}) => void privacyValues.set(`${ctx.ext.id}:${key}`, details.value),
  clear: (ctx, key) => void privacyValues.delete(`${ctx.ext.id}:${key}`),
};

function optionsPage(ext) {
  const page = ext.manifest.options_ui?.page || ext.manifest.options_page;
  return page ? new URL(page, `chrome-extension://${ext.id}/`).href : null;
}

/** Opens an extension's settings page, reusing a tab that already shows it. */
function openOptions(ext) {
  const url = optionsPage(ext);
  if (!url) return false;
  for (const kwin of kittyWindows()) {
    const id = kwin.order.find((tid) => kwin.tabs.get(tid).view.webContents.getURL().startsWith(url));
    if (id != null) {
      kwin.switchTab(id);
      kwin.win.focus();
      return true;
    }
  }
  const kwin = registry.current({ allowPrivate: false }) || hooks.newWindow();
  kwin.createTab(url);
  kwin.win.focus();
  return true;
}

const runtimeApi = {
  openOptionsPage: (ctx) => {
    if (!openOptions(ctx.ext)) throw new Error('Esta extensão não tem página de opções.');
  },
  viewType: (ctx) => (ctx.sender && popups.has(ctx.sender.id) ? 'popup' : 'tab'),
};

const API = {
  tabs: tabsApi,
  windows: windowsApi,
  action: actionApi,
  browserAction: actionApi,
  contextMenus: contextMenusApi,
  webNavigation: webNavigationApi,
  notifications: notificationsApi,
  permissions: permissionsApi,
  commands: commandsApi,
  sidePanel: sidePanelApi,
  privacy: privacyApi,
  runtime: runtimeApi,
};

// ---------------------------------------------------------------------------
// Calls and events between the main process and extension contexts

/** @type {Map<string, { worker: Set<string>, frames: Map<string, { frame: Electron.WebFrameMain, names: Set<string> }> }>} */
const listeners = new Map();
const listenersOf = (extId) => listeners.get(extId) || listeners.set(extId, { worker: new Set(), frames: new Map() }).get(extId);
/** @type {Map<string, Electron.ServiceWorkerMain>} running service worker of each extension */
const workers = new Map();
const attachedWorkers = new WeakSet();

function anyListener(name) {
  for (const l of listeners.values()) {
    if (l.worker.has(name)) return true;
    for (const f of l.frames.values()) if (f.names.has(name)) return true;
  }
  return false;
}

async function handleCall(ctx, methodName, args) {
  const [ns, fn] = String(methodName).split('.');
  const impl = API[ns]?.[fn];
  if (!impl) throw new Error(`chrome.${methodName} ainda não funciona no Kitty.`);
  ctx.ext = extension(ctx.extId);
  if (!ctx.ext) throw new Error('Extensão desligada.');
  return impl(ctx, ...(Array.isArray(args) ? args : []));
}

/** The extension behind an IPC message from a frame, if it really comes from one of its pages. */
function frameContext(event) {
  const frame = event.senderFrame;
  if (!ses || event.sender.session !== ses || !frame?.url?.startsWith('chrome-extension://')) return null;
  const extId = new URL(frame.url).host;
  return extension(extId) ? { extId, sender: event.sender, frame } : null;
}

function attachWorker(worker) {
  if (!worker || attachedWorkers.has(worker) || !worker.scope?.startsWith('chrome-extension://')) return;
  const extId = new URL(worker.scope).host;
  if (!extension(extId)) return;
  attachedWorkers.add(worker);
  workers.set(extId, worker);
  try {
    worker.ipc.handle('ext:call', (_event, method, args) => handleCall({ extId, worker }, method, args));
    worker.ipc.on('ext:listen', (_event, name) => listenersOf(extId).worker.add(String(name)));
  } catch (err) {
    console.error('[kitty] extension worker', err);
  }
}

function dispatch(extId, name, args) {
  const l = listeners.get(extId);
  if (!l || !extension(extId)) return;
  for (const [key, entry] of l.frames) {
    const { frame } = entry;
    if (frame.isDestroyed() || !frame.url.startsWith(`chrome-extension://${extId}/`)) {
      l.frames.delete(key);
      continue;
    }
    if (entry.names.has(name)) frame.send('ext:event', name, args);
  }
  if (!l.worker.has(name)) return;
  const worker = workers.get(extId);
  if (worker && !worker.isDestroyed()) {
    try {
      return void worker.send('ext:event', name, args);
    } catch {}
  }
  // Asleep: wake it up, like Chrome does for events it listens to.
  ses.serviceWorkers
    .startWorkerForScope(`chrome-extension://${extId}/`)
    .then((w) => {
      attachWorker(w);
      w.send('ext:event', name, args);
    })
    .catch(() => {});
}

function broadcast(name, args) {
  for (const extId of loadedIds()) dispatch(extId, name, args);
}

// ---------------------------------------------------------------------------
// Tab and window events, worked out by comparing snapshots after each change

let previous = null;
let diffQueued = false;

function snapshot() {
  const tabs = new Map();
  const windows = new Map();
  for (const w of allWindows()) {
    const active = isKitty(w) ? w.activeId : null;
    windows.set(windowId(w), { active, count: tabsOf(w).length });
    for (const t of tabsOf(w)) {
      const info = tabInfo(t);
      tabs.set(info.id, info);
    }
  }
  const focused = focusedWindow();
  return { tabs, windows, focused: focused && (isKitty(focused) ? focused.win.isFocused() : focused.bw.isFocused()) ? windowId(focused) : -1 };
}

const TRACKED = ['status', 'url', 'title', 'favIconUrl', 'audible', 'pinned', 'discarded'];

function compare(before, after) {
  for (const [id, w] of after.windows) if (!before.windows.has(id)) broadcast('windows.onCreated', [windowInfo(windowById(id))]);
  for (const [id, t] of after.tabs) {
    const old = before.tabs.get(id);
    if (!old) {
      broadcast('tabs.onCreated', [t]);
      continue;
    }
    if (old.windowId !== t.windowId) {
      broadcast('tabs.onDetached', [id, { oldWindowId: old.windowId, oldPosition: old.index }]);
      broadcast('tabs.onAttached', [id, { newWindowId: t.windowId, newPosition: t.index }]);
    } else if (old.index !== t.index && before.windows.get(t.windowId)?.count === after.windows.get(t.windowId)?.count) {
      broadcast('tabs.onMoved', [id, { windowId: t.windowId, fromIndex: old.index, toIndex: t.index }]);
    }
    const change = {};
    for (const k of TRACKED) if (old[k] !== t[k]) change[k] = t[k];
    if (old.mutedInfo.muted !== t.mutedInfo.muted) change.mutedInfo = t.mutedInfo;
    if (Object.keys(change).length) broadcast('tabs.onUpdated', [id, change, t]);
  }
  for (const [id, old] of before.tabs) {
    if (after.tabs.has(id)) continue;
    broadcast('tabs.onRemoved', [id, { windowId: old.windowId, isWindowClosing: !after.windows.has(old.windowId) }]);
    for (const state of actions.values()) state.tabs.delete(id);
  }
  for (const [id, w] of after.windows) {
    const old = before.windows.get(id);
    if (w.active != null && old?.active !== w.active) {
      broadcast('tabs.onActivated', [{ tabId: w.active, windowId: id }]);
      broadcast('tabs.onHighlighted', [{ windowId: id, tabIds: [w.active] }]);
      hooks.stateChanged();
    }
  }
  for (const id of before.windows.keys()) if (!after.windows.has(id)) broadcast('windows.onRemoved', [id]);
  if (before.focused !== after.focused) broadcast('windows.onFocusChanged', [after.focused]);
}

/** Something changed in a window or tab (window.js reports every change). */
function browserChanged() {
  if (diffQueued || !ses) return;
  diffQueued = true;
  setImmediate(() => {
    diffQueued = false;
    const next = snapshot();
    if (previous) compare(previous, next);
    previous = next;
  });
}

function init(session) {
  ses = session;
  ipcMain.handle('ext:call', (event, method, args) => {
    const ctx = frameContext(event);
    if (!ctx) throw new Error('Sem permissão.');
    return handleCall(ctx, method, args);
  });
  ipcMain.on('ext:listen', (event, name) => {
    const ctx = frameContext(event);
    if (!ctx) return;
    const { frames } = listenersOf(ctx.extId);
    const key = `${ctx.frame.processId}:${ctx.frame.routingId}`;
    if (!frames.has(key) || frames.get(key).frame !== ctx.frame) frames.set(key, { frame: ctx.frame, names: new Set() });
    frames.get(key).names.add(String(name));
  });
  ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
    if (runningStatus !== 'starting' && runningStatus !== 'running') return;
    try {
      attachWorker(ses.serviceWorkers.getWorkerFromVersionID(versionId));
    } catch {}
  });
  ses.extensions.on('extension-unloaded', (_e, ext) => {
    actions.delete(ext.id);
    menus.delete(ext.id);
    listeners.delete(ext.id);
    workers.delete(ext.id);
    for (const p of [...popups.values()]) if (p.extId === ext.id && !p.bw.isDestroyed()) p.bw.close();
    for (const w of [...extWindows.values()]) if (w.extId === ext.id && !w.bw.isDestroyed()) w.bw.close();
  });
  previous = snapshot();
}

module.exports = {
  hooks,
  init,
  browserChanged,
  watchNavigation,
  clickAction,
  closePopups,
  contextMenuItems,
  toolbarState,
  extensionIcon,
  optionsPage,
  openOptions,
  resolveUrl,
};
