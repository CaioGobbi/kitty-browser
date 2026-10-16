'use strict';

// One Kitty browser window: the browser UI (tab strip, toolbar, bars) as a
// WebContentsView on top, and one WebContentsView per tab below it.
const path = require('node:path');
const { BaseWindow, WebContentsView, nativeTheme, session } = require('electron');

const { data, searchUrl, isInternal, isShieldUp, isBookmarked, originOf } = require('./data');
const { registry } = require('./registry');
const { httpFallbackFor } = require('./privacy');

const UI_DIR = path.join(__dirname, '..', 'ui');
const NEW_TAB_URL = 'kitty://newtab';
const DEFAULT_CHROME_HEIGHT = 84;
const HISTORY_LIMIT = 5000;
const CLOSED_TABS_LIMIT = 25;

let privateCounter = 0;

/** Set by main.js: { setupProfile(ses, opts), onChange(), contextMenu(kwin, tab, params), shortcut(input), favicon(ses, pageUrl, iconUrl), tabCreated(kwin, tab), passwordOffer(tab) } */
const hooks = { setupProfile() {}, onChange() {}, contextMenu() {}, shortcut: () => false, favicon() {}, tabCreated() {}, passwordOffer: () => null };

/** Windows/Linux draw the minimize/maximize/close buttons over the tab strip: match its colors. */
function titleBarOverlay(isPrivate) {
  if (isPrivate) return { height: 40, color: '#160f22', symbolColor: '#ece8f2' };
  return nativeTheme.shouldUseDarkColors
    ? { height: 40, color: '#121016', symbolColor: '#ece8f2' }
    : { height: 40, color: '#e9e5ef', symbolColor: '#1d1a24' };
}

/** On Windows/Linux, keyboard shortcuts are matched per webContents (see menus.js). */
function listenForShortcuts(webContents) {
  if (process.platform === 'darwin') return;
  webContents.on('before-input-event', (event, input) => {
    if (hooks.shortcut(input)) event.preventDefault();
  });
}

/** Turns whatever the user typed in the address bar into a URL. */
function resolveInput(input) {
  const text = String(input || '').trim();
  if (!text) return NEW_TAB_URL;
  if (/^(https?|kitty|file|view-source|chrome-extension):/i.test(text) || /^about:/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) {
    return `http://${text}`;
  }
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  return searchUrl(text);
}

class KittyWindow {
  /**
   * `adopt` is a tab dragged out of another window: the new window takes it
   * over, page and all, and shares that window's session (private included).
   * @param {{ isPrivate?: boolean, restore?: { tabs: {url: string, title?: string, favicon?: string}[], active?: number }, adopt?: object, bounds?: {x: number, y: number, width: number, height: number} }} options
   */
  constructor({ isPrivate = false, restore = null, adopt = null, bounds = null } = {}) {
    if (adopt) isPrivate = adopt.owner.isPrivate;
    this.isPrivate = isPrivate;
    this.session = adopt
      ? adopt.owner.session
      : isPrivate
        ? session.fromPartition(`kitty-private-${++privateCounter}`) // in memory only
        : session.fromPartition('persist:kitty');
    if (isPrivate && !adopt) hooks.setupProfile(this.session, { isPrivate: true });

    /** @type {Map<number, any>} */
    this.tabs = new Map();
    this.order = [];
    this.activeId = null;
    this.closedTabs = [];
    this.privatePermissions = {};
    this.chromeHeight = DEFAULT_CHROME_HEIGHT;
    this.chromeLeft = 0; // width of the vertical tab strip, when tabs are on the side
    /** Where the tabs are, in window content coordinates, for dragging tabs between windows (tabdrag.js). */
    this.strip = { x: 0, y: 0, width: Infinity, height: 40, vertical: false };
    this.overlay = false;
    this.htmlFullscreen = false;
    this.findText = '';
    this.stateTimer = null;

    this.win = new BaseWindow({
      width: 1280,
      height: 820,
      ...bounds,
      show: !adopt, // shown without focus, so the drag carrying it goes on
      minWidth: 480,
      minHeight: 320,
      title: isPrivate ? 'Kitty — Janela privativa' : 'Kitty',
      backgroundColor: isPrivate ? '#1a1326' : nativeTheme.shouldUseDarkColors ? '#17151c' : '#f6f4f9',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 14, y: 13 },
      titleBarOverlay: process.platform === 'darwin' ? false : titleBarOverlay(isPrivate),
    });
    if (process.platform !== 'darwin') {
      this.onThemeChange = () => this.win.setTitleBarOverlay(titleBarOverlay(isPrivate));
      nativeTheme.on('updated', this.onThemeChange);
    }

