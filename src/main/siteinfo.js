'use strict';

// The site info panel (the button at the left of the address bar) and the
// kitty://site page: connection and certificate, fingerprinting protection,
// cookies and site data, and per-site settings.
const { ipcMain } = require('electron');

const { data, hostOf, originOf, isInternal, isShieldUp } = require('./data');
const { registry } = require('./registry');
const privacy = require('./privacy');

/** The certificate each host presented last this run, as Chromium saw it. */
const certificates = new Map();
const CERTIFICATES_LIMIT = 500;

/** Storages a site keeps besides cookies (cleared together with them). */
const STORAGES = ['filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage'];

/** Permissions the site page always lists, even before the site asks. */
const MAIN_PERMISSIONS = ['camera', 'microphone', 'geolocation', 'notifications'];

/**
 * Remembers certificates without judging them: -3 keeps Chromium's own
 * verification result.
 */
function attach(ses) {
  ses.setCertificateVerifyProc((request, callback) => {
    const c = request.certificate;
    certificates.delete(request.hostname);
    certificates.set(request.hostname, {
      subject: c.subject?.commonName || c.subjectName || '',
      organization: c.subject?.organizations?.[0] || '',
      issuer: c.issuer?.commonName || c.issuerName || '',
      issuerOrganization: c.issuer?.organizations?.[0] || '',
      validStart: c.validStart * 1000,
      validExpiry: c.validExpiry * 1000,
      fingerprint: c.fingerprint || '',
      ok: request.errorCode === 0,
    });
    if (certificates.size > CERTIFICATES_LIMIT) certificates.delete(certificates.keys().next().value);
    callback(-3);
  });
}

function kindOf(url) {
  if (isInternal(url)) return 'internal';
  if (url.startsWith('https:')) return 'https';
  if (url.startsWith('http:')) return 'http';
  if (url.startsWith('file:')) return 'file';
  return 'other';
}

/** Cookies of the whole site (docs.google.com shares google.com's). */
async function siteCookies(ses, url) {
  const site = privacy.siteOf(url);
  if (!site) return [];
  try {
    return await ses.cookies.get({ domain: site });
  } catch {
    return [];
  }
}

/** Bytes the page's origin keeps (local storage, databases, caches), asked from an isolated world. */
async function storageUsage(wc) {
  try {
    const usage = await wc.executeJavaScriptInIsolatedWorld(1999, [
      { code: 'navigator.storage?.estimate ? navigator.storage.estimate().then((e) => e.usage || 0) : 0' },
    ]);
    return Number(usage) || 0;
  } catch {
    return 0;
  }
}

