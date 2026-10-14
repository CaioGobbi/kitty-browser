'use strict';

// Everything that protects the user on the network side: ad/tracker blocking,
// HTTPS upgrades, third-party cookie blocking, Global Privacy Control,
// fingerprinting protection and site permission prompts.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, ipcMain } = require('electron');
const { ElectronBlocker, Request, fromElectronDetails } = require('@ghostery/adblocker-electron');

const { data, isShieldUp, originOf } = require('./data');
const { registry } = require('./registry');

/** @type {ElectronBlocker | null} */
let blocker = null;

/** Hosts whose HTTPS upgrade failed this run; they load over plain HTTP. */
const httpFallbackHosts = new Set();
/** URLs Kitty itself rewrote from http:// to https:// (only these may fall back). */
const upgradedUrls = new Set();

/** Per-session random key: fingerprint noise differs per site and per session. */
const fingerprintKeys = new WeakMap();

// ---------------------------------------------------------------------------
// Helpers

function siteOf(url) {
  try {
    const { domain, hostname } = Request.fromRawDetails({ url });
    return domain || hostname || '';
  } catch {
    return '';
  }
}

/** Top-level page of the tab a request belongs to (null for non-tab contents). */
function topUrlFor(webContentsId) {
  const found = registry.tabByWebContentsId(webContentsId);
  return found ? found.tab.view.webContents.getURL() : null;
}

function isThirdParty(details) {
  if (details.resourceType === 'mainFrame') return false;
  const top = topUrlFor(details.webContentsId);
  if (!top || !/^https?:/.test(top)) return false;
  const site = siteOf(details.url);
  return !!site && site !== siteOf(top);
}

/** Hosts that never get an HTTPS upgrade: local machines and the local network. */
function isUpgradable(hostname) {
  if (!hostname.includes('.')) return false; // localhost, intranet names
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[')) return false;
  return !/\.(localhost|local|test|internal|lan|home|arpa)$/i.test(hostname);
}

function httpsUpgradeFor(url) {
  if (!data.settings.get('httpsUpgrade') || !url.startsWith('http://')) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isUpgradable(parsed.hostname) || httpFallbackHosts.has(parsed.hostname)) return null;
  parsed.protocol = 'https:';
  const upgraded = parsed.toString();
  upgradedUrls.add(upgraded);
  if (upgradedUrls.size > 500) upgradedUrls.delete(upgradedUrls.values().next().value);
  return upgraded;
}

/**
 * Called when a page fails to load. If Kitty had upgraded it to HTTPS and the
 * site doesn't support it, retry over HTTP. Addresses that were https:// to
 * begin with are never downgraded.
 */
function httpFallbackFor(failedUrl) {
  if (!upgradedUrls.delete(failedUrl)) return null;
  const parsed = new URL(failedUrl);
  if (httpFallbackHosts.has(parsed.hostname)) return null;
  httpFallbackHosts.add(parsed.hostname);
  parsed.protocol = 'http:';
  return parsed.toString();
}

// ---------------------------------------------------------------------------
// Cosmetic filtering

/**
 * Applies cosmetic filters to the frame that asked for them. Ghostery's own
 * handler runs scriptlets in the *main* frame for every iframe's request, so
 * pages with several iframes (Crunchyroll) got the same scriptlet stacked
 * until it overflowed the call stack and broke the page.
 */