    this.ui = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload-ui.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.ui.setBackgroundColor('#00000000');
    listenForShortcuts(this.ui.webContents);
    this.win.contentView.addChildView(this.ui);
    this.ui.webContents.loadFile(path.join(UI_DIR, 'index.html'), {
      query: {
        private: isPrivate ? '1' : '0',
        layout: data.settings.get('tabLayout'),
        collapsed: data.settings.get('verticalTabsCollapsed') ? '1' : '0',
      },
    });
    this.ui.webContents.once('did-finish-load', () => {
      if (adopt) return;
      if (restore?.tabs?.length) this.restoreTabs(restore);
      else this.createTab();
    });

    this.win.on('resize', () => this.layout());
    // Three-finger swipe (macOS, when set to "swipe between pages") and the
    // mouse back/forward buttons on Windows.
    this.win.on('swipe', (_e, direction) => {
      if (direction === 'right') this.goBack();
      if (direction === 'left') this.goForward();
    });
    this.win.on('app-command', (_e, command) => {
      if (command === 'browser-backward') this.goBack();
      if (command === 'browser-forward') this.goForward();
    });
    this.win.on('focus', () => {
      registry.focus(this);
      hooks.onChange();
    });
    this.win.on('blur', () => hooks.onChange());
    this.win.on('enter-full-screen', () => this.sendUi('ui:fullscreen', true));
    this.win.on('leave-full-screen', () => {
      this.sendUi('ui:fullscreen', false);
      if (this.htmlFullscreen) this.activeTab()?.view.webContents.executeJavaScript('document.exitFullscreen?.()', true).catch(() => {});
    });
    this.win.on('closed', () => this.destroy());

