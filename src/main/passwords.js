'use strict';

// Saved logins. Everything stays on this computer: passwords.json keeps each
// password encrypted by the operating system (Keychain on macOS, DPAPI on
// Windows) through safeStorage, and nothing is ever saved from a private window.
//
// Flow: preload-page.js reports a submitted login form; once the page moves on
// (navigation, or the form disappears) the tab shows a "save password?" bar.
// On the next visit the same preload asks which accounts exist for the page's
// origin and fills them in.
const { clipboard, ipcMain, safeStorage, systemPreferences } = require('electron');

const { data, hostOf, originOf } = require('./data');
const { registry } = require('./registry');

const PENDING_TTL = 30_000; // a submitted login older than this is never offered
const OFFER_TTL = 8_000; // after this, leaving the page drops the bar
const UNLOCK_TTL = 5 * 60_000; // how long Touch ID unlocks revealing passwords

let unlockedUntil = 0;
/** Set by main.js: opens kitty://passwords. */
let openManager = () => {};

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

const encrypt = (text) => safeStorage.encryptString(text).toString('base64');

function decrypt(stored) {
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null;
  }
}

const logins = () => data.passwords.get('logins');
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Only real web pages: no kitty://, file:// or data: pages. */
function webOrigin(url) {
  return /^https?:/.test(String(url)) ? originOf(url) : '';
}

function saveLogin({ origin, username, password }) {
  const now = Date.now();
  const all = logins();
  const existing = all.find((l) => l.origin === origin && l.username === username);
  if (existing) {
    existing.password = encrypt(password);
    existing.updated = now;
  } else {
    all.push({ id: newId(), origin, username, password: encrypt(password), created: now, updated: now, used: 0 });
  }
  data.passwords.set('logins', all);
}

// ---------------------------------------------------------------------------
// The "save password?" bar of each tab

function offerFor(tab) {
  const o = tab.passwordOffer;
  return o ? { id: o.id, origin: o.origin, username: o.username, update: o.update } : null;
}

/** Turns the login a page just submitted into a bar, unless there's nothing new to save. */
function showOffer(kwin, tab) {
  const pending = tab.pendingLogin;
  tab.pendingLogin = null;
  if (!pending || Date.now() - pending.at > PENDING_TTL) return;
  const same = logins().find((l) => l.origin === pending.origin && l.username === pending.username);
  if (same && decrypt(same.password) === pending.password) return;
  tab.passwordOffer = { ...pending, id: newId(), update: !!same, shownAt: Date.now() };
  kwin.sendState();
}

function answerOffer(kwin, { tabId, offerId, answer } = {}) {
  const tab = kwin.tabs.get(Number(tabId));
  const offer = tab?.passwordOffer;
  if (!offer || offer.id !== offerId) return;
  tab.passwordOffer = null;
  if (answer === 'save' && canEncrypt()) saveLogin(offer);
  if (answer === 'never') {
    const never = data.passwords.get('never');
    if (!never.includes(offer.origin)) data.passwords.set('never', [...never, offer.origin]);
  }
  kwin.sendState();
}

/** Called for every new tab (window.js hooks.tabCreated). */
function watchTab(kwin, tab) {
  const wc = tab.view.webContents;
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    const offer = tab.passwordOffer;
    if (offer && Date.now() - offer.shownAt > OFFER_TTL) {
      tab.passwordOffer = null;
      kwin.sendState();
    }
  });
  // The usual sign that a login worked: the page moved on.
  wc.on('did-navigate', () => tab.pendingLogin && showOffer(kwin, tab));
  wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => isMainFrame && tab.pendingLogin && showOffer(kwin, tab));
}

// ---------------------------------------------------------------------------
// Revealing passwords on kitty://passwords

/** On Macs with Touch ID, showing or copying a password asks for the fingerprint first. */
async function unlock() {
  if (Date.now() < unlockedUntil) return true;
  if (process.platform !== 'darwin' || !systemPreferences.canPromptTouchID()) return true;
  try {
    await systemPreferences.promptTouchID('mostrar suas senhas salvas');
    unlockedUntil = Date.now() + UNLOCK_TTL;
    return true;
  } catch {
    return false;
  }
}

