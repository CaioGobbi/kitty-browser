'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Only Kitty's own pages (kitty://…) get this API. The main process re-checks
// the sender's page on every call, so one page can't use another page's API.
if (location.protocol === 'kitty:') {
  const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

  // Interface language (src/i18n): the same t() as the main process, and the
  // static HTML translated as it loads.
  const i18n = ipcRenderer.sendSync('i18n:get');
  const t = (text, vars) => {
    const out = Object.hasOwn(i18n.dict, text) ? i18n.dict[text] : text;
    return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
  };
  let translatedDocument = false; // the page's script may do it first, before changing the text
  function translate(root) {
    if (root === document) translatedDocument = true;
    const lookup = (s) => {
      const key = s.trim().replace(/\s+/g, ' ');
      return key && Object.hasOwn(i18n.dict, key) ? i18n.dict[key] : null;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const out = lookup(node.nodeValue);
      if (out !== null) node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, () => out);
    }
    for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
      for (const el of root.querySelectorAll(`[${attr}]`)) {
        const out = lookup(el.getAttribute(attr));
        if (out !== null) el.setAttribute(attr, out);
      }
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.lang = i18n.lang;
    if (!translatedDocument) translate(document);
  });

  contextBridge.exposeInMainWorld('kitty', {
    platform: process.platform,
    lang: i18n.lang,
    t,
    translate: () => translate(document), // DOM nodes can't cross the bridge
    context: invoke('kitty:context'),
    stats: invoke('kitty:stats'),
    history: invoke('kitty:history'),
    removeHistory: invoke('kitty:history-remove'),
    clearHistory: invoke('kitty:history-clear'),
    bookmarks: invoke('kitty:bookmarks'),
    bookmarkOp: invoke('kitty:bookmark-op'),
    bypassThreat: invoke('kitty:threat-bypass'),
    site: {
      get: invoke('kitty:site'),
      set: invoke('kitty:site-set'),
    },
    extensions: {
      list: invoke('kitty:extensions'),
      enable: invoke('kitty:extensions-enable'),
      pin: invoke('kitty:extensions-pin'),
      remove: invoke('kitty:extensions-remove'),
      options: invoke('kitty:extensions-options'),
      store: invoke('kitty:extensions-store'),
      update: invoke('kitty:extensions-update'),
      setAutoUpdate: invoke('kitty:extensions-auto-update'),
    },
    passwords: {
      list: invoke('kitty:passwords'),
      reveal: invoke('kitty:password-reveal'),
      copy: invoke('kitty:password-copy'),
      update: invoke('kitty:password-update'),
      remove: invoke('kitty:password-remove'),
      removeNever: invoke('kitty:password-never-remove'),
    },
    settings: {
      get: invoke('kitty:settings'),
      set: invoke('kitty:settings-set'),
      removeAllowlisted: invoke('kitty:settings-allowlist-remove'),
      removePermission: invoke('kitty:settings-permission-remove'),
      clearData: invoke('kitty:settings-clear'),
      makeDefaultBrowser: invoke('kitty:settings-default-browser'),
      openDownloads: invoke('kitty:settings-open-downloads'),
      updateLists: invoke('kitty:settings-update-lists'),
      checkUpdate: invoke('kitty:settings-check-update'),
      importSources: invoke('kitty:import-sources'),
      importRun: invoke('kitty:import-run'),
      importOpenPrivacy: invoke('kitty:import-open-privacy'),
      finishSetup: invoke('kitty:setup-finish'),
    },
  });
}

// ---------------------------------------------------------------------------
// Swipe back/forward: a two-finger horizontal swipe on the trackpad arrives as
// horizontal wheel events. When the page itself can't scroll that way, Kitty
// shows an arrow at the edge that follows the fingers, like Safari, and
// navigates when they let go.
//
// On macOS the main process reports when the fingers touch down and lift off
// (gestures.js), so the arrow stays up for as long as they rest on the
// trackpad and the page changes exactly on release. Elsewhere wheel events are
// all there is: the gesture counts as released when its speed drops well below
// the peak or the events stop for a moment.

const SWIPE_DISTANCE = 140; // px of horizontal scrolling needed to navigate
const RELEASE_SLOWDOWN = 0.75; // (no phases) speed below 75% of the peak = released
const RELEASE_PAUSE = 90; // (no phases) ms without events = released
const GESTURE_GAP = 280; // ms without events before a new gesture may start