    registry.add(this);
    if (adopt) {
      this.adoptTab(adopt, 0, { focus: false });
      this.win.showInactive();
    }
    this.layout();
  }

  // -------------------------------------------------------------------------
  // Plumbing

  sendUi(channel, payload) {
    const wc = this.ui.webContents;
    if (!wc.isDestroyed()) wc.send(channel, payload);
  }

  activeTab() {
    return this.activeId != null ? this.tabs.get(this.activeId) : null;
  }

  activeWebContents() {
    return this.activeTab()?.view.webContents || null;
  }

  tabState(tab) {
    const wc = tab.view.webContents;
    const url = tab.pendingUrl || wc.getURL();
    const internal = isInternal(url);
    const prompt = tab.prompts[0];
    return {
      id: tab.id,
      title: (tab.pendingUrl ? tab.pendingTitle : wc.getTitle()) || (internal ? 'Nova aba' : url),
      url,
      favicon: tab.favicon,
      loading: !tab.pendingUrl && wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      blocked: tab.blocked.size,
      shieldUp: internal ? true : isShieldUp(url),
      internal,
      audible: !tab.pendingUrl && wc.isCurrentlyAudible(),
      muted: wc.isAudioMuted(),
      bookmarked: isBookmarked(url),
      pinned: tab.pinned,
      prompt: prompt ? { id: prompt.id, origin: prompt.origin, label: prompt.label } : null,
      passwordOffer: hooks.passwordOffer(tab),
    };
  }

  sendState() {
    clearTimeout(this.stateTimer);
    this.stateTimer = null;
    if (this.win.isDestroyed()) return;
    const active = this.activeTab();
    if (active) this.win.setTitle(this.tabState(active).title);
    this.sendUi('tabs:state', {
      activeTabId: this.activeId,
      tabs: this.order.map((id) => this.tabState(this.tabs.get(id))),
      isPrivate: this.isPrivate,
    });
    hooks.onChange();
  }

  /** Coalesces bursts of updates (e.g. many blocked requests) into one UI message. */
  sendStateSoon() {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => this.sendState(), 100);
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    const tab = this.activeTab();
    if (this.htmlFullscreen) {
      this.ui.setVisible(false);
      tab?.view.setBounds({ x: 0, y: 0, width, height });
      return;
    }
    this.ui.setVisible(true);
    // With tabs on the side the UI is L-shaped, so its view covers the whole
    // window and the page goes on top of it; a dropdown brings the UI back up.
    const left = this.chromeLeft;
    this.ui.setBounds({ x: 0, y: 0, width, height: this.overlay || left ? height : this.chromeHeight });
    tab?.view.setBounds({ x: left, y: this.chromeHeight, width: Math.max(0, width - left), height: Math.max(0, height - this.chromeHeight) });
    const top = this.overlay || !left ? this.ui : tab?.view;
    const children = this.win.contentView.children;
    if (top && children.at(-1) !== top) this.win.contentView.addChildView(top); // already a child: just moves to the top
  }

  /** The UI asks for more room (bars, the side tab strip) or the whole window (dropdowns). */
  setChrome({ height, left, overlay, strip }) {
    if (Number.isFinite(height)) this.chromeHeight = Math.max(40, Math.min(400, Math.round(height)));
    if (Number.isFinite(left)) this.chromeLeft = Math.max(0, Math.min(600, Math.round(left)));
    if (typeof overlay === 'boolean') this.overlay = overlay;
    if (strip && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(strip[k]))) {
      this.strip = { x: strip.x, y: strip.y, width: strip.width, height: strip.height, vertical: !!strip.vertical };
    }
    this.layout();
  }

  focusAddressBar() {
    this.ui.webContents.focus();
    this.sendUi('ui:focus-address');
  }

  snapshot() {
    return {
      tabs: this.order.map((id) => {
        const s = this.tabState(this.tabs.get(id));
        return { url: s.url, title: s.title, favicon: s.favicon, pinned: s.pinned };
      }),
      active: Math.max(0, this.order.indexOf(this.activeId)),
    };
  }

  // -------------------------------------------------------------------------
  // Tabs

  createTab(url = NEW_TAB_URL, { activate = true, index = null, lazy = false, title = '', favicon = null, pinned = false } = {}) {
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        preload: path.join(__dirname, 'preload-page.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    // WebRTC only uses the default route's public address: local network
    // addresses (and the real IP behind a split VPN) aren't exposed to sites.
    wc.setWebRTCIPHandlingPolicy('default_public_interface_only');
    listenForShortcuts(wc);
    const tab = {
      id: wc.id,
      owner: this, // the KittyWindow showing this tab; changes when the tab moves
      view,
      blocked: new Set(),
      favicon,
      prompts: [],
      pendingUrl: lazy ? url : null,
      pendingTitle: title,
      pinned,
      pendingLogin: null, // a login form the page just submitted (passwords.js)
      passwordOffer: null, // the "save password?" bar
    };
    // A blank new tab goes to the end of the strip; a link opened from a page
    // goes right next to the tab it came from.
    const besideActive = url !== NEW_TAB_URL && this.activeId != null;
    const at = index ?? (besideActive ? this.order.indexOf(this.activeId) + 1 : this.order.length);
    this.order.splice(this.clampToGroup(at, pinned), 0, tab.id);
    this.tabs.set(tab.id, tab);

    this.wireTab(tab);
    if (!lazy) wc.loadURL(url).catch(() => {}); // failures are handled by did-fail-load
    if (activate) this.switchTab(tab.id);
    else this.sendState();
    return tab;
  }

  // Handlers go through tab.owner, not `this`: a tab can move to another window.
  wireTab(tab) {
    const wc = tab.view.webContents;

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'new-window') {
        // Real popups (OAuth sign-in, payment flows) need window.opener: let
        // them open as a small window of their own.
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            autoHideMenuBar: true,
            webPreferences: { sandbox: true, contextIsolation: true },
          },
        };
      }
      tab.owner.createTab(url, { activate: disposition !== 'background-tab' });
      return { action: 'deny' };
    });

    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        // kitty:// pages paint their own background; websites without one
        // expect white, as in any browser (a transparent view showed the dark
        // window behind them, with dark text on top).
        tab.view.setBackgroundColor(isInternal(details.url) ? '#00000000' : '#ffffff');
        tab.blocked.clear();
        tab.owner.denyPrompts(tab);
      }
      tab.owner.sendState();
    });
    wc.on('did-navigate', (_e, url) => {
      // Chromium only reports a favicon when it changes, so a reload keeps the
      // old one; it's cleared only when the tab moves to another site.
      if (originOf(url) !== tab.faviconOrigin) tab.favicon = null;
      if (url.startsWith('kitty://blocked')) tab.threatBlocked = false;
      if (url.startsWith('kitty://error')) tab.owner.dropFailedEntry(wc, url);
      tab.owner.recordHistory(wc);
      tab.owner.sendState();
    });
    wc.on('focus', () => {
      if (tab.keepAddressFocus && tab.owner.activeId === tab.id) tab.owner.focusAddressBar();
    });
    wc.on('did-stop-loading', () => {
      tab.keepAddressFocus = false;
    });
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
      if (isMainFrame) tab.owner.recordHistory(wc);
      tab.owner.sendState();
    });
    wc.on('page-title-updated', () => {
      tab.owner.recordHistory(wc);
      tab.owner.sendState();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] || null;
      tab.faviconOrigin = originOf(wc.getURL());
      if (!tab.owner.isPrivate && tab.favicon) hooks.favicon(tab.owner.session, wc.getURL(), tab.favicon);
      tab.owner.sendState();
    });
    wc.on('did-start-loading', () => tab.owner.sendState());
    wc.on('did-stop-loading', () => tab.owner.sendState());
    wc.on('audio-state-changed', () => tab.owner.sendState());
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. user hit stop)
      if (code === -20 && tab.threatBlocked) return; // blocked on purpose: the warning page is on its way
      const fallback = code !== -105 ? httpFallbackFor(failedUrl) : null; // -105 = name not resolved
      if (fallback) return wc.loadURL(fallback).catch(() => {});
      const params = new URLSearchParams({ url: failedUrl, reason: desc });
      wc.loadURL(`kitty://error?${params}`).catch(() => {});
    });
    wc.on('context-menu', (_e, params) => hooks.contextMenu(this, tab, params));
    wc.on('found-in-page', (_e, result) => {
      if (tab.id === tab.owner.activeId) tab.owner.sendUi('find:result', { active: result.activeMatchOrdinal, matches: result.matches });
    });
    // Electron itself puts the window in and out of fullscreen for the page.
    // Kitty only hides its own interface: toggling the window here too made
    // Electron think the user had chosen fullscreen, so on the way out it never
    // told the page it had left — the video stayed stuck in fullscreen mode.
    wc.on('enter-html-full-screen', () => {
      if (tab.id !== tab.owner.activeId) return;
      tab.owner.htmlFullscreen = true;
      tab.owner.layout();
    });
    wc.on('leave-html-full-screen', () => tab.owner.exitHtmlFullscreen());
    hooks.tabCreated(tab.owner, tab);
  }

  exitHtmlFullscreen() {
    if (!this.htmlFullscreen) return;
    this.htmlFullscreen = false;
    this.layout();
  }

  restoreTabs({ tabs, active = 0 }) {
    const activeIndex = Math.min(Math.max(0, active), tabs.length - 1);
    tabs.forEach((t, i) => {
      this.createTab(t.url || NEW_TAB_URL, {
        activate: false,
        index: i,
        lazy: i !== activeIndex,
        title: t.title,
        favicon: t.favicon,
        pinned: !!t.pinned,
      });
    });
    this.switchTab(this.order[activeIndex]);
  }

  switchTab(id, { focus = true } = {}) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const previous = this.activeTab();
    if (previous && previous !== tab) {
      if (this.htmlFullscreen) {
        previous.view.webContents.executeJavaScript('document.exitFullscreen?.()', true).catch(() => {});
        this.exitHtmlFullscreen();
      }
      if (this.findText) previous.view.webContents.stopFindInPage('clearSelection');
      this.win.contentView.removeChildView(previous.view);
    }
    this.activeId = id;
    this.win.contentView.addChildView(tab.view, 0); // under the UI view
    if (tab.pendingUrl) {
      const url = tab.pendingUrl;
      tab.pendingUrl = null;
      tab.view.webContents.loadURL(url).catch(() => {});
    }
    this.findText = '';
    this.sendUi('find:close');
    this.layout();
    this.sendState();

    if (!focus) return;
    const url = tab.view.webContents.getURL();
    if (!url || isInternal(url)) {
      this.focusAddressBar();
      // A page that hasn't loaded yet takes the focus when Chromium sets it up:
      // give it back to the address bar until the load ends (see wireTab).
      tab.keepAddressFocus = tab.view.webContents.isLoading() || !url;
    } else tab.view.webContents.focus();
  }

  closeTab(id = this.activeId) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const index = this.order.indexOf(id);
    const state = this.tabState(tab);
    if (!state.internal || state.url.startsWith('kitty://history') || state.url.startsWith('kitty://settings')) {
      this.closedTabs.push({ url: state.url, title: state.title, favicon: state.favicon, index });
      if (this.closedTabs.length > CLOSED_TABS_LIMIT) this.closedTabs.shift();
    }
    this.denyPrompts(tab);
    this.order.splice(index, 1);
    this.tabs.delete(id);

    if (this.order.length === 0) {
      tab.view.webContents.close();
      this.win.close();
      return;
    }
    if (this.activeId === id) {
      this.win.contentView.removeChildView(tab.view);
      this.activeId = null;
      this.exitHtmlFullscreen();
      this.switchTab(this.order[Math.min(index, this.order.length - 1)]);
    }
    tab.view.webContents.close();
    this.sendState();
  }

  closeOtherTabs(id, { onlyRight = false } = {}) {
    const index = this.order.indexOf(id);
    // Like Chrome, pinned tabs survive "close other tabs".
    const victims = this.order.filter((other, i) => other !== id && !this.tabs.get(other).pinned && (!onlyRight || i > index));
    if (this.activeId !== id && victims.includes(this.activeId)) this.switchTab(id);
    for (const other of victims) this.closeTab(other);
  }

  reopenClosedTab() {
    const last = this.closedTabs.pop();
    if (last) this.createTab(last.url, { index: last.index });
  }

  duplicateTab(id) {
    const tab = this.tabs.get(id);
    if (tab) this.createTab(this.tabState(tab).url, { index: this.order.indexOf(id) + 1 });
  }

  moveTab(id, toIndex) {
    const from = this.order.indexOf(id);
    if (from === -1) return;
    this.order.splice(from, 1);
    this.order.splice(this.clampToGroup(toIndex, this.tabs.get(id).pinned), 0, id);
    this.sendState();
  }

  /**
   * Takes a tab out of this window without closing its page, so another window
   * can adopt it. The last tab only leaves with `allowEmpty` (the window is
   * about to close).
   */
  releaseTab(id, { allowEmpty = false } = {}) {
    const tab = this.tabs.get(id);
    if (!tab || (this.order.length < 2 && !allowEmpty)) return null;
    if (this.activeId === id) {
      if (this.htmlFullscreen) {
        tab.view.webContents.executeJavaScript('document.exitFullscreen?.()', true).catch(() => {});
        this.exitHtmlFullscreen();
      }
      if (this.findText) tab.view.webContents.stopFindInPage('clearSelection');
      this.win.contentView.removeChildView(tab.view);
    }
    const index = this.order.indexOf(id);
    this.order.splice(index, 1);
    this.tabs.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
      if (this.order.length) this.switchTab(this.order[Math.min(index, this.order.length - 1)]);
    }
    this.sendState();
    return tab;
  }

  /** Puts a tab released by another window into this one and shows it. */
  adoptTab(tab, index = this.order.length, { focus = true } = {}) {
    tab.owner = this;
    this.tabs.set(tab.id, tab);
    this.order.splice(this.clampToGroup(index, tab.pinned), 0, tab.id);
    this.switchTab(tab.id, { focus });
  }

  /** Pinned tabs live at the start of the strip; an index never crosses that boundary. */
  clampToGroup(index, pinned) {
    const pinnedCount = this.order.filter((id) => this.tabs.get(id)?.pinned).length;
    return pinned ? Math.max(0, Math.min(index, pinnedCount)) : Math.max(pinnedCount, Math.min(index, this.order.length));
  }

  togglePin(id = this.activeId) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.order.splice(this.order.indexOf(id), 1);
    tab.pinned = !tab.pinned;
    // Pinning appends to the pinned group; unpinning puts the tab first among the others.
    const pinnedCount = this.order.filter((other) => this.tabs.get(other).pinned).length;
    this.order.splice(pinnedCount, 0, id);
    this.sendState();
  }

  cycleTab(delta) {
    if (this.order.length < 2) return;
    const i = this.order.indexOf(this.activeId);
    this.switchTab(this.order[(i + delta + this.order.length) % this.order.length]);
  }

  toggleMute(id = this.activeId) {
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) return;
    wc.setAudioMuted(!wc.isAudioMuted());
    this.sendState();
  }

  // -------------------------------------------------------------------------
  // Navigation

  navigate(input) {
    const wc = this.activeWebContents();
    if (!wc) return;
    wc.loadURL(resolveInput(input)).catch(() => {});
    wc.focus();
  }

  goBack() {
    const nav = this.activeWebContents()?.navigationHistory;
    if (nav?.canGoBack()) nav.goBack();
  }

  goForward() {
    const nav = this.activeWebContents()?.navigationHistory;
    if (nav?.canGoForward()) nav.goForward();
  }

  /** Reloads the page; on the error page, retries the address that failed. */
  reload({ hard = false } = {}) {
    const wc = this.activeWebContents();
    if (!wc) return;
    const url = wc.getURL();
    if (url.startsWith('kitty://error')) {
      const failed = new URL(url).searchParams.get('url');
      if (failed) return wc.loadURL(failed).catch(() => {});
    }
    if (hard) wc.reloadIgnoringCache();
    else wc.reload();
  }

  recordHistory(wc) {
    if (this.isPrivate) return;
    const url = wc.getURL();
    if (!/^https?:/.test(url)) return;
    const entries = data.history.get('entries');
    const last = entries[0];
    const title = wc.getTitle() || url;
    if (last && last.url === url) {
      last.title = title;
    } else {
      entries.unshift({ url, title, time: Date.now() });
      if (entries.length > HISTORY_LIMIT) entries.length = HISTORY_LIMIT;
    }
    data.history.save();
  }

  /** Removes the failed page under the error page, so "back" skips it instead of failing again. */
  dropFailedEntry(wc, errorUrl) {
    const failedUrl = new URL(errorUrl).searchParams.get('url');
    const nav = wc.navigationHistory;
    const index = nav.getActiveIndex() - 1;
    if (index >= 0 && nav.getEntryAtIndex(index)?.url === failedUrl) nav.removeEntryAtIndex(index);
  }

  /** Replaces a navigation to a phishing/malware site with Kitty's warning page. */
  showThreatWarning(webContentsId, url, kind) {
    const tab = this.tabs.get(webContentsId);
    if (!tab) return;
    tab.threatBlocked = true;
    const params = new URLSearchParams({ url, kind });
    setImmediate(() => tab.view.webContents.loadURL(`kitty://blocked?${params}`).catch(() => {}));
  }

  // -------------------------------------------------------------------------
  // Find in page

  openFind() {
    if (!this.activeWebContents()) return;
    this.ui.webContents.focus();
    this.sendUi('find:open');
  }

  find(text, { forward = true, next = false } = {}) {
    const wc = this.activeWebContents();
    if (!wc) return;
    const query = String(text || '');
    if (!query) {
      this.findText = '';
      wc.stopFindInPage('clearSelection');
      this.sendUi('find:result', { active: 0, matches: 0 });
      return;
    }
    const isNew = query !== this.findText;
    this.findText = query;
    wc.findInPage(query, { forward, findNext: isNew || !next });
  }

  stopFind() {
    this.findText = '';
    this.activeWebContents()?.stopFindInPage('keepSelection');
  }

  // -------------------------------------------------------------------------
  // Permission prompts

  requestPermission(tab, { origin, label, resolve }) {
    const duplicate = tab.prompts.find((p) => p.origin === origin && p.label === label);
    if (duplicate) {
      duplicate.resolvers.push(resolve);
      return;
    }
    tab.prompts.push({ id: `${tab.id}-${Date.now()}-${Math.random()}`, origin, label, resolvers: [resolve] });
    this.sendState();
  }

  answerPrompt(tabId, promptId, allow) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const prompt = tab.prompts.find((p) => p.id === promptId);
    if (!prompt) return;
    tab.prompts = tab.prompts.filter((p) => p !== prompt);
    prompt.resolvers.forEach((r, i) => r(!!allow, i === 0));
    this.sendState();
  }

  denyPrompts(tab) {
    const pending = tab.prompts;
    tab.prompts = [];
    for (const p of pending) p.resolvers.forEach((r) => r(false, false));
  }

  // -------------------------------------------------------------------------

  destroy() {
    if (this.onThemeChange) nativeTheme.off('updated', this.onThemeChange);
    for (const tab of this.tabs.values()) {
      this.denyPrompts(tab);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
    this.order = [];
    if (!this.ui.webContents.isDestroyed()) this.ui.webContents.close();
    // Windows made from a dragged private tab share its session: it's only
    // wiped with the last of them.
    const shared = [...registry.windows].some((w) => w !== this && w.session === this.session);
    if (this.isPrivate && !shared) {
      this.session.clearStorageData().catch(() => {});
      this.session.clearCache().catch(() => {});
    }
    registry.remove(this);
    hooks.onChange();
  }
}

module.exports = { KittyWindow, hooks, resolveInput, NEW_TAB_URL };
