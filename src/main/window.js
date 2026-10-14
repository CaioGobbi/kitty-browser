'use strict';

// One Kitty browser window: the browser UI (tab strip, toolbar, bars) as a
// WebContentsView on top, and one WebContentsView per tab below it.
const path = require('node:path');
const { BaseWindow, WebContentsView, session } = require('electron');

const { data, searchUrl, isInternal, isShieldUp, isBookmarked } = require('./data');
const { registry } = require('./registry');
const { httpFallbackFor } = require('./privacy');

const UI_DIR = path.join(__dirname, '..', 'ui');
const NEW_TAB_URL = 'kitty://newtab';
const DEFAULT_CHROME_HEIGHT = 84;
const HISTORY_LIMIT = 5000;
const CLOSED_TABS_LIMIT = 25;

let privateCounter = 0;

/** Set by main.js: { setupProfile(ses, opts), onChange(), contextMenu(kwin, tab, params) } */
const hooks = { setupProfile() {}, onChange() {}, contextMenu() {} };

/** Turns whatever the user typed in the address bar into a URL. */
function resolveInput(input) {
  const text = String(input || '').trim();
  if (!text) return NEW_TAB_URL;
  if (/^(https?|kitty|file|view-source):/i.test(text) || /^about:/i.test(text)) return text;
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) {
    return `http://${text}`;
  }
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  return searchUrl(text);
}