function injectCosmetics(event, url, msg) {
  const frame = event.senderFrame;
  if (!frame) return;
  const { hostname, domain } = Request.fromRawDetails({ url });
  const isFirstRun = msg === undefined; // later calls carry DOM info (classes, ids, hrefs)
  const { active, styles, scripts } = blocker.getCosmeticsFilters({
    url,
    hostname,
    domain: domain || '',
    classes: msg?.classes,
    hrefs: msg?.hrefs,
    ids: msg?.ids,
    getBaseRules: isFirstRun,
    getInjectionRules: isFirstRun,
    getExtendedRules: false,
    getRulesFromHostname: isFirstRun,
    getRulesFromDOM: !isFirstRun,
    callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: msg?.lifecycle },
  });
  if (active === false) return;

  if (styles.length > 0) {
    if (frame === event.sender.mainFrame) {
      event.sender.insertCSS(styles, { cssOrigin: 'user' });
    } else {
      const css = JSON.stringify(styles);
      frame
        .executeJavaScript(
          `(() => { const s = document.createElement('style'); s.textContent = ${css}; (document.head || document.documentElement).append(s); })()`,
        )
        .catch(() => {});
    }
  }
  // Each scriptlet declares helpers (safeSelf, proxyApplyFn…) at top level. Run
  // side by side in the page's global scope, a later scriptlet overwrites an
  // earlier one's helpers and its Function.prototype.toString proxy recurses
  // forever. Wrapping each one keeps its helpers private.
  for (const script of scripts) {
    frame.executeJavaScript(`(() => {\n${script}\n})();`, true).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Site permissions

/** Permissions that need the user's OK, with how the prompt names them. */
const PROMPTED = {
  geolocation: 'saber sua localização',
  notifications: 'mostrar notificações',
  midi: 'usar dispositivos MIDI',
  midiSysex: 'controlar dispositivos MIDI',
  'clipboard-read': 'ler sua área de transferência',
  'idle-detection': 'saber quando você está ausente',
  'window-management': 'gerenciar janelas nas suas telas',
  'storage-access': 'usar cookies em outros sites',
  'top-level-storage-access': 'usar cookies em outros sites',
  hid: 'acessar dispositivos HID',
  serial: 'acessar portas seriais',
  usb: 'acessar dispositivos USB',
  speaker: 'escolher a saída de áudio',
  'speaker-selection': 'escolher a saída de áudio',
  keyboardLock: 'capturar o teclado',
  openExternal: 'abrir um aplicativo externo',
};

/** Harmless permissions granted without asking. Anything else is denied. */
const GRANTED = new Set([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
  'mediaKeySystem', // DRM video
  'persistent-storage',
  'background-sync',
  'fileSystem',
]);

function mediaParts(details) {
  const types = details?.mediaTypes?.length ? details.mediaTypes : ['video', 'audio'];
  return types.map((t) => (t === 'video' ? 'camera' : 'microphone'));
}

function decisionStore(kwin) {
  return kwin?.isPrivate ? kwin.privatePermissions : data.settings.get('permissions');
}

function getDecision(kwin, origin, permission) {
  return decisionStore(kwin)[origin]?.[permission];
}

function saveDecision(kwin, origin, permissions, allow) {
  const store = decisionStore(kwin);
  store[origin] = { ...store[origin] };
  for (const p of permissions) store[origin][p] = allow ? 'allow' : 'deny';
  if (!kwin?.isPrivate) data.settings.set('permissions', store);
}

function promptLabel(permission, details, parts) {
  if (permission === 'media') {
    if (parts.length === 2) return 'usar sua câmera e microfone';
    return parts[0] === 'camera' ? 'usar sua câmera' : 'usar seu microfone';
  }
  if (permission === 'openExternal' && details?.externalURL) {
    const scheme = details.externalURL.split(':')[0];
    return `abrir links “${scheme}:” em outro aplicativo`;
  }
  return PROMPTED[permission];
}

function onPermissionRequest(webContents, permission, callback, details) {
  if (GRANTED.has(permission)) return callback(true);
  const isMedia = permission === 'media';
  if (!isMedia && !(permission in PROMPTED)) return callback(false);

  const found = registry.tabByWebContentsId(webContents.id);
  if (!found) return callback(false); // popups and other non-tab contents
  const { kwin, tab } = found;
  const origin = originOf(details?.requestingUrl || webContents.getURL());
  if (!origin) return callback(false);

  const parts = isMedia ? mediaParts(details) : [permission];
  const decisions = parts.map((p) => getDecision(kwin, origin, p));
  if (decisions.every((d) => d === 'allow')) return callback(true);
  if (decisions.some((d) => d === 'deny')) return callback(false);

  kwin.requestPermission(tab, {
    origin,
    label: promptLabel(permission, details, parts),
    resolve: (allow, remember) => {
      if (remember) saveDecision(kwin, origin, parts, allow);
      callback(allow);
    },
  });
}

function onPermissionCheck(webContents, permission, requestingOrigin, details) {
  if (GRANTED.has(permission)) return true;
  const found = webContents ? registry.tabByWebContentsId(webContents.id) : null;
  const origin = originOf(requestingOrigin || '');
  if (!origin) return false;
  if (permission === 'media') {
    const part = details?.mediaType === 'video' ? 'camera' : 'microphone';
    return getDecision(found?.kwin, origin, part) === 'allow';
  }
  return getDecision(found?.kwin, origin, permission) === 'allow';
}

// ---------------------------------------------------------------------------
// Session setup (persistent profile + every private window)

function setupSession(ses) {
  fingerprintKeys.set(ses, crypto.randomBytes(16));

  ses.webRequest.onBeforeRequest((details, callback) => {
    const isFrame = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
    if (isFrame) {
      const upgraded = httpsUpgradeFor(details.url);
      if (upgraded) return callback({ redirectURL: upgraded });
    }
    if (!blocker || details.resourceType === 'mainFrame' || !details.webContentsId) return callback({});

    const found = registry.tabByWebContentsId(details.webContentsId);
    if (!found || !isShieldUp(found.tab.view.webContents.getURL())) return callback({});

    const { match, redirect } = blocker.match(fromElectronDetails(details));
    if (!match && !redirect) return callback({});

    // Count each URL once per page load: some sites retry blocked requests in a tight loop.
    const { kwin, tab } = found;
    if (!tab.blocked.has(details.url)) {
      tab.blocked.add(details.url);
      data.settings.set('blockedTotal', data.settings.get('blockedTotal') + 1);
      kwin.sendStateSoon();
    }
    callback(redirect ? { redirectURL: redirect.dataUrl } : { cancel: true });
  });

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders, 'Sec-GPC': '1', DNT: '1' };
    if (data.settings.get('blockThirdPartyCookies') && shieldsUpFor(details) && isThirdParty(details)) {
      delete headers.Cookie;
      delete headers.cookie;
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!data.settings.get('blockThirdPartyCookies') || !shieldsUpFor(details) || !isThirdParty(details)) {
      return callback({});
    }
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'set-cookie') delete headers[key];
    callback({ responseHeaders: headers });
  });

  ses.setPermissionRequestHandler(onPermissionRequest);
  ses.setPermissionCheckHandler(onPermissionCheck);

  // Cosmetic filtering (hides the boxes ads leave behind) and fingerprinting
  // protection run as preloads in every frame.
  ses.registerPreloadScript({ type: 'frame', filePath: require.resolve('@ghostery/adblocker-electron-preload') });
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'preload-fingerprint.js') });
}