async function clearSiteData(ses, url) {
  const site = privacy.siteOf(url);
  for (const cookie of await siteCookies(ses, url)) {
    const domain = cookie.domain.replace(/^\./, '');
    const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`;
    await ses.cookies.remove(cookieUrl, cookie.name).catch(() => {});
  }
  const origins = new Set([originOf(url)]);
  if (site) for (const prefix of ['', 'www.']) origins.add(`https://${prefix}${site}`).add(`http://${prefix}${site}`);
  for (const origin of origins) if (origin) await ses.clearStorageData({ origin, storages: STORAGES }).catch(() => {});
}

/** Everything the panel shows about the active tab. */
async function panelInfo(kwin) {
  const tab = kwin.activeTab();
  if (!tab) return null;
  const wc = tab.view.webContents;
  const url = wc.getURL();
  const kind = kindOf(url);
  const host = hostOf(url);
  const info = { url, kind, host: kind === 'internal' ? url.replace(/[?#].*$/, '').replace(/\/$/, '') : host };
  if (kind !== 'https' && kind !== 'http') return info;

  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {}
  const cookies = await siteCookies(kwin.session, url);
  const byDomain = {};
  for (const c of cookies) {
    const d = c.domain.replace(/^\./, '');
    byDomain[d] = (byDomain[d] || 0) + 1;
  }
  return {
    ...info,
    origin: originOf(url),
    site: privacy.siteOf(url),
    certificate: kind === 'https' ? certificates.get(hostname) || null : null,
    httpsFailed: kind === 'http' && privacy.fellBackToHttp(hostname),
    shieldUp: isShieldUp(url),
    fingerprint: {
      enabled: !!data.settings.get('antiFingerprinting'),
      site: privacy.isFingerprintProtected(url),
    },
    thirdPartyCookiesBlocked: !!data.settings.get('blockThirdPartyCookies') && isShieldUp(url),
    cookies: {
      count: cookies.length,
      domains: Object.entries(byDomain)
        .sort((a, b) => b[1] - a[1])
        .map(([domain, count]) => ({ domain, count })),
    },
    storage: await storageUsage(wc),
    isPrivate: kwin.isPrivate,
  };
}

/** What kitty://site shows for an origin. */
async function pageInfo(kwin, origin) {
  const url = `${origin}/`;
  const cookies = await siteCookies(kwin.session, url);
  const decisions = privacy.sitePermissions(kwin, origin);
  const names = [...new Set([...MAIN_PERMISSIONS, ...Object.keys(decisions)])];
  return {
    origin,
    host: hostOf(url),
    site: privacy.siteOf(url),
    isPrivate: kwin.isPrivate,
    permissions: names.map((name) => ({ name, value: decisions[name] || 'ask' })),
    shieldUp: isShieldUp(url),
    fingerprint: { enabled: !!data.settings.get('antiFingerprinting'), site: privacy.isFingerprintProtected(url) },
    passwords: !data.passwords.get('never').includes(origin),
    cookies: cookies.length,
  };
}

function setShield(host, up) {
  const allowlist = data.settings.get('allowlist').filter((h) => h !== host);
  data.settings.set('allowlist', up ? allowlist : [...allowlist, host]);
}

function setPasswords(origin, offer) {
  const never = data.passwords.get('never').filter((o) => o !== origin);
  data.passwords.set('never', offer ? never : [...never, origin]);
}

/** Reloads the window's tabs showing this host, so a changed protection takes effect. */
function reloadHost(kwin, host) {
  for (const tab of kwin.tabs.values()) {
    const wc = tab.view.webContents;
    if (!isInternal(wc.getURL()) && hostOf(wc.getURL()) === host) wc.reload();
  }
}

function validOrigin(value) {
  const origin = originOf(String(value || ''));
  return /^https?:\/\//.test(origin) ? origin : '';
}

function registerIpc({ fromPage, openInternal }) {
  const fromUi = (event) => registry.byUi(event.sender);

  ipcMain.handle('ui:site-info', (event) => {
    const kwin = fromUi(event);
    return kwin ? panelInfo(kwin) : null;
  });

  ipcMain.handle('ui:site-action', async (event, { op, on } = {}) => {
    const kwin = fromUi(event);
    const wc = kwin?.activeWebContents();
    if (!wc) return null;
    const url = wc.getURL();
    if (!/^https?:/.test(url)) return null;
    const host = hostOf(url);
    if (op === 'fingerprint') {
      privacy.setFingerprintProtected(host, !!on);
      reloadHost(kwin, host);
    } else if (op === 'clear-data') {
      await clearSiteData(kwin.session, url);
      wc.reload();
    } else if (op === 'settings') {
      openInternal(`kitty://site?origin=${encodeURIComponent(originOf(url))}`);
      return null;
    }
    return panelInfo(kwin);
  });

  // ---- kitty://site
  const pageWindow = (event) => (fromPage(event, 'site') ? registry.tabByWebContentsId(event.sender.id)?.kwin : null);

  ipcMain.handle('kitty:site', (event, origin) => {
    const kwin = pageWindow(event);
    const valid = validOrigin(origin);
    return kwin && valid ? pageInfo(kwin, valid) : null;
  });

  ipcMain.handle('kitty:site-set', async (event, origin, key, value) => {
    const kwin = pageWindow(event);
    const valid = validOrigin(origin);
    if (!kwin || !valid) return null;
    const host = hostOf(`${valid}/`);
    if (key === 'permission') {
      const { name, value: decision } = value || {};
      if (MAIN_PERMISSIONS.includes(name) || name in privacy.PROMPTED) privacy.setSitePermission(kwin, valid, name, decision);
    } else if (key === 'shield') {
      setShield(host, !!value);
      reloadHost(kwin, host);
    } else if (key === 'fingerprint') {
      privacy.setFingerprintProtected(host, !!value);
      reloadHost(kwin, host);
    } else if (key === 'passwords') {
      setPasswords(valid, !!value);
    } else if (key === 'clear-data') {
      await clearSiteData(kwin.session, `${valid}/`);
    } else if (key === 'reset') {
      for (const name of Object.keys(privacy.sitePermissions(kwin, valid))) privacy.setSitePermission(kwin, valid, name, 'ask');
      setShield(host, true);
      privacy.setFingerprintProtected(host, true);
      setPasswords(valid, true);
      reloadHost(kwin, host);
    }
    return pageInfo(kwin, valid);
  });
}

module.exports = { attach, registerIpc };
