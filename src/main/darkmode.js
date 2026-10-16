// Kitty — dark mode: the browser theme (interface and kitty:// pages) and dark
// pages on websites.
//
// The theme is nativeTheme.themeSource. Websites get their own setting, per tab,
// through the DevTools protocol on each tab's webContents:
//   - prefers-color-scheme: dark, so sites with a dark mode of their own
//     (YouTube, GitHub…) use it;
//   - Chromium's auto dark mode, which darkens only pages without a dark color
//     scheme of their own.
// With dark pages off for a site, it gets prefers-color-scheme: light and nothing
// is darkened. `darkPages` picks the default ('dark' everywhere, or 'site': sites
// follow the Kitty theme and nothing is forced), `darkSites` the per-host
// exceptions chosen with the moon button. Private windows remember theirs only
// in memory.

const { nativeTheme } = require('electron');
const { data, hostOf, isInternal } = require('./data');

const THEMES = ['dark', 'light', 'system'];
const DARK_PAGES = ['dark', 'site'];

/** Per-host choices made in private windows: never written to disk. */
const privateSites = new Map();

/** Every open tab → the mode applied to it (see modeFor). */
const tabs = new Map();

function applyTheme() {
  const theme = data.settings.get('theme');
  nativeTheme.themeSource = THEMES.includes(theme) ? theme : 'dark';
}

/** true/false when dark pages are switched on/off for this host by hand, else undefined. */
function exception(host, isPrivate) {
  if (isPrivate && privateSites.has(host)) return privateSites.get(host);
  const v = data.settings.get('darkSites')[host];
  return typeof v === 'boolean' ? v : undefined;
}

/** Whether pages on this URL are dark (null for kitty:// and other non-web pages). */
function isDark(url, isPrivate) {
  const host = /^https?:/.test(url || '') ? hostOf(url) : '';
  if (!host) return null;
  const v = exception(host, isPrivate);
  return v !== undefined ? v : data.settings.get('darkPages') !== 'site';
}

/** What the page should get: 'dark', 'light' or '' (nothing: follow the Kitty theme). */
function modeFor(url, isPrivate) {
  const dark = isDark(url, isPrivate);
  if (dark === null) return '';
  if (dark) return 'dark';
  // In 'site' mode a site without an exception just follows the theme.
  return exception(hostOf(url), isPrivate) === false ? 'light' : '';
}

async function send(wc, method, params) {
  try {
    await wc.debugger.sendCommand(method, params);
  } catch {
    // the page went away, or another client took the debugger
  }
}

function apply(tab, url) {
  const wc = tab.view.webContents;
  if (wc.isDestroyed()) return;
  const mode = modeFor(url, tab.owner.isPrivate);
  if (tabs.get(tab) === mode) return;
  tabs.set(tab, mode);
  if (!wc.debugger.isAttached()) {
    if (!mode) return;
    try {
      wc.debugger.attach('1.3');
    } catch {
      return; // DevTools or an extension holds it
    }
  }
  send(wc, 'Emulation.setEmulatedMedia', { features: mode ? [{ name: 'prefers-color-scheme', value: mode }] : [] });
  send(wc, 'Emulation.setAutoDarkModeOverride', mode === 'dark' ? { enabled: true } : mode === 'light' ? { enabled: false } : {});
}

/** Called for every new tab (window.js hooks.tabCreated). */
function watchTab(tab) {
  const wc = tab.view.webContents;
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) apply(tab, details.url);
  });
  wc.debugger.on('detach', () => tabs.has(tab) && tabs.set(tab, null));
  wc.once('destroyed', () => tabs.delete(tab));
  tabs.set(tab, null);
  apply(tab, tab.pendingUrl || wc.getURL());
}

/** Re-applies to every tab, after a setting or an exception changed. */
function refresh() {
  for (const tab of tabs.keys()) {
    const wc = tab.view.webContents;
    tabs.set(tab, wc.debugger.isAttached() ? null : '');
    apply(tab, tab.pendingUrl || wc.getURL());
  }
}

/** The moon button: dark pages on/off for the tab's site. */
function toggleSite(tab) {
  const url = tab.view.webContents.getURL();
  const dark = isDark(url, tab.owner.isPrivate);
  if (dark === null) return;
  const host = hostOf(url);
  const next = !dark;
  const byDefault = data.settings.get('darkPages') !== 'site';
  if (tab.owner.isPrivate) {
    privateSites.set(host, next);
  } else {
    const sites = { ...data.settings.get('darkSites') };
    if (next === byDefault) delete sites[host];
    else sites[host] = next;
    data.settings.set('darkSites', sites);
  }
  refresh();
}

module.exports = { THEMES, DARK_PAGES, applyTheme, isDark, watchTab, refresh, toggleSite };
