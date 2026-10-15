'use strict';

// Filter lists, kept fresh: ads/trackers (Ghostery's EasyList/EasyPrivacy
// bundle) and dangerous sites (phishing and malware). Engines are cached on
// disk so startup is instant, then refreshed in the background.
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const { ElectronBlocker, FiltersEngine } = require('@ghostery/adblocker-electron');

const HOUR = 3_600_000;
/** Bump when the way threat lists are prepared changes, so old caches are rebuilt. */
const THREAT_FORMAT = 2;

const THREAT_LISTS = {
  phishing: ['https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt'],
  malware: [
    'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
    'https://ublockorigin.github.io/uAssets/filters/badware.txt',
  ],
};

const lists = {
  ads: { engine: null, file: 'adblock-engine.bin', maxAge: 24 * HOUR, updated: null },
  phishing: { engine: null, file: `phishing-engine.v${THREAT_FORMAT}.bin`, maxAge: 6 * HOUR, updated: null },
  malware: { engine: null, file: `malware-engine.v${THREAT_FORMAT}.bin`, maxAge: 6 * HOUR, updated: null },
};

let refreshing = null;

const cachePath = (list) => path.join(app.getPath('userData'), list.file);

async function build(name) {
  if (name === 'ads') return ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
  const texts = await Promise.all(
    THREAT_LISTS[name].map(async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return res.text();
    }),
  );
  return FiltersEngine.parse(texts.map(anchorHostnames).join('\n'), { loadCosmeticFilters: false, enableHtmlFiltering: false });
}

/**
 * The threat lists contain bare hostnames ("evil.example"). uBlock reads those
 * as "this domain and its subdomains", but Ghostery's engine treats them as a
 * substring of the whole URL — so a search for "evil.example" would be blocked
 * too. Anchoring them (||evil.example^) gives uBlock's meaning.
 */
function anchorHostnames(text) {
  return text.replace(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/gim, '||$1^');
}

async function loadCached(name) {
  const list = lists[name];
  const Engine = name === 'ads' ? ElectronBlocker : FiltersEngine;
  try {
    const file = cachePath(list);
    list.engine = Engine.deserialize(new Uint8Array(await fs.promises.readFile(file)));
    list.updated = (await fs.promises.stat(file)).mtimeMs;
  } catch {
    // no cache (first run) or a cache from an incompatible version
  }
}

async function refreshOne(name) {
  const list = lists[name];
  try {
    const engine = await build(name);
    list.engine = engine;
    list.updated = Date.now();
    await fs.promises.writeFile(cachePath(list), engine.serialize());
  } catch (err) {
    console.error(`[kitty] Falha ao atualizar a lista "${name}":`, err.message);
  }
}

/** Refreshes lists older than their max age (or all of them with force). */
function refresh({ force = false } = {}) {
  if (refreshing) return refreshing;
  const stale = Object.keys(lists).filter((name) => force || !lists[name].updated || Date.now() - lists[name].updated > lists[name].maxAge);
  refreshing = Promise.all(stale.map(refreshOne)).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function init() {
  await Promise.all(Object.keys(lists).map(loadCached));
  // Lists without a cache are fetched right away; stale ones a bit later so
  // they don't compete with the pages restored at startup.
  const missing = Object.keys(lists).filter((name) => !lists[name].engine);
  await Promise.all(missing.map(refreshOne));
  setTimeout(() => refresh(), 30_000);
  setInterval(() => refresh(), HOUR);
}

/** @returns {'phishing' | 'malware' | null} */
function threatFor(request) {
  for (const name of ['phishing', 'malware']) {
    if (lists[name].engine?.match(request).match) return name;
  }
  return null;
}

function status() {
  return {
    ads: lists.ads.updated,
    threats: Math.min(lists.phishing.updated || 0, lists.malware.updated || 0) || null,
    refreshing: !!refreshing,
  };
}

module.exports = {
  init,
  refresh,
  status,
  threatFor,
  adBlocker: () => lists.ads.engine,
};