function shieldsUpFor(details) {
  const top = topUrlFor(details.webContentsId);
  return !top || isShieldUp(top);
}

function registerPrivacyIpc() {
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
    const found = registry.tabByWebContentsId(event.sender.id);
    if (!blocker || !found || !isShieldUp(found.tab.view.webContents.getURL())) return;
    injectCosmetics(event, url, msg);
  });
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) =>
    blocker ? blocker.onIsMutationObserverEnabled(event) : false,
  );

  // Asked synchronously by preload-fingerprint.js before any page script runs.
  ipcMain.on('kitty:fingerprint', (event, frameUrl) => {
    const found = registry.tabByWebContentsId(event.sender.id);
    const top = found ? found.tab.view.webContents.getURL() || frameUrl : frameUrl;
    const enabled =
      data.settings.get('antiFingerprinting') && /^https?:/.test(String(frameUrl)) && isShieldUp(top);
    const key = fingerprintKeys.get(event.sender.session) || Buffer.alloc(16);
    const seed = crypto.createHmac('sha256', key).update(siteOf(top) || 'none').digest().readUInt32LE(0);
    event.returnValue = { enabled, seed };
  });
}

async function loadBlocker() {
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

function permissionList() {
  const out = [];
  for (const [origin, perms] of Object.entries(data.settings.get('permissions'))) {
    for (const [permission, value] of Object.entries(perms)) out.push({ origin, permission, value });
  }
  return out.sort((a, b) => a.origin.localeCompare(b.origin));
}

function removePermission(origin, permission) {
  const store = data.settings.get('permissions');
  if (!store[origin]) return;
  delete store[origin][permission];
  if (Object.keys(store[origin]).length === 0) delete store[origin];
  data.settings.set('permissions', store);
}

module.exports = {
  setupSession,
  registerPrivacyIpc,
  loadBlocker,
  httpFallbackFor,
  permissionList,
  removePermission,
};
