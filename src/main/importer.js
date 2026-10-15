'use strict';

// Imports bookmarks and history saved in other browsers (Chrome, Brave, Edge,
// Vivaldi, Opera, Arc, Chromium and Firefox). Everything is read from the
// files those browsers keep on disk: nothing goes over the network.
//
// Their databases are copied to a temporary folder before reading, because a
// browser that is open keeps them locked.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HISTORY_LIMIT = 5000; // same as window.js
const ICON_MAX_BYTES = 64 * 1024;
const SAME_VISIT_MS = 1000;
const CHROME_EPOCH_OFFSET = 11644473600000; // ms between 1601-01-01 and 1970-01-01

const home = os.homedir();
const macSupport = path.join(home, 'Library', 'Application Support');
const winLocal = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
const winRoaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
const linuxConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');

/** Where each Chromium-based browser keeps its profiles, per platform. */
const CHROMIUM_BROWSERS = [
  {
    key: 'chrome',
    name: 'Google Chrome',
    darwin: [macSupport, 'Google', 'Chrome'],
    win32: [winLocal, 'Google', 'Chrome', 'User Data'],
    linux: [linuxConfig, 'google-chrome'],
  },
  {
    key: 'brave',
    name: 'Brave',
    darwin: [macSupport, 'BraveSoftware', 'Brave-Browser'],
    win32: [winLocal, 'BraveSoftware', 'Brave-Browser', 'User Data'],
    linux: [linuxConfig, 'BraveSoftware', 'Brave-Browser'],
  },
  {
    key: 'edge',
    name: 'Microsoft Edge',
    darwin: [macSupport, 'Microsoft Edge'],
    win32: [winLocal, 'Microsoft', 'Edge', 'User Data'],
    linux: [linuxConfig, 'microsoft-edge'],
  },
  {
    key: 'vivaldi',
    name: 'Vivaldi',
    darwin: [macSupport, 'Vivaldi'],
    win32: [winLocal, 'Vivaldi', 'User Data'],
    linux: [linuxConfig, 'vivaldi'],
  },
  {
    key: 'opera',
    name: 'Opera',
    darwin: [macSupport, 'com.operasoftware.Opera'],
    win32: [winRoaming, 'Opera Software', 'Opera Stable'],
    linux: [linuxConfig, 'opera'],
  },
  {
    key: 'opera-gx',
    name: 'Opera GX',
    darwin: [macSupport, 'com.operasoftware.OperaGX'],
    win32: [winRoaming, 'Opera Software', 'Opera GX Stable'],
  },
  {
    key: 'arc',
    name: 'Arc',
    darwin: [macSupport, 'Arc', 'User Data'],
    win32: [winLocal, 'Packages', 'TheBrowserCompany.Arc_ttt1ap7aakyb4', 'LocalCache', 'Local', 'Arc', 'User Data'],
  },
  {
    key: 'chromium',
    name: 'Chromium',
    darwin: [macSupport, 'Chromium'],
    win32: [winLocal, 'Chromium', 'User Data'],
    linux: [linuxConfig, 'chromium'],
  },
];

const FIREFOX_ROOT = {
  darwin: [macSupport, 'Firefox'],
  win32: [winRoaming, 'Mozilla', 'Firefox'],
  linux: [home, '.mozilla', 'firefox'],
};