function managerSnapshot() {
  const icons = data.favicons.get('icons');
  return {
    available: canEncrypt(),
    platform: process.platform,
    logins: logins()
      .map(({ id, origin, username, updated, used }) => ({ id, origin, username, updated, used, icon: icons[hostOf(origin)]?.data || null }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)),
    never: data.passwords.get('never'),
  };
}

// ---------------------------------------------------------------------------
// IPC

function registerIpc({ fromPage, openPasswords }) {
  openManager = openPasswords;

  /** The tab and origin of a web page's main frame (never trusting what the page says about itself). */
  const pageOf = (event) => {
    if (event.senderFrame !== event.sender.mainFrame) return null;
    const found = registry.tabByWebContentsId(event.sender.id);
    const origin = webOrigin(event.senderFrame.url);
    return found && origin ? { ...found, origin } : null;
  };

  ipcMain.handle('pw:query', (event) => {
    const page = pageOf(event);
    if (!page) return [];
    return logins()
      .filter((l) => l.origin === page.origin)
      .sort((a, b) => b.used - a.used)
      .map(({ id, username }) => ({ id, username }));
  });

  ipcMain.handle('pw:fill', (event, id) => {
    const page = pageOf(event);
    const login = page && logins().find((l) => l.id === id && l.origin === page.origin);
    const password = login && decrypt(login.password);
    if (password == null) return null;
    login.used = Date.now();
    data.passwords.save();
    return { username: login.username, password };
  });

  ipcMain.on('pw:submitted', (event, form) => {
    const page = pageOf(event);
    if (!page || page.kwin.isPrivate || !data.settings.get('offerPasswords') || !canEncrypt()) return;
    if (data.passwords.get('never').includes(page.origin)) return;
    const username = String(form?.username ?? '').slice(0, 500);
    const password = String(form?.password ?? '');
    if (!password || password.length > 1000) return;
    page.tab.pendingLogin = { origin: page.origin, username, password, at: Date.now() };
  });

  // The login form went away without a navigation (single-page apps).
  ipcMain.on('pw:form-gone', (event) => {
    const page = pageOf(event);
    if (page?.tab.pendingLogin) showOffer(page.kwin, page.tab);
  });

  ipcMain.on('pw:manage', (event) => {
    if (pageOf(event)) openManager();
  });

  // ---- kitty://passwords
  const manager = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => (fromPage(event, 'passwords') ? fn(...args) : null));
  manager('kitty:passwords', () => managerSnapshot());
  manager('kitty:password-reveal', async (id) => {
    const login = logins().find((l) => l.id === id);
    if (!login || !(await unlock())) return null;
    return decrypt(login.password);
  });
  manager('kitty:password-copy', async (id) => {
    const login = logins().find((l) => l.id === id);
    const password = login && (await unlock()) ? decrypt(login.password) : null;
    if (password == null) return false;
    clipboard.writeText(password);
    return true;
  });
  manager('kitty:password-update', (id, changes = {}) => {
    const login = logins().find((l) => l.id === id);
    if (!login) return managerSnapshot();
    const username = String(changes.username ?? login.username).slice(0, 500);
    // Two logins for the same account would fight over which one fills.
    if (logins().some((l) => l !== login && l.origin === login.origin && l.username === username)) return { error: 'duplicate' };
    login.username = username;
    if (changes.password && canEncrypt()) login.password = encrypt(String(changes.password).slice(0, 1000));
    login.updated = Date.now();
    data.passwords.save();
    return managerSnapshot();
  });
  manager('kitty:password-remove', (id) => {
    data.passwords.set('logins', logins().filter((l) => l.id !== id));
    return managerSnapshot();
  });
  manager('kitty:password-never-remove', (origin) => {
    data.passwords.set('never', data.passwords.get('never').filter((o) => o !== origin));
    return managerSnapshot();
  });
}

module.exports = { registerIpc, watchTab, answerOffer, offerFor };
