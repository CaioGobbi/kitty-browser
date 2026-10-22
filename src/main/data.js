'use strict';

// Persistent stores shared across the main process.
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { LANGUAGES } = require('../i18n');

const SEARCH_ENGINES = {
  duckduckgo: {
    name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=',
    suggest: 'https://duckduckgo.com/ac/?type=list&q=',
  },
  brave: {
    name: 'Brave Search',
    search: 'https://search.brave.com/search?q=',
    suggest: 'https://search.brave.com/api/suggest?q=',
  },
  startpage: {
    name: 'Startpage',
    search: 'https://www.startpage.com/sp/search?query=',
    suggest: null,
  },
  ecosia: {
    name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q=',
    suggest: 'https://ac.ecosia.org/autocomplete?type=list&q=',
  },
  google: {
    name: 'Google',
    search: 'https://www.google.com/search?q=',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=',
  },
};

const SETTING_DEFAULTS = {
  allowlist: [], // hosts with shields down
  blockedTotal: 0,
  permissions: {}, // { [origin]: { [permission]: 'allow' | 'deny' } }
  searchEngine: 'duckduckgo',
  searchSuggestions: true,
  bookmarksBar: 'newtab', // 'always', 'newtab' (only on the new tab page) or 'never'
  tabLayout: 'classic', // 'classic' (tabs above the toolbar), 'compact' (one row) or 'vertical' (tabs on the side)
  verticalTabsCollapsed: false,
  language: 'en', // interface language, from src/i18n
  theme: 'dark', // interface and kitty:// pages: 'dark', 'light' or 'system'
  restoreSession: true,
  httpsUpgrade: true,
  blockThirdPartyCookies: true,
  antiFingerprinting: true,
  stripTrackingParams: true,
  dangerousSiteProtection: true,
  secureDns: 'quad9',
  offerPasswords: true,
  // Connections Kitty makes by itself, chosen on kitty://setup. Until the
  // person goes through that page (setupDone), none of them happens.
  setupDone: false,
  autoUpdateLists: true,
  autoUpdate: true,
  widevine: true, // DRM video (Netflix, Spotify…): downloaded from Google
  autoUpdateExtensions: true, // installed extensions check the Chrome Web Store for updates
  // Chrome extensions (extensions.js): ids switched off, and ids pinned to the toolbar in order
  extensionsDisabled: [],
  extensionsPinned: [],
  extensionsDevMode: false, // kitty://extensions shows the developer tools (load unpacked, reload, ids)
  extensionsUnpacked: [], // folders loaded in developer mode: [{ id, path }]
};

/** When the bookmarks bar shows: see `bookmarksBar` above. */
const BOOKMARKS_BAR = ['always', 'newtab', 'never'];

/** Where the tabs go: see `tabLayout` above. */
const TAB_LAYOUTS = ['classic', 'compact', 'vertical'];

/** Encrypted DNS (DNS over HTTPS) providers. */
const DNS_PROVIDERS = {
  quad9: { name: 'Quad9 (bloqueia domínios maliciosos)', url: 'https://dns.quad9.net/dns-query' },
  cloudflare: { name: 'Cloudflare (1.1.1.1)', url: 'https://cloudflare-dns.com/dns-query' },
  mullvad: { name: 'Mullvad', url: 'https://dns.mullvad.net/dns-query' },
};