function exists(file) {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when the folder exists but the system won't let Kitty in (macOS privacy protection). */
function denied(dir) {
  try {
    fs.readdirSync(dir);
    return false;
  } catch (err) {
    return err.code === 'EPERM' || err.code === 'EACCES';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Finding browsers and profiles

const hasChromiumData = (dir) =>
  ['Bookmarks', 'AccountBookmarks', 'History'].some((f) => exists(path.join(dir, f)));

function chromiumProfiles(browser) {
  const parts = browser[process.platform];
  if (!parts) return [];
  const root = path.join(...parts);
  if (!exists(root)) return [];
  const names = readJson(path.join(root, 'Local State'))?.profile?.info_cache || {};
  const dirs = new Set(Object.keys(names));
  try {
    for (const d of fs.readdirSync(root)) if (d === 'Default' || /^Profile \d+$/.test(d)) dirs.add(d);
  } catch {
    // unreadable: nothing to add
  }
  const profiles = [...dirs]
    .map((dir) => ({ dir: path.join(root, dir), label: names[dir]?.name || dir }))
    .filter((p) => hasChromiumData(p.dir));
  // Opera keeps its single profile right in the root folder.
  if (!profiles.length && hasChromiumData(root)) {
    profiles.push({ dir: root, label: '' });
  }
  return profiles;
}

/** Firefox lists its profiles in profiles.ini. */
function firefoxProfiles() {
  const parts = FIREFOX_ROOT[process.platform];
  if (!parts) return [];
  const root = path.join(...parts);
  let ini;
  try {
    ini = fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8');
  } catch {
    return [];
  }
  const profiles = [];
  let current = null;
  for (const line of ini.split(/\r?\n/)) {
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      current = section[1].startsWith('Profile') ? {} : null;
      if (current) profiles.push(current);
      continue;
    }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (current && kv) current[kv[1].trim()] = kv[2].trim();
  }
  return profiles
    .filter((p) => p.Path)
    .map((p) => ({
      dir: p.IsRelative === '0' ? p.Path : path.join(root, ...p.Path.split('/')),
      label: p.Name || p.Path,
    }))
    .filter((p) => exists(path.join(p.dir, 'places.sqlite')));
}

/** Browsers whose data is there but unreadable: on macOS, Kitty needs Full Disk Access for them. */
function blockedBrowsers() {
  if (process.platform !== 'darwin') return [];
  const roots = CHROMIUM_BROWSERS.map((b) => [b.name, b[process.platform]]);
  roots.push(['Firefox', FIREFOX_ROOT[process.platform]]);
  return roots.filter(([, parts]) => parts && denied(path.join(...parts))).map(([name]) => name);
}

/** Every browser profile Kitty can import from. */
function listSources() {
  const sources = [];
  for (const browser of CHROMIUM_BROWSERS) {
    const profiles = chromiumProfiles(browser);
    for (const p of profiles) {
      sources.push({
        id: `${browser.key}:${path.basename(p.dir)}`,
        name: profiles.length > 1 && p.label ? `${browser.name} (${p.label})` : browser.name,
        type: 'chromium',
        dir: p.dir,
      });
    }
  }
  const firefox = firefoxProfiles();
  for (const p of firefox) {
    sources.push({
      id: `firefox:${path.basename(p.dir)}`,
      name: firefox.length > 1 ? `Firefox (${p.label})` : 'Firefox',
      type: 'firefox',
      dir: p.dir,
    });
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Reading SQLite databases from a temporary copy

let DatabaseSync = null;
function sqlite() {
  // Loaded on demand: node:sqlite still prints an "experimental" warning.
  DatabaseSync ??= require('node:sqlite').DatabaseSync;
  return DatabaseSync;
}

class BrowserLockedError extends Error {}

/** Opens a copy of a browser database (with its journal), or returns null if it's missing. */
function openCopy(file, tmp) {
  if (!exists(file)) return null;
  const copy = path.join(tmp, path.basename(file));
  try {
    fs.copyFileSync(file, copy);
    for (const suffix of ['-wal', '-journal']) {
      if (exists(file + suffix)) fs.copyFileSync(file + suffix, copy + suffix);
    }
  } catch {
    throw new BrowserLockedError(file);
  }
  const Db = sqlite();
  return new Db(copy, { readOnly: true });
}

function iconDataUrl(bytes) {
  if (!bytes || !bytes.length || bytes.length > ICON_MAX_BYTES) return null;
  const buf = Buffer.from(bytes);
  let type = null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') type = 'image/png';
  else if (buf[0] === 0xff && buf[1] === 0xd8) type = 'image/jpeg';
  else if (buf.toString('latin1', 0, 4) === 'GIF8') type = 'image/gif';
  else if (buf.toString('latin1', 0, 4) === 'RIFF') type = 'image/webp';
  else if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) type = 'image/x-icon';
  else if (/^\s*<(\?xml|svg)/.test(buf.toString('utf8', 0, 64))) type = 'image/svg+xml';
  return type && `data:${type};base64,${buf.toString('base64')}`;
}

const isWeb = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

// ---------------------------------------------------------------------------
// Chromium

const chromeTime = (us) => {
  const ms = Number(us) / 1000 - CHROME_EPOCH_OFFSET;
  return ms > 0 ? Math.round(ms) : Date.now();
};

// Newer Chrome keeps the bookmarks of the signed-in Google account apart from the local ones.
const CHROMIUM_BOOKMARK_FILES = ['Bookmarks', 'AccountBookmarks'];

function chromiumBookmarks(dir, tmp) {
  const found = [];
  // `folder` is the path of folders under the root (bar, other bookmarks...), e.g. ['Trabalho', 'Projetos'].
  const walk = (node, bar, folder) => {
    if (!node) return;
    if (node.type === 'url' && isWeb(node.url)) {
      found.push({ url: node.url, title: node.name || node.url, time: chromeTime(node.date_added), bar, folder });
    }
    const inner = node.type === 'folder' && folder ? [...folder, node.name || 'Sem nome'] : [];
    for (const child of node.children || []) walk(child, bar, inner);
  };
  for (const file of CHROMIUM_BOOKMARK_FILES) {
    const roots = readJson(path.join(dir, file))?.roots;
    if (!roots) continue;
    // Roots are walked with folder = null, so their own name doesn't become a folder.
    walk(roots.bookmark_bar, true, null);
    for (const [key, root] of Object.entries(roots)) if (key !== 'bookmark_bar') walk(root, false, null);
  }
  if (!found.length) return [];

  // Favicons the browser already saved, so Kitty doesn't need to fetch them.
  let db = null;
  try {
    db = openCopy(path.join(dir, 'Favicons'), tmp);
    if (db) {
      const query = db.prepare(
        `SELECT fb.image_data AS data FROM icon_mapping im
         JOIN favicon_bitmaps fb ON fb.icon_id = im.icon_id
         WHERE im.page_url = ? AND length(fb.image_data) > 0
         ORDER BY abs(fb.width - 32) LIMIT 1`,
      );
      for (const b of found) b.favicon = iconDataUrl(query.get(b.url)?.data);
    }
  } catch {
    // icons are a bonus: import without them
  } finally {
    db?.close();
  }
  return found;
}

function chromiumHistory(dir, tmp) {
  const db = openCopy(path.join(dir, 'History'), tmp);
  if (!db) return [];
  try {
    const query = db.prepare(
      `SELECT url, title, last_visit_time AS t FROM urls
       WHERE hidden = 0 AND last_visit_time > 0
       ORDER BY last_visit_time DESC LIMIT ?`,
    );
    // Microseconds since 1601 are past 2^53: read them as BigInt, or node:sqlite throws.
    query.setReadBigInts(true);
    return query
      .all(HISTORY_LIMIT)
      .filter((r) => isWeb(r.url))
      .map((r) => ({ url: r.url, title: r.title || r.url, time: chromeTime(r.t) }));
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Firefox (times are microseconds since 1970)

function firefoxBookmarks(dir, tmp) {
  const db = openCopy(path.join(dir, 'places.sqlite'), tmp);
  if (!db) return [];
  const found = [];
  try {
    const rows = db
      .prepare(
        `SELECT b.id, b.type, b.title, b.parent, b.guid, p.url, b.dateAdded AS t FROM moz_bookmarks b
         LEFT JOIN moz_places p ON p.id = b.fk WHERE b.type IN (1, 2) ORDER BY b.parent, b.position`,
      )
      .all();
    const children = new Map();
    for (const r of rows) (children.get(r.parent) ?? children.set(r.parent, []).get(r.parent)).push(r);
    const seen = new Set();
    const walk = (id, bar, folder) => {
      for (const r of children.get(id) || []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (r.type === 2) walk(r.id, bar, [...folder, r.title || 'Sem nome']);
        else if (isWeb(r.url)) {
          found.push({
            url: r.url,
            title: r.title || r.url,
            time: r.t ? Math.round(Number(r.t) / 1000) : Date.now(),
            bar,
            folder,
          });
        }
      }
    };
    const roots = new Map(rows.filter((r) => r.type === 2).map((r) => [r.guid, r.id]));
    // Toolbar first, then the bookmarks menu, other bookmarks and mobile, like Firefox shows them.
    for (const guid of ['toolbar_____', 'menu________', 'unfiled_____', 'mobile______']) {
      if (roots.has(guid)) walk(roots.get(guid), guid === 'toolbar_____', []);
    }
  } finally {
    db.close();
  }

  let icons = null;
  try {
    icons = openCopy(path.join(dir, 'favicons.sqlite'), tmp);
    if (icons) {
      const query = icons.prepare(
        `SELECT i.data FROM moz_pages_w_icons pg
         JOIN moz_icons_to_pages ip ON ip.page_id = pg.id
         JOIN moz_icons i ON i.id = ip.icon_id
         WHERE pg.page_url = ? AND i.data IS NOT NULL
         ORDER BY abs(i.width - 32) LIMIT 1`,
      );
      for (const b of found) b.favicon = iconDataUrl(query.get(b.url)?.data);
    }
  } catch {
    // icons are a bonus
  } finally {
    icons?.close();
  }
  return found;
}

function firefoxHistory(dir, tmp) {
  const db = openCopy(path.join(dir, 'places.sqlite'), tmp);
  if (!db) return [];
  try {
    return db
      .prepare(
        `SELECT url, title, last_visit_date AS t FROM moz_places
         WHERE hidden = 0 AND last_visit_date IS NOT NULL
         ORDER BY last_visit_date DESC LIMIT ?`,
      )
      .all(HISTORY_LIMIT)
      .filter((r) => isWeb(r.url))
      .map((r) => ({ url: r.url, title: r.title || r.url, time: Math.round(Number(r.t) / 1000) }));
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Merging into Kitty's stores

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Adds bookmarks Kitty doesn't have yet (by URL). Bookmarks imported before
 * folders existed get their folder now. Returns how many were added.
 */
function mergeBookmarks(store, incoming) {
  const items = store.get('items');
  const known = new Map(items.map((b) => [b.url, b]));
  let added = 0;
  let changed = false;
  for (const b of incoming) {
    const folder = (b.folder || []).map((name) => String(name).slice(0, 100));
    const existing = known.get(b.url);
    if (existing) {
      // Only imported ones (they have `bar`): bookmarks saved with the star stay where they are.
      if ('bar' in existing && !existing.folder?.length && folder.length) {
        existing.folder = folder;
        changed = true;
      }
      continue;
    }
    const bookmark = { id: newId(), url: b.url, title: b.title.slice(0, 300), favicon: b.favicon || null, time: b.time, bar: b.bar, folder };
    known.set(b.url, bookmark);
    items.push(bookmark);
    added++;
  }
  if (added || changed) store.set('items', items);
  return added;
}

/** Mixes the imported history into Kitty's, newest first, keeping the same size limit. */
function mergeHistory(store, incoming) {
  const entries = store.get('entries');
  // The loop below may move a visit back a few ms, so a visit counts as known
  // when Kitty has the same URL at nearly the same time (or importing twice duplicates it).
  const known = new Map();
  for (const e of entries) (known.get(e.url) ?? known.set(e.url, []).get(e.url)).push(e.time);
  const isKnown = (e) => known.get(e.url)?.some((t) => Math.abs(t - e.time) < SAME_VISIT_MS);
  const fresh = new Set(
    incoming.filter((e) => !isKnown(e)).map((e) => ({ url: e.url, title: e.title.slice(0, 500), time: e.time })),
  );
  if (!fresh.size) return 0;
  const merged = [...entries, ...fresh];
  merged.sort((a, b) => b.time - a.time);
  merged.length = Math.min(merged.length, HISTORY_LIMIT);
  // Entries are removed by their time, so no two may share one.
  for (let i = 1; i < merged.length; i++) {
    if (merged[i].time >= merged[i - 1].time) merged[i].time = merged[i - 1].time - 1;
  }
  const kept = merged.filter((e) => fresh.has(e)).length;
  store.set('entries', merged);
  return kept;
}

/**
 * Imports from one source (an id from listSources) into Kitty's stores.
 * @returns {{ bookmarks: number, history: number }} how many items were added
 */
function importFrom(id, kinds, stores) {
  const source = listSources().find((s) => s.id === id);
  if (!source) throw new Error('Navegador não encontrado.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitty-import-'));
  const chromium = source.type === 'chromium';
  try {
    // Read everything first, so a failure doesn't leave a half-done import behind.
    const bookmarks = kinds.includes('bookmarks')
      ? chromium ? chromiumBookmarks(source.dir, tmp) : firefoxBookmarks(source.dir, tmp)
      : [];
    const history = kinds.includes('history')
      ? chromium ? chromiumHistory(source.dir, tmp) : firefoxHistory(source.dir, tmp)
      : [];
    return {
      bookmarks: bookmarks.length ? mergeBookmarks(stores.bookmarks, bookmarks) : 0,
      history: history.length ? mergeHistory(stores.history, history) : 0,
    };
  } catch (err) {
    if (err instanceof BrowserLockedError) {
      throw new Error(`Não foi possível ler os dados. Feche o ${source.name.replace(/ \(.*/, '')} e tente de novo.`);
    }
    throw err;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { listSources, blockedBrowsers, importFrom };