let nativePhases = false;
try {
  nativePhases = ipcRenderer.sendSync('gesture:native') === true;
} catch {
  // main process not ready: approximate detection
}

let swipe = null;
let fingersDown = false; // only meaningful with native phases
let releaseTimer = null;
let gapTimer = null;
let indicator = null;

/** Could the element under the pointer (or an ancestor) still scroll this way? */
function canScrollHorizontally(target, deltaX) {
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const scrollable = /(auto|scroll)/.test(style.overflowX) || el === document.scrollingElement;
    if (!scrollable || el.scrollWidth <= el.clientWidth + 1) continue;
    if (deltaX < 0 && el.scrollLeft > 0) return true;
    if (deltaX > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  return false;
}

function createIndicator() {
  const el = document.createElement('kitty-swipe');
  const s = el.style;
  s.position = 'fixed';
  s.top = '50%';
  s.left = '0';
  s.zIndex = '2147483647';
  s.width = '46px';
  s.height = '46px';
  s.marginTop = '-23px';
  s.borderRadius = '50%';
  s.display = 'grid';
  s.placeItems = 'center';
  s.pointerEvents = 'none';
  s.font = '600 22px -apple-system, "Segoe UI", sans-serif';
  s.color = '#fff';
  s.boxShadow = '0 6px 20px rgba(0,0,0,.28)';
  s.willChange = 'transform, opacity';
  s.transition = 'background-color .15s ease, transform .06s linear, opacity .06s linear';
  document.documentElement.append(el);
  return el;
}

function showIndicator(direction, progress) {
  indicator ??= createIndicator();
  const p = Math.min(1, progress);
  const ready = progress >= 1;
  const travel = -46 + p * 64; // slides in from the edge
  const x = direction === 'back' ? travel : innerWidth - 46 - travel;
  const s = indicator.style;
  s.background = ready ? '#ff7a45' : 'rgba(40,36,50,.82)';
  s.opacity = String(Math.min(1, p * 1.6));
  s.transform = `translateX(${x}px) scale(${0.7 + p * 0.3 + (ready ? 0.06 : 0)})`;
  indicator.textContent = direction === 'back' ? '←' : '→';
}

function hideIndicator(committed) {
  const el = indicator;
  indicator = null;
  if (!el) return;
  el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease';
  el.style.opacity = '0';
  el.style.transform += committed ? ' scale(1.25)' : ' scale(.6)';
  setTimeout(() => el.remove(), 240);
}

/** The fingers let go: navigate if the swipe went far enough, otherwise just put the arrow away. */
function release({ cancelled = false } = {}) {
  clearTimeout(releaseTimer);
  if (!swipe || swipe.done) return;
  swipe.done = true;
  const committed = !cancelled && !swipe.consumed && Math.abs(swipe.dx) >= SWIPE_DISTANCE;
  hideIndicator(committed);
  if (committed) ipcRenderer.send('gesture:navigate', swipe.dx < 0 ? 'back' : 'forward');
}

ipcRenderer.on('gesture:phase', (_event, phase) => {
  if (phase === 'began') {
    fingersDown = true;
    swipe = null; // a fresh gesture
  } else {
    fingersDown = false;
    // Wheel events travel separately from this message: let the last few land.
    setTimeout(() => release({ cancelled: phase === 'cancelled' }), 30);
  }
});

window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.deltaMode !== 0) return; // pinch-zoom, or a mouse wheel in lines/pages
    // With phases, only events while the fingers are down count: momentum
    // (including what spills into the page we just navigated to) is ignored.
    if (nativePhases && !fingersDown) return;

    clearTimeout(gapTimer);
    gapTimer = setTimeout(() => {
      if (!nativePhases) release();
      if (!nativePhases || swipe?.done) swipe = null;
    }, GESTURE_GAP);

    if (!swipe) {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5;
      // Not a horizontal swipe, or the page scrolls sideways itself: leave it alone.
      swipe = { dx: 0, peak: 0, done: !horizontal || canScrollHorizontally(e.target, e.deltaX) };
    }
    if (swipe.done) return;
    // Like Chrome, the swipe only gets what the page leaves: if a page script
    // takes the wheel itself (spreadsheets, maps, canvas editors), the
    // fingers scroll the content and the swipe is dropped. This listener runs
    // before the page's, so look on the next frame, after the page has
    // handled the event and any scrolling it caused has been reported.
    const current = swipe;
    requestAnimationFrame(() => {
      if (current.done) return;
      if (e.defaultPrevented || current.consumed) {
        current.done = true;
        clearTimeout(releaseTimer);
        hideIndicator(false);
        return;
      }
      // Natural scrolling: fingers moving right scroll left (negative deltaX) → back.
      showIndicator(current.dx < 0 ? 'back' : 'forward', Math.abs(current.dx) / SWIPE_DISTANCE);
    });

    swipe.dx += e.deltaX;
    if (nativePhases) return; // wait for the fingers to lift

    const speed = Math.abs(e.deltaX);
    swipe.peak = Math.max(swipe.peak, speed);
    if (Math.abs(swipe.dx) >= SWIPE_DISTANCE && swipe.peak > 4 && speed < swipe.peak * RELEASE_SLOWDOWN) {
      release();
      return;
    }
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, RELEASE_PAUSE);
  },
  { passive: true, capture: true },
);