/** Settings the kitty://settings page may change, with their expected type. */
const EDITABLE_SETTINGS = {
  searchEngine: (v) => typeof v === 'string' && v in SEARCH_ENGINES,
  searchSuggestions: (v) => typeof v === 'boolean',
  bookmarksBar: (v) => BOOKMARKS_BAR.includes(v),
  tabLayout: (v) => TAB_LAYOUTS.includes(v),
  verticalTabsCollapsed: (v) => typeof v === 'boolean',
  language: (v) => typeof v === 'string' && v in LANGUAGES,
  theme: (v) => ['dark', 'light', 'system'].includes(v),
  restoreSession: (v) => typeof v === 'boolean',
  httpsUpgrade: (v) => typeof v === 'boolean',
  blockThirdPartyCookies: (v) => typeof v === 'boolean',
  antiFingerprinting: (v) => typeof v === 'boolean',
  stripTrackingParams: (v) => typeof v === 'boolean',
  dangerousSiteProtection: (v) => typeof v === 'boolean',
  secureDns: (v) => v === 'off' || v in DNS_PROVIDERS,
  offerPasswords: (v) => typeof v === 'boolean',
  autoUpdateLists: (v) => typeof v === 'boolean',
  autoUpdate: (v) => typeof v === 'boolean',
  widevine: (v) => typeof v === 'boolean',
};

const data = {
  /** @type {Store} */ settings: null,
  /** @type {Store} */ history: null,
  /** @type {Store} */ bookmarks: null,
  /** @type {Store} */ session: null,
  /** @type {Store} */ downloads: null,
  /** @type {Store} */ favicons: null,
  /** @type {Store} */ passwords: null,
};

function initData(userData) {
  const firstRun = !fs.existsSync(path.join(userData, 'settings.json'));
  data.settings = new Store(path.join(userData, 'settings.json'), SETTING_DEFAULTS);
  data.history = new Store(path.join(userData, 'history.json'), { entries: [] });
  data.bookmarks = new Store(path.join(userData, 'bookmarks.json'), { items: [] });
  data.session = new Store(path.join(userData, 'session.json'), { windows: [] });
  data.downloads = new Store(path.join(userData, 'downloads.json'), { items: [] });
  data.favicons = new Store(path.join(userData, 'favicons.json'), { icons: {} }); // { [host]: { src, data } }
  // logins: [{ id, origin, username, password (encrypted by the OS, base64), created, updated, used }]; never: [origin]
  data.passwords = new Store(path.join(userData, 'passwords.json'), { logins: [], never: [] });
  // Before `bookmarksBar` there was only on/off: off stays off, on becomes the new default.
  if ('showBookmarksBar' in data.settings.data) {
    if (data.settings.get('showBookmarksBar') === false) data.settings.set('bookmarksBar', 'never');
    delete data.settings.data.showBookmarksBar;
    data.settings.save();
  }
  // Dark pages on websites were dropped before any release: forget their settings.
  if ('darkSites' in data.settings.data || 'darkPages' in data.settings.data) {
    delete data.settings.data.darkSites;
    delete data.settings.data.darkPages;
    data.settings.save();
  }
  if (!(data.settings.get('searchEngine') in SEARCH_ENGINES)) data.settings.set('searchEngine', 'duckduckgo');
  // kitty://setup greets new people and, once, those updating from a version without it.
  if (!data.settings.get('setupDone') && !data.settings.get('setupFor')) data.settings.set('setupFor', firstRun ? 'new' : 'update');
}

/** Whether Kitty may connect by itself for this (a setting chosen on kitty://setup). */
function allowed(setting) {
  return !!data.settings.get('setupDone') && !!data.settings.get(setting);
}

function flushData() {
  for (const store of Object.values(data)) store?.flush();
}

function engine() {
  return SEARCH_ENGINES[data.settings.get('searchEngine')] || SEARCH_ENGINES.duckduckgo;
}

function searchUrl(text) {
  return engine().search + encodeURIComponent(text);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function originOf(url) {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}

function isInternal(url) {
  return typeof url === 'string' && url.startsWith('kitty://');
}

function isShieldUp(url) {
  return !data.settings.get('allowlist').includes(hostOf(url));
}

function isBookmarked(url) {
  return !!url && data.bookmarks.get('items').some((b) => b.url === url);
}

module.exports = {
  data,
  initData,
  flushData,
  allowed,
  engine,
  searchUrl,
  hostOf,
  originOf,
  isInternal,
  isShieldUp,
  isBookmarked,
  SEARCH_ENGINES,
  DNS_PROVIDERS,
  EDITABLE_SETTINGS,
};
