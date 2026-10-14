'use strict';

// Persistent stores shared across the main process.
const path = require('node:path');
const { Store } = require('./store');

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
  showBookmarksBar: true,
  restoreSession: true,
  httpsUpgrade: true,
  blockThirdPartyCookies: true,
  antiFingerprinting: true,
};

/** Settings the kitty://settings page may change, with their expected type. */
const EDITABLE_SETTINGS = {
  searchEngine: (v) => typeof v === 'string' && v in SEARCH_ENGINES,
  searchSuggestions: (v) => typeof v === 'boolean',
  showBookmarksBar: (v) => typeof v === 'boolean',
  restoreSession: (v) => typeof v === 'boolean',
  httpsUpgrade: (v) => typeof v === 'boolean',
  blockThirdPartyCookies: (v) => typeof v === 'boolean',
  antiFingerprinting: (v) => typeof v === 'boolean',
};

const data = {
  /** @type {Store} */ settings: null,
  /** @type {Store} */ history: null,
  /** @type {Store} */ bookmarks: null,
  /** @type {Store} */ session: null,
  /** @type {Store} */ downloads: null,
};

function initData(userData) {
  data.settings = new Store(path.join(userData, 'settings.json'), SETTING_DEFAULTS);
  data.history = new Store(path.join(userData, 'history.json'), { entries: [] });
  data.bookmarks = new Store(path.join(userData, 'bookmarks.json'), { items: [] });
  data.session = new Store(path.join(userData, 'session.json'), { windows: [] });
  data.downloads = new Store(path.join(userData, 'downloads.json'), { items: [] });
  if (!(data.settings.get('searchEngine') in SEARCH_ENGINES)) data.settings.set('searchEngine', 'duckduckgo');
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
  engine,
  searchUrl,
  hostOf,
  originOf,
  isInternal,
  isShieldUp,
  isBookmarked,
  SEARCH_ENGINES,
  EDITABLE_SETTINGS,
};