class KittyWindow {
  /**
   * @param {{ isPrivate?: boolean, restore?: { tabs: {url: string, title?: string, favicon?: string}[], active?: number } }} options
   */
  constructor({ isPrivate = false, restore = null } = {}) {
    this.isPrivate = isPrivate;
    this.session = isPrivate
      ? session.fromPartition(`kitty-private-${++privateCounter}`) // in memory only
      : session.fromPartition('persist:kitty');
    if (isPrivate) hooks.setupProfile(this.session, { isPrivate: true });

    /** @type {Map<number, any>} */
    this.tabs = new Map();
    this.order = [];
    this.activeId = null;
    this.closedTabs = [];
    this.privatePermissions = {};
    this.chromeHeight = DEFAULT_CHROME_HEIGHT;
    this.overlay = false;
    this.htmlFullscreen = false;
    this.fullscreenByPage = false;
    this.findText = '';
    this.stateTimer = null;

    this.win = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 480,
      minHeight: 320,
      title: isPrivate ? 'Kitty — Janela privativa' : 'Kitty',
      backgroundColor: isPrivate ? '#1a1326' : '#17151c',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 14, y: 13 },
      titleBarOverlay: process.platform === 'darwin' ? false : { height: 40, color: '#00000000' },
    });

    this.ui = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload-ui.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.ui.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.ui);
    this.ui.webContents.loadFile(path.join(UI_DIR, 'index.html'), { query: { private: isPrivate ? '1' : '0' } });
    this.ui.webContents.once('did-finish-load', () => {
      if (restore?.tabs?.length) this.restoreTabs(restore);
      else this.createTab();
    });

    this.win.on('resize', () => this.layout());
    this.win.on('focus', () => registry.focus(this));
    this.win.on('enter-full-screen', () => this.sendUi('ui:fullscreen', true));
    this.win.on('leave-full-screen', () => {
      this.sendUi('ui:fullscreen', false);
      if (this.htmlFullscreen) this.activeTab()?.view.webContents.executeJavaScript('document.exitFullscreen?.()', true).catch(() => {});
    });
    this.win.on('closed', () => this.destroy());

    registry.add(this);
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
      prompt: prompt ? { id: prompt.id, origin: prompt.origin, label: prompt.label } : null,
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
    this.ui.setBounds({ x: 0, y: 0, width, height: this.overlay ? height : this.chromeHeight });
    tab?.view.setBounds({ x: 0, y: this.chromeHeight, width, height: Math.max(0, height - this.chromeHeight) });
  }

  /** The UI asks for more room (bars) or the whole window (dropdowns). */
  setChrome({ height, overlay }) {
    if (Number.isFinite(height)) this.chromeHeight = Math.max(40, Math.min(400, Math.round(height)));
    if (typeof overlay === 'boolean') this.overlay = overlay;
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
        return { url: s.url, title: s.title, favicon: s.favicon };
      }),
      active: Math.max(0, this.order.indexOf(this.activeId)),
    };
  }

  // -------------------------------------------------------------------------
  // Tabs

  createTab(url = NEW_TAB_URL, { activate = true, index = null, lazy = false, title = '', favicon = null } = {}) {
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
    const tab = {
      id: wc.id,
      view,
      blocked: new Set(),
      favicon,
      prompts: [],
      pendingUrl: lazy ? url : null,
      pendingTitle: title,
    };
    this.tabs.set(tab.id, tab);

    const at = index ?? (this.activeId != null ? this.order.indexOf(this.activeId) + 1 : this.order.length);
    this.order.splice(Math.max(0, Math.min(at, this.order.length)), 0, tab.id);

    this.wireTab(tab);
    if (!lazy) wc.loadURL(url).catch(() => {}); // failures are handled by did-fail-load
    if (activate) this.switchTab(tab.id);
    else this.sendState();
    return tab;
  }

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
      this.createTab(url, { activate: disposition !== 'background-tab' });
      return { action: 'deny' };
    });

    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        tab.blocked.clear();
        tab.favicon = null;
        this.denyPrompts(tab);
      }
      this.sendState();
    });
    wc.on('did-navigate', (_e, url) => {
      if (url.startsWith('kitty://error')) this.dropFailedEntry(wc, url);
      this.recordHistory(wc);
      this.sendState();
    });
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
      if (isMainFrame) this.recordHistory(wc);
      this.sendState();
    });
    wc.on('page-title-updated', () => {
      this.recordHistory(wc);
      this.sendState();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] || null;
      this.sendState();
    });
    wc.on('did-start-loading', () => this.sendState());
    wc.on('did-stop-loading', () => this.sendState());
    wc.on('audio-state-changed', () => this.sendState());
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. user hit stop)
      const fallback = code !== -105 ? httpFallbackFor(failedUrl) : null; // -105 = name not resolved
      if (fallback) return wc.loadURL(fallback).catch(() => {});
      const params = new URLSearchParams({ url: failedUrl, reason: desc });
      wc.loadURL(`kitty://error?${params}`).catch(() => {});
    });
    wc.on('context-menu', (_e, params) => hooks.contextMenu(this, tab, params));
    wc.on('found-in-page', (_e, result) => {
      if (tab.id === this.activeId) this.sendUi('find:result', { active: result.activeMatchOrdinal, matches: result.matches });
    });
    wc.on('enter-html-full-screen', () => {
      if (tab.id !== this.activeId) return;
      this.htmlFullscreen = true;
      if (!this.win.isFullScreen()) {
        this.fullscreenByPage = true;
        this.win.setFullScreen(true);
      }
      this.layout();
    });
    wc.on('leave-html-full-screen', () => this.exitHtmlFullscreen());
  }

  exitHtmlFullscreen() {
    if (!this.htmlFullscreen) return;
    this.htmlFullscreen = false;
    if (this.fullscreenByPage && this.win.isFullScreen()) this.win.setFullScreen(false);
    this.fullscreenByPage = false;
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
      });
    });
    this.switchTab(this.order[activeIndex]);
  }

  switchTab(id) {
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

    const url = tab.view.webContents.getURL();
    if (!url || isInternal(url)) this.focusAddressBar();
    else tab.view.webContents.focus();
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
    const victims = this.order.filter((other, i) => other !== id && (!onlyRight || i > index));
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
    this.order.splice(Math.max(0, Math.min(toIndex, this.order.length)), 0, id);
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
    for (const tab of this.tabs.values()) {
      this.denyPrompts(tab);
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
    this.order = [];
    if (!this.ui.webContents.isDestroyed()) this.ui.webContents.close();
    if (this.isPrivate) {
      this.session.clearStorageData().catch(() => {});
      this.session.clearCache().catch(() => {});
    }
    registry.remove(this);
    hooks.onChange();
  }
}

module.exports = { KittyWindow, hooks, resolveInput, NEW_TAB_URL };
