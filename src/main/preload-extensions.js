'use strict';

// Chrome extension APIs that Electron leaves out (or keeps to itself): tabs and
// windows as Kitty sees them, the toolbar button (chrome.action), right-click
// menus, webNavigation, notifications and a few smaller ones. Runs in every
// extension context — service worker, popup, options page, extension iframes —
// and fills in `chrome.*` in the extension's own world; the work happens in the
// main process (extension-api.js). Web pages never get this.
const { contextBridge, ipcRenderer } = require('electron');

// A service worker's preload has no `location` of its own: ask the worker's world.
const isExtension = (() => {
  try {
    const href = typeof window === 'undefined' ? contextBridge.executeInMainWorld({ func: () => String(globalThis.location?.href || '') }) : location.href;
    return String(href).startsWith('chrome-extension:');
  } catch {
    return false;
  }
})();

if (isExtension) {
  const isWorker = typeof window === 'undefined';
  // A service worker's first calls can arrive before the main process has
  // attached to it (it learns about the worker as it starts): retry briefly.
  const call = async (method, args) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await ipcRenderer.invoke('ext:call', method, args);
      } catch (err) {
        const message = String(err?.message || err);
        if (isWorker && attempt < 40 && message.includes('No handler registered')) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        throw new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    }
  };
  const bridge = {
    isWorker,
    call,
    listen: (name) => ipcRenderer.send('ext:listen', name),
    onEvent: (cb) => ipcRenderer.on('ext:event', (_e, name, args) => cb(name, args)),
  };
  try {
    contextBridge.executeInMainWorld({ func: installApis, args: [bridge] });
  } catch (err) {
    console.error('[kitty] extension APIs', err);
  }
}