// Pages like Google Sheets scroll sideways with their own code, moving an
// element that isn't under the pointer (so canScrollHorizontally can't see
// it). Any sideways scroll during a swipe means the page took the gesture.
const lastScrollLeft = new WeakMap();
window.addEventListener(
  'scroll',
  (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!(el instanceof Element)) return;
    const before = lastScrollLeft.get(el) ?? 0;
    lastScrollLeft.set(el, el.scrollLeft);
    if (el.scrollLeft !== before && swipe && !swipe.done) swipe.consumed = true;
  },
  { passive: true, capture: true },
);

// Mouse side buttons (back/forward). Windows also reports them as app-commands
// (handled in window.js), so listening here too would navigate twice.
if (process.platform !== 'win32') {
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3) ipcRenderer.send('gesture:navigate', 'back');
    if (e.button === 4) ipcRenderer.send('gesture:navigate', 'forward');
  });
}

// ---------------------------------------------------------------------------
// Saved passwords (passwords.js). On web pages, Kitty notices when a login form
// is sent, so it can offer to save it, and fills in accounts saved for the
// page's own origin. Passwords only reach this script for that origin, and the
// account list is drawn in a closed shadow root the page can't read.

if (/^https?:$/.test(location.protocol) && window === window.top) {
  const USER_TYPES = new Set(['text', 'email', 'tel', '']);
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const seen = new WeakSet();
  let accounts = null; // saved accounts for this origin, asked once per page
  let labels = null; // the picker's texts, in Kitty's language
  let picker = null;
  const PICKER_CSS = `
    :host { all: initial; position: fixed; z-index: 2147483647; }
    .box { min-width: 220px; max-width: 360px; padding: 4px; border-radius: 10px; background: #211e29; color: #ece8f2;
      border: 1px solid #2e2a38; box-shadow: 0 10px 30px rgba(0,0,0,.35); font: 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; }
    button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 7px 10px; border-radius: 7px; cursor: default; }
    button:hover, button:focus-visible { background: #2a2633; }
    .user { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dots, .manage { color: #9a93a8; font-size: 12px; }
    hr { border: 0; border-top: 1px solid #2e2a38; margin: 4px 2px; }`;

  const visible = (el) => el.isConnected && !el.disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const passwordFields = (scope = document) => [...scope.querySelectorAll('input[type=password]')].filter(visible);

  /** The username field of a password field: marked as such, or the last text field before it. */
  function usernameFor(password) {
    const scope = password.form || document;
    const fields = [...scope.querySelectorAll('input')].filter((i) => USER_TYPES.has(i.type) && visible(i));
    const marked = fields.find((i) => /username|email/i.test(i.autocomplete));
    if (marked) return marked;
    let last = null;
    for (const f of fields) if (f.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) last = f;
    return last;
  }

  function setValue(input, value) {
    if (!input) return;
    // The native setter, so frameworks that track the value (React) see a change.
    valueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---- Offering to save

  let lastSent = '';
  function captureLogin(scope) {
    const fields = passwordFields(scope).filter((f) => f.value);
    if (!fields.length) return;
    // Sign up (password + confirmation) or change password (old, new, new): the last one is the one to keep.
    const password = fields.at(-1).value;
    const username = usernameFor(fields[0])?.value.trim() || '';
    const key = `${username}\n${password}`;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send('pw:submitted', { username, password });
    // Single-page apps log in without navigating: the form going away means it worked.
    const watched = fields[0];
    let checks = 0;
    const timer = setInterval(() => {
      if (!visible(watched)) {
        clearInterval(timer);
        ipcRenderer.send('pw:form-gone');
      } else if (++checks > 20) clearInterval(timer);
    }, 500);
  }

  window.addEventListener('submit', (e) => captureLogin(e.target), true);
  window.addEventListener(
    'click',
    (e) => {
      const button = e.target instanceof Element && e.target.closest('button, input[type=submit], input[type=button], [role=button]');
      if (!button) return;
      const form = button.closest('form');
      if (form ? passwordFields(form).length : passwordFields().length) captureLogin(form || document);
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
      const form = e.target.form;
      if (e.target.type === 'password' || (form && passwordFields(form).length)) captureLogin(form || document);
    },
    true,
  );

  // ---- Filling in

  async function fill(id, password) {
    const login = await ipcRenderer.invoke('pw:fill', id);
    if (!login) return;
    setValue(usernameFor(password), login.username);
    setValue(password, login.password);
  }

  function closePicker() {
    picker?.remove();
    picker = null;
  }

  function openPicker(input) {
    closePicker();
    if (!accounts?.length || !labels) return;
    const password = input.type === 'password' ? input : passwordFields(input.form || document)[0];
    if (!password) return;
    const host = document.createElement('kitty-passwords');
    const root = host.attachShadow({ mode: 'closed' });
    const r = input.getBoundingClientRect();
    // Built without innerHTML: pages with Trusted Types would refuse it.
    const style = document.createElement('style');
    style.textContent = PICKER_CSS;
    const box = document.createElement('div');
    box.className = 'box';
    root.append(style, box);
    for (const account of accounts) {
      const b = document.createElement('button');
      const user = document.createElement('div');
      user.className = 'user';
      user.textContent = account.username || labels.noUsername;
      const dots = document.createElement('div');
      dots.className = 'dots';
      dots.textContent = `•••••••• · ${labels.saved}`;
      b.append(user, dots);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the field focused
      b.addEventListener('click', (e) => {
        if (!e.isTrusted) return;
        closePicker();
        fill(account.id, password);
      });
      box.append(b);
    }
    const manage = document.createElement('button');
    manage.className = 'manage';
    manage.textContent = labels.manage;
    manage.addEventListener('mousedown', (e) => e.preventDefault());
    manage.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      closePicker();
      ipcRenderer.send('pw:manage');
    });
    box.append(document.createElement('hr'), manage);
    host.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 230))}px`;
    host.style.top = `${r.bottom + 4}px`;
    document.documentElement.append(host);
    picker = host;
  }

  async function scan() {
    const fields = passwordFields();
    const fresh = fields.filter((f) => !seen.has(f));
    if (!fresh.length) return;
    accounts ??= await ipcRenderer.invoke('pw:query').catch(() => []);
    if (accounts.length) labels ??= await ipcRenderer.invoke('pw:labels').catch(() => null);
    for (const password of fresh) {
      seen.add(password);
      const user = usernameFor(password);
      // Not on the password field once a username was typed: the list would cover the form.
      const wanted = (input) => !input.value && (input !== password || !user?.value);
      for (const input of [password, user].filter(Boolean)) {
        input.addEventListener('focus', () => wanted(input) && openPicker(input));
        input.addEventListener('click', () => picker || (wanted(input) && openPicker(input)));
        input.addEventListener('blur', () => setTimeout(closePicker, 150));
        input.addEventListener('keydown', (e) => e.key === 'Escape' && closePicker());
        input.addEventListener('input', closePicker);
      }
    }
    // One saved account and a single login form (not sign up or change password):
    // fill it in right away, like Firefox. Only on secure pages, never over HTTP.
    const login = fresh[0];
    const form = passwordFields(login.form || document);
    if (accounts.length === 1 && isSecureContext && form.length === 1 && !login.value) {
      await fill(accounts[0].id, login);
      if (document.activeElement === login || document.activeElement === usernameFor(login)) closePicker();
    }
  }

  let scanTimer = null;
  const scanSoon = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  };
  document.addEventListener('DOMContentLoaded', () => {
    scan();
    new MutationObserver(scanSoon).observe(document.documentElement, { childList: true, subtree: true });
  });
  window.addEventListener('scroll', closePicker, true);
  window.addEventListener('resize', closePicker);
}