/** Runs in the extension's world: everything it uses must be inside it. */
function installApis(bridge) {
  const chrome = globalThis.chrome;
  if (!chrome || chrome.__kitty) return;
  Object.defineProperty(chrome, '__kitty', { value: true });

  // ---- callbacks, promises and runtime.lastError
  const setLastError = (message) => {
    try {
      Object.defineProperty(chrome.runtime, 'lastError', { value: message ? { message } : undefined, configurable: true });
    } catch {}
  };
  const finish = (promise, cb) => {
    if (!cb) return promise;
    promise.then(
      (result) => cb(result),
      (err) => {
        setLastError(String(err?.message || err));
        try {
          cb();
        } finally {
          setLastError(null);
        }
      },
    );
    return undefined;
  };
  const method = (name, prepare) =>
    function (...args) {
      const cb = typeof args.at(-1) === 'function' ? args.pop() : null;
      const run = async () => bridge.call(name, prepare ? await prepare(args) : args);
      return finish(run(), cb);
    };
  const local = (fn) =>
    function (...args) {
      const cb = typeof args.at(-1) === 'function' ? args.pop() : null;
      return finish(Promise.resolve().then(() => fn(...args)), cb);
    };

  // ---- events (the main process only sends the ones someone listens to)
  const events = new Map();
  const matchesFilter = (filter, details) => {
    const urls = filter?.url;
    if (!Array.isArray(urls) || !urls.length) return true;
    let u;
    try {
      u = new URL(details?.url || '');
    } catch {
      return false;
    }
    const host = u.hostname;
    return urls.some((f) => {
      if (f.schemes && !f.schemes.includes(u.protocol.slice(0, -1))) return false;
      if (f.hostEquals != null && host !== f.hostEquals) return false;
      if (f.hostSuffix != null && !host.endsWith(f.hostSuffix) && `.${host}` !== f.hostSuffix) return false;
      if (f.hostPrefix != null && !host.startsWith(f.hostPrefix)) return false;
      if (f.hostContains != null && !host.includes(f.hostContains)) return false;
      if (f.pathPrefix != null && !u.pathname.startsWith(f.pathPrefix)) return false;
      if (f.pathEquals != null && u.pathname !== f.pathEquals) return false;
      if (f.pathContains != null && !u.pathname.includes(f.pathContains)) return false;
      if (f.urlPrefix != null && !u.href.startsWith(f.urlPrefix)) return false;
      if (f.urlEquals != null && u.href !== f.urlEquals) return false;
      if (f.urlContains != null && !u.href.includes(f.urlContains)) return false;
      if (f.urlMatches != null && !new RegExp(f.urlMatches).test(u.href)) return false;
      return true;
    });
  };
  const event = (name) => {
    const listeners = new Map();
    const ev = {
      addListener(fn, filter) {
        if (typeof fn !== 'function') return;
        if (!listeners.size) bridge.listen(name);
        listeners.set(fn, filter);
      },
      removeListener(fn) {
        listeners.delete(fn);
      },
      hasListener: (fn) => listeners.has(fn),
      hasListeners: () => listeners.size > 0,
      dispatch(args) {
        for (const [fn, filter] of [...listeners]) {
          if (filter && !matchesFilter(filter, args[0])) continue;
          try {
            fn(...args);
          } catch (err) {
            console.error(err);
          }
        }
      },
    };
    events.set(name, ev);
    return ev;
  };
  bridge.onEvent((name, args) => {
    if (name === 'contextMenus.onClicked') runMenuOnclick(args);
    events.get(name)?.dispatch(args || []);
  });

  const namespace = (ns, methods = [], eventNames = [], extra = {}) => {
    const target = chrome[ns] && typeof chrome[ns] === 'object' ? chrome[ns] : {};
    for (const m of methods) target[m] = method(`${ns}.${m}`);
    for (const e of eventNames) target[e] = event(`${ns}.${e}`);
    Object.assign(target, extra);
    try {
      chrome[ns] = target;
    } catch {}
    return target;
  };

  // ---- tabs and windows: Kitty's own (Electron's tabs API doesn't know them)
  namespace(
    'tabs',
    ['get', 'getCurrent', 'query', 'create', 'update', 'remove', 'duplicate', 'highlight', 'move', 'goBack', 'goForward', 'captureVisibleTab', 'discard'],
    ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onMoved', 'onAttached', 'onDetached', 'onHighlighted', 'onReplaced'],
    { TAB_ID_NONE: -1, TAB_INDEX_NONE: -1 },
  );
  namespace('windows', ['get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove'], ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'], {
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
    WindowType: { NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel', APP: 'app', DEVTOOLS: 'devtools' },
    WindowState: { NORMAL: 'normal', MINIMIZED: 'minimized', MAXIMIZED: 'maximized', FULLSCREEN: 'fullscreen', LOCKED_FULLSCREEN: 'locked-fullscreen' },
    CreateType: { NORMAL: 'normal', POPUP: 'popup', PANEL: 'panel' },
  });

  // ---- the toolbar button
  const toBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const imageDataUrl = async (image) => {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d').putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return `data:image/png;base64,${toBase64(await blob.arrayBuffer())}`;
  };
  const prepareIcon = async ([details = {}]) => {
    const out = { tabId: details.tabId, path: details.path };
    let image = details.imageData;
    if (image && !(image.width && image.data)) {
      // { 16: ImageData, 32: ImageData }: the largest looks best on any screen
      const sizes = Object.keys(image).sort((a, b) => b - a);
      image = image[sizes[0]];
    }
    if (image?.width) out.dataUrl = await imageDataUrl(image);
    return [out];
  };
  const actionMethods = ['setTitle', 'getTitle', 'setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'getBadgeBackgroundColor', 'setBadgeTextColor', 'getBadgeTextColor', 'setPopup', 'getPopup', 'enable', 'disable', 'isEnabled', 'openPopup', 'getUserSettings'];
  for (const ns of ['action', 'browserAction']) {
    if (ns === 'browserAction' && !chrome.browserAction && chrome.runtime.getManifest().manifest_version > 2) continue;
    const target = namespace(ns, actionMethods, ['onClicked', 'onUserSettingsChanged']);
    target.setIcon = method(`${ns}.setIcon`, prepareIcon);
  }

  // ---- right-click menus
  const menuClicks = new Map(); // onclick handlers given to create()
  let menuCounter = 0;
  const runMenuOnclick = (args) => {
    const fn = menuClicks.get(args?.[0]?.menuItemId);
    if (fn) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  };
  const menuProps = (props = {}) => {
    const { onclick, ...rest } = props;
    return { rest, onclick };
  };
  const menus = {
    create(props = {}, cb) {
      const { rest, onclick } = menuProps(props);
      if (rest.id == null) rest.id = `kitty-${Date.now()}-${++menuCounter}`;
      if (typeof onclick === 'function') menuClicks.set(rest.id, onclick);
      finish(bridge.call('contextMenus.create', [rest]), cb || (() => void chrome.runtime.lastError));
      return rest.id;
    },
    update(id, props = {}, cb) {
      const { rest, onclick } = menuProps(props);
      if (typeof onclick === 'function') menuClicks.set(id, onclick);
      return finish(bridge.call('contextMenus.update', [id, rest]), cb);
    },
    remove(id, cb) {
      menuClicks.delete(id);
      return finish(bridge.call('contextMenus.remove', [id]), cb);
    },
    removeAll(cb) {
      menuClicks.clear();
      return finish(bridge.call('contextMenus.removeAll', []), cb);
    },
    onClicked: event('contextMenus.onClicked'),
    onShown: event('contextMenus.onShown'),
    onHidden: event('contextMenus.onHidden'),
    refresh: () => {},
    ACTION_MENU_TOP_LEVEL_LIMIT: 6,
    ContextType: Object.fromEntries(['all', 'page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio', 'launcher', 'browser_action', 'page_action', 'action'].map((c) => [c.toUpperCase(), c])),
    ItemType: { NORMAL: 'normal', CHECKBOX: 'checkbox', RADIO: 'radio', SEPARATOR: 'separator' },
  };
  chrome.contextMenus = menus;
  if (!chrome.menus) chrome.menus = menus;

  // ---- navigation events and frames
  namespace(
    'webNavigation',
    ['getFrame', 'getAllFrames'],
    ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated', 'onTabReplaced', 'onHistoryStateUpdated'],
  );

  // ---- notifications: shown by the system
  const notifications = namespace('notifications', ['update', 'clear', 'getAll', 'getPermissionLevel'], ['onClosed', 'onClicked', 'onButtonClicked', 'onPermissionLevelChanged', 'onShowSettings'], {
    TemplateType: { BASIC: 'basic', IMAGE: 'image', LIST: 'list', PROGRESS: 'progress' },
    PermissionLevel: { GRANTED: 'granted', DENIED: 'denied' },
  });
  notifications.create = function (...args) {
    const cb = typeof args.at(-1) === 'function' ? args.pop() : null;
    const [id, options] = typeof args[0] === 'string' || args[0] == null ? [args[0] || '', args[1]] : ['', args[0]];
    return finish(bridge.call('notifications.create', [id, options || {}]), cb);
  };

  // ---- smaller ones
  namespace('permissions', ['contains', 'getAll', 'request', 'remove'], ['onAdded', 'onRemoved']);
  namespace('commands', ['getAll'], ['onCommand']);
  namespace('sidePanel', ['setPanelBehavior', 'getPanelBehavior', 'setOptions', 'getOptions', 'open']);
  const identity = namespace('identity', ['launchWebAuthFlow', 'getAuthToken', 'getProfileUserInfo', 'getAccounts', 'removeCachedAuthToken', 'clearAllCachedAuthTokens'], ['onSignInChanged']);
  identity.getRedirectURL = (p = '') => `https://${chrome.runtime.id}.chromiumapp.org/${String(p).replace(/^\/+/, '')}`;

  // chrome.privacy: Kitty keeps its own protections; extensions may read them
  // and their changes are remembered but don't override Kitty's settings.
  const setting = (path) => ({
    get: method('privacy.get', async ([details]) => [path, details]),
    set: method('privacy.set', async ([details]) => [path, details]),
    clear: method('privacy.clear', async ([details]) => [path, details]),
    onChange: event(`privacy.onChange.${path}`),
  });
  chrome.privacy = {
    services: Object.fromEntries(
      ['alternateErrorPagesEnabled', 'autofillAddressEnabled', 'autofillCreditCardEnabled', 'autofillEnabled', 'passwordSavingEnabled', 'safeBrowsingEnabled', 'safeBrowsingExtendedReportingEnabled', 'searchSuggestEnabled', 'spellingServiceEnabled', 'translationServiceEnabled'].map((k) => [k, setting(`services.${k}`)]),
    ),
    network: Object.fromEntries(['networkPredictionEnabled', 'webRTCIPHandlingPolicy'].map((k) => [k, setting(`network.${k}`)])),
    websites: Object.fromEntries(['thirdPartyCookiesAllowed', 'hyperlinkAuditingEnabled', 'referrersEnabled', 'doNotTrackEnabled', 'protectedContentEnabled', 'topicsEnabled'].map((k) => [k, setting(`websites.${k}`)])),
    IPHandlingPolicy: { DEFAULT: 'default', DEFAULT_PUBLIC_AND_PRIVATE_INTERFACES: 'default_public_and_private_interfaces', DEFAULT_PUBLIC_INTERFACE_ONLY: 'default_public_interface_only', DISABLE_NON_PROXIED_UDP: 'disable_non_proxied_udp' },
  };

  chrome.runtime.openOptionsPage = method('runtime.openOptionsPage');
  if (chrome.extension) {
    // Other extension pages live in other processes: only this page can be returned.
    chrome.extension.getViews = (query = {}) => {
      if (bridge.isWorker) return [];
      const type = globalThis.__kittyViewType;
      if (query.type && query.type !== type) return [];
      return [globalThis];
    };
  }
  // Chromium also gives extensions `browser`, sharing chrome's namespaces but
  // not the ones added here (webextension-polyfill uses it as is).
  if (globalThis.browser && typeof globalThis.browser === 'object' && globalThis.browser !== chrome) {
    for (const ns of Object.keys(chrome)) {
      if (!(ns in globalThis.browser)) {
        try {
          globalThis.browser[ns] = chrome[ns];
        } catch {}
      }
    }
  }
  if (!bridge.isWorker) {
    // Which kind of page this is (popup, tab…), for getViews.
    bridge.call('runtime.viewType', []).then((type) => (globalThis.__kittyViewType = type), () => {});
  }
}
