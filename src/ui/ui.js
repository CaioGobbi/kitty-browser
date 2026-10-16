'use strict';

const api = window.kittyUI;
const $ = (id) => document.getElementById(id);

const chrome = $('chrome');
const tabstrip = $('tabstrip');
const toolbar = $('toolbar');
const sidebar = $('sidebar');
const tabsEl = $('tabs');
const address = $('address');
const addressForm = $('address-form');
const siteIcon = $('site-icon');
const reloadBtn = $('reload');
const starBtn = $('star');
const shieldBtn = $('shield');
const darkBtn = $('dark-btn');
const shieldCount = $('shield-count');
const bookmarksBar = $('bookmarks-bar');
const permBar = $('perm-bar');
const findBar = $('find-bar');
const findInput = $('find-input');
const findCount = $('find-count');
const scrim = $('scrim');
const suggestionsEl = $('suggestions');
const downloadsBtn = $('downloads-btn');
const downloadsPanel = $('downloads-panel');
const menuPanel = $('menu-panel');

document.body.classList.add(api.platform === 'darwin' ? 'mac' : api.platform === 'win32' ? 'win' : 'linux');
if (api.isPrivate) {
  document.documentElement.classList.add('private');
  document.body.classList.add('private');
}

const isMac = api.platform === 'darwin';

/** "⇧⌘N" → "Ctrl+Shift+N" outside macOS (tooltips and menu hints are written the Mac way). */
function pcShortcuts(text) {
  return text.replace(/([⌃⌥⇧⌘]+)([^\s)]+)/g, (_m, mods, key) => {
    const names = [];
    if (mods.includes('⌘') || mods.includes('⌃')) names.push('Ctrl');
    if (mods.includes('⇧')) names.push('Shift');
    if (mods.includes('⌥')) names.push('Alt');
    return [...names, key === '↵' ? 'Enter' : key].join('+');
  });
}
if (!isMac) {
  for (const node of document.querySelectorAll('[title]')) node.title = pcShortcuts(node.title);
  for (const kbd of document.querySelectorAll('kbd')) kbd.textContent = pcShortcuts(kbd.textContent);
}
const keys = (text) => (isMac ? text : pcShortcuts(text));

let state = { activeTabId: null, tabs: [] };
let bookmarks = [];
let downloads = [];
let uiSettings = { bookmarksBar: 'newtab', tabLayout: 'classic', verticalTabsCollapsed: false, engineName: 'DuckDuckGo' };
let editing = false; // true while the user is typing in the address bar

const ICONS = {
  kitty: '<svg class="kitty" viewBox="0 0 24 24"><path d="M4 3l4 4.5h8L20 3v9a8 8 0 0 1-16 0z"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  audio: '<svg viewBox="0 0 16 16"><path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/></svg>',
  muted: '<svg viewBox="0 0 16 16"><path d="M2.5 6h2.5L8.5 3v10L5 10H2.5z"/><path d="m11 6 3 4M14 6l-3 4"/></svg>',
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4"/><path d="m10 10 3 3"/></svg>',
  history: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>',
  star: '<svg class="star" viewBox="0 0 16 16"><path fill="currentColor" d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/></svg>',
  globe: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M6 4v8M10 4v8"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5.5 3.5v9l7-4.5z"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M2 4.5h4l1.5 1.5H14v6.5H2z"/></svg>',
  back: '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg>',
  forward: '<svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg>',
};

const activeTab = () => state.tabs.find((t) => t.id === state.activeTabId);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function faviconOrLetter(url, favicon, cls) {
  if (favicon) {
    const img = new Image();
    img.src = favicon;
    img.onerror = () => img.replaceWith(letterFor(url, cls));
    return img;
  }
  return letterFor(url, cls);
}

function letterFor(url, cls = 'letter') {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {}
  return el('span', cls, host.charAt(0) || '•');
}

// ---------------------------------------------------------------------------
// Layout: tell the main process how much room the browser UI takes (on top,
// and on the side with vertical tabs), where the tabs are, and when a popup
// needs the whole window.

// Three ways to lay out tabs and toolbar, picked in Settings (`tabLayout`):
// classic (tabs above the toolbar), compact (one row: navigation, address,
// tabs, buttons) and vertical (toolbar on top, tabs in a column on the side).
// The same elements move between #tabstrip, #toolbar and #sidebar, keeping
// their listeners.
let tabLayout = 'classic';
document.body.classList.add('layout-classic');
const isVertical = () => tabLayout === 'vertical';
const tabstripParts = [...tabstrip.children]; // tabs, new tab, drag area, private badge
const toolbarParts = [...toolbar.children];
const navParts = toolbarParts.slice(0, toolbarParts.indexOf(addressForm) + 1); // back … address bar
const toolParts = toolbarParts.slice(navParts.length); // shields … menu

function applyLayout() {
  const layout = ['compact', 'vertical'].includes(uiSettings.tabLayout) ? uiSettings.tabLayout : 'classic';
  const collapsed = layout === 'vertical' && !!uiSettings.verticalTabsCollapsed;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const collapseBtn = $('sidebar-collapse');
  collapseBtn.title = collapsed ? 'Expandir abas' : 'Recolher abas';
  collapseBtn.setAttribute('aria-label', collapseBtn.title);
  if (layout !== tabLayout) {
    const typing = document.activeElement === address;
    tabLayout = layout;
    for (const name of ['classic', 'compact', 'vertical']) document.body.classList.toggle(`layout-${name}`, name === layout);
    const [tabs, newTab, dragFill, privateBadge] = tabstripParts;
    if (layout === 'compact') {
      tabstrip.replaceChildren(...navParts, tabs, newTab, dragFill, privateBadge, ...toolParts);
    } else if (layout === 'vertical') {
      tabstrip.replaceChildren(dragFill);
      toolbar.replaceChildren(...navParts, privateBadge, ...toolParts);
      sidebar.prepend(tabs, newTab);
    } else {
      tabstrip.replaceChildren(...tabstripParts);
      toolbar.replaceChildren(...toolbarParts);
    }
    tabstrip.hidden = layout === 'vertical';
    toolbar.hidden = layout === 'compact';
    sidebar.hidden = layout !== 'vertical';
    if (typing) address.focus();
    // The tabs just changed places: no sliding from where they were.
    firstRender = true;
    renderTabs();
  }
  reportLayout();
}

let lastLayout = '';
function reportLayout() {
  const vertical = isVertical();
  const height = Math.ceil(chrome.getBoundingClientRect().height);
  const left = vertical ? Math.ceil(sidebar.getBoundingClientRect().width) : 0;
  const r = (vertical ? sidebar : tabstrip).getBoundingClientRect();
  const strip = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), vertical };
  const key = JSON.stringify([height, left, strip]);
  if (key === lastLayout) return;
  lastLayout = key;
  api.setChrome({ height, left, strip });
}

const layoutObserver = new ResizeObserver(() => reportLayout());
layoutObserver.observe(chrome);
layoutObserver.observe(sidebar);

$('sidebar-collapse').addEventListener('click', () => api.setLayoutSetting('verticalTabsCollapsed', !uiSettings.verticalTabsCollapsed));

let openPopup = null;
let downloadsLinger = null; // timer that hides the downloads button
function showPopup(popup, position) {
  closePopup({ keepFocus: true });
  openPopup = popup;
  api.setChrome({ overlay: true });
  Object.assign(popup.style, position);
  popup.hidden = false;
  scrim.hidden = false;
}

function closePopup({ keepFocus = false } = {}) {
  if (!openPopup) return;
  if (openPopup === suggestionsEl) {
    suggestionItems = [];
    selectedSuggestion = 0;
  }
  const wasDownloads = openPopup === downloadsPanel;
  openPopup.hidden = true;
  openPopup = null;
  scrim.hidden = true;
  if (wasDownloads) {
    clearTimeout(downloadsLinger);
    downloadsLinger = null;
    downloadsBtn.hidden = !downloads.some((d) => d.state === 'progressing');
  }
  api.setChrome({ overlay: false });
  if (!keepFocus && document.activeElement === address) address.blur();
}

scrim.addEventListener('mousedown', () => closePopup());
window.addEventListener('blur', () => {
  if (openPopup && openPopup !== suggestionsEl) closePopup({ keepFocus: true });
});

// ---------------------------------------------------------------------------
// Tabs

function displayUrl(tab) {
  if (!tab) return '';
  if (!tab.internal) return tab.url;
  if (tab.url.startsWith('kitty://error') || tab.url.startsWith('kitty://blocked')) {
    return new URL(tab.url).searchParams.get('url') || '';
  }
  if (tab.url.startsWith('kitty://newtab')) return '';
  return tab.url.replace(/\/$/, '');
}

// ---- Tab animations ------------------------------------------------------
// Sizes animate with CSS transitions; position changes use FLIP: remember where
// every tab was, change the DOM, then slide each one from its old spot.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const liveTabs = () => [...tabsEl.children].filter((node) => !node.classList.contains('closing'));
let firstRender = true;

function animateLayout(change, { except } = {}) {
  if (reduceMotion.matches) return change();
  const before = new Map(liveTabs().map((node) => [node, node.getBoundingClientRect()]));
  change();

  // A tab that changed size *and* moved (pinning) lost its CSS transition when
  // it was re-inserted, so its size is animated here too. Positions are then
  // measured with those tabs held at their old size: the size animation moves
  // the neighbours itself, and the slide only has to cover the rest.
  const resized = [];
  for (const node of liveTabs()) {
    const old = before.get(node);
    if (!old || node === except) continue;
    const width = node.getBoundingClientRect().width;
    if (Math.abs(width - old.width) < 1) continue;
    resized.push([node, old.width, width]);
    node.style.minWidth = node.style.maxWidth = `${old.width}px`;
  }
  const after = new Map(liveTabs().map((node) => [node, node.getBoundingClientRect()]));
  for (const [node] of resized) node.style.minWidth = node.style.maxWidth = '';

  const timing = { duration: 260, easing: EASE };
  for (const node of liveTabs()) {
    if (node === except || !before.has(node)) continue;
    const dx = before.get(node).left - after.get(node).left;
    const dy = before.get(node).top - after.get(node).top;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], timing);
  }
  for (const [node, from, to] of resized) {
    node.animate(
      [
        { minWidth: `${from}px`, maxWidth: `${from}px` },
        { minWidth: `${to}px`, maxWidth: `${to}px` },
      ],
      timing,
    );
  }
}

/** With vertical tabs, a tab row opens and closes in height (pinned ones, in a grid, still in width). */
const growsDown = (node) => isVertical() && !node.classList.contains('pinned');

function animateIn(node) {
  if (reduceMotion.matches) return;
  if (growsDown(node)) {
    const height = node.getBoundingClientRect().height;
    node.animate(
      [
        { height: '0px', minHeight: '0px', opacity: 0 },
        { height: `${height}px`, minHeight: '0px', opacity: 1 },
      ],
      { duration: 220, easing: EASE },
    );
    return;
  }
  const width = node.getBoundingClientRect().width;
  node.animate(
    [
      { maxWidth: '0px', minWidth: '0px', opacity: 0 },
      { maxWidth: `${width}px`, minWidth: '0px', opacity: 1 },
    ],
    { duration: 220, easing: EASE },
  );
}

function animateOut(node) {
  node.classList.add('closing');
  if (reduceMotion.matches) return node.remove();
  if (growsDown(node)) {
    const height = node.getBoundingClientRect().height;
    const animation = node.animate(
      [
        { height: `${height}px`, minHeight: '0px', opacity: 1 },
        { height: '0px', minHeight: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px' },
      ],
      { duration: 200, easing: EASE, fill: 'forwards' },
    );
    animation.onfinish = () => node.remove();
    return;
  }
  const width = node.getBoundingClientRect().width;
  const animation = node.animate(
    [
      { maxWidth: `${width}px`, minWidth: '0px', opacity: 1 },
      { maxWidth: '0px', minWidth: '0px', opacity: 0, paddingLeft: '0px', paddingRight: '0px', marginRight: '0px' },
    ],
    { duration: 200, easing: EASE, fill: 'forwards' },
  );
  animation.onfinish = () => node.remove();
}

function renderTabs() {
  const existing = new Map(liveTabs().map((node) => [Number(node.dataset.id), node]));
  const added = [];
  const pinnedWidth = state.tabs.filter((t) => t.pinned).length * 46;
  const narrow = !isVertical() && state.tabs.filter((t) => !t.pinned).length * 110 > roomForTabs() - pinnedWidth;
  const lastPinned = state.tabs.filter((t) => t.pinned).at(-1)?.id;

  animateLayout(() => {
    state.tabs.forEach((tab, i) => {
      let node = existing.get(tab.id);
      if (!node) {
        node = createTabNode(tab.id);
        added.push(node);
      }
      existing.delete(tab.id);
      const live = liveTabs();
      if (!dragging && live[i] !== node) tabsEl.insertBefore(node, live[i] || null);

      node.classList.toggle('active', tab.id === state.activeTabId);
      node.classList.toggle('narrow', narrow);
      node.classList.toggle('pinned', !!tab.pinned);
      node.classList.toggle('last-pinned', tab.id === lastPinned);
      node.setAttribute('aria-selected', String(tab.id === state.activeTabId));
      node.title = tab.title;
      node.querySelector('.tab-title').textContent = tab.title;

      const audio = node.querySelector('.tab-audio');
      audio.hidden = !tab.audible && !tab.muted;
      audio.innerHTML = tab.muted ? ICONS.muted : ICONS.audio;
      audio.title = tab.muted ? 'Ativar som da aba' : 'Silenciar aba';

      const iconKey = tab.loading ? 'loading' : tab.internal ? 'kitty' : tab.favicon || 'none';
      const icon = node.querySelector('.tab-icon');
      if (icon.dataset.key !== iconKey) {
        icon.dataset.key = iconKey;
        if (tab.loading) icon.innerHTML = '<span class="spinner"></span>';
        else if (tab.internal) icon.innerHTML = ICONS.kitty;
        else if (!tab.favicon) icon.innerHTML = ICONS.globe;
        else {
          const img = new Image();
          img.src = tab.favicon;
          img.onerror = () => (icon.innerHTML = ICONS.globe);
          icon.replaceChildren(img);
        }
      }
    });
  });

  if (!firstRender) added.forEach(animateIn);
  existing.forEach(animateOut);
  firstRender = false;
}

/** How wide the tab strip can get, around the other things in its row. */
function roomForTabs() {
  if (tabLayout !== 'compact') return tabstrip.clientWidth - 220;
  const others = [...tabstrip.children].filter((n) => n !== tabsEl && !n.classList.contains('drag-fill'));
  return tabstrip.clientWidth - others.reduce((sum, n) => sum + n.offsetWidth + 4, 0) - 100;
}

function createTabNode(id) {
  const node = el('div', 'tab');
  node.dataset.id = id;
  node.setAttribute('role', 'tab');
  node.innerHTML = `<span class="tab-icon"></span><span class="tab-title"></span><button class="tab-audio" hidden></button><button class="tab-close" aria-label="Fechar aba">${ICONS.close}</button>`;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    api.switchTab(id);
    startTabDrag(e, node, id);
  });
  node.addEventListener('auxclick', (e) => e.button === 1 && api.closeTab(id));
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.tabMenu(id);
  });
  node.addEventListener('dblclick', (e) => e.stopPropagation());
  node.querySelector('.tab-close').addEventListener('click', () => api.closeTab(id));
  node.querySelector('.tab-audio').addEventListener('click', () => api.muteTab(id));
  return node;
}

// Drag to reorder: the tab follows the pointer, siblings swap as it passes
// their middle, and the final position is sent to the main process. A tab
// stays inside its own group (pinned or not), so it never slides over the
// window controls and lands exactly where it is dropped.
// Pulled away from the strip, the tab leaves the window: the main process
// turns it into a window that follows the pointer (tabdrag.js), and this
// view keeps reporting moves and the drop. Esc puts the tab back.
const DETACH_DISTANCE = 15; // Chromium's kVerticalDetachMagnetism
let dragging = null;
function startTabDrag(down, node, id) {
  const pinned = node.classList.contains('pinned');
  // On the side, tabs go down a column (pinned ones sit in a grid, side by side, unless collapsed).
  const alongY = isVertical() && (!pinned || document.body.classList.contains('sidebar-collapsed'));
  const pos = (e) => (alongY ? e.clientY : e.clientX);
  const startOf = (r) => (alongY ? r.top : r.left);
  const sizeOf = (r) => (alongY ? r.height : r.width);
  const downRect = node.getBoundingClientRect();
  const grab = pos(down) - startOf(downRect);
  const stripEl = isVertical() ? sidebar : tabstrip;
  const group = () => liveTabs().filter((n) => n.classList.contains('pinned') === pinned);
  const startIndex = liveTabs().indexOf(node);
  let started = false;
  let detached = false;
  let minLeft = 0;
  let maxLeft = 0;
  const leftStrip = (e) => {
    const strip = stripEl.getBoundingClientRect();
    return (
      e.clientY > strip.bottom + DETACH_DISTANCE ||
      e.clientY < strip.top - DETACH_DISTANCE ||
      e.clientX < strip.left - DETACH_DISTANCE ||
      e.clientX > strip.right + DETACH_DISTANCE
    );
  };
  const onMove = (e) => {
    if (detached) return api.dragTabMove();
    if (started && leftStrip(e)) {
      detached = true;
      // The tab is about to leave this strip (and its node with it): keep the pointer here.
      document.body.setPointerCapture?.(down.pointerId);
      node.classList.remove('dragging');
      node.style.transform = '';
      dragging = null;
      // Where the pointer will sit in the new window: over the tab, at the start of its strip.
      const tabsRect = tabsEl.getBoundingClientRect();
      api.dragTabOut(
        id,
        isVertical()
          ? { x: down.clientX, y: tabsRect.top + (down.clientY - downRect.top) }
          : { x: tabsRect.left + (down.clientX - downRect.left), y: down.clientY },
      );
      return;
    }
    if (!started) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 5) return;
      started = true;
      dragging = id;
      node.classList.add('dragging');
      node.setPointerCapture?.(down.pointerId);
      // The group's span doesn't change while its tabs are reordered.
      const nodes = group();
      minLeft = startOf(nodes[0].getBoundingClientRect());
      const lastRect = nodes.at(-1).getBoundingClientRect();
      maxLeft = startOf(lastRect) + sizeOf(lastRect) - sizeOf(node.getBoundingClientRect());
    }
    const size = sizeOf(node.getBoundingClientRect());
    const left = Math.min(Math.max(pos(e) - grab, minLeft), Math.max(minLeft, maxLeft));
    const center = left + size / 2;
    // Siblings glide out of the way instead of jumping.
    animateLayout(
      () => {
        for (const sibling of group()) {
          if (sibling === node) continue;
          const r = sibling.getBoundingClientRect();
          const mid = startOf(r) + sizeOf(r) / 2;
          const isAfterNode = node.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_FOLLOWING;
          // Inclusive, so pushing against either end of the group still
          // reaches the first or last slot.
          if (isAfterNode && center >= mid) tabsEl.insertBefore(sibling, node);
          else if (!isAfterNode && center <= mid) tabsEl.insertBefore(node, sibling);
        }
        if (pinned) {
          const last = group().at(-1);
          for (const n of group()) n.classList.toggle('last-pinned', n === last);
        }
      },
      { except: node },
    );
    node.style.transform = '';
    node.style.transform = `translate${alongY ? 'Y' : 'X'}(${left - startOf(node.getBoundingClientRect())}px)`;
  };
  const stop = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key !== 'Escape' || !started) return;
    e.preventDefault();
    e.stopPropagation();
    stop();
    if (detached) return api.cancelTabDrag();
    node.classList.remove('dragging');
    node.style.transform = '';
    dragging = null;
    api.moveTab(id, startIndex);
    renderTabs();
  };
  const onUp = () => {
    stop();
    if (detached) return api.dragTabEnd();
    if (!started) return;
    node.classList.remove('dragging');
    const offset = node.style.transform;
    node.style.transform = '';
    // Settle into the slot instead of snapping.
    if (!reduceMotion.matches && offset) node.animate([{ transform: offset }, { transform: 'none' }], { duration: 180, easing: EASE });
    dragging = null;
    api.moveTab(id, liveTabs().indexOf(node));
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey, true);
}

// ---------------------------------------------------------------------------
// Toolbar

function renderToolbar() {
  const tab = activeTab();
  $('back').disabled = !tab?.canGoBack;
  $('forward').disabled = !tab?.canGoForward;
  reloadBtn.classList.toggle('loading', !!tab?.loading);
  reloadBtn.title = tab?.loading ? 'Parar' : keys('Recarregar (⌘R)');

  if (!editing) address.value = displayUrl(tab);
  address.placeholder = `Pesquise com ${uiSettings.engineName} ou digite um endereço`;
  const kind = !tab || tab.internal ? 'kitty' : tab.url.startsWith('https:') ? 'lock' : tab.url.startsWith('http:') ? 'insecure' : 'search';
  siteIcon.dataset.kind = kind;
  addressForm.dataset.kind = kind;

  const web = tab && /^https?:/.test(tab.url);
  starBtn.hidden = !web;
  starBtn.classList.toggle('on', !!tab?.bookmarked);
  starBtn.title = keys(tab?.bookmarked ? 'Remover dos favoritos (⌘D)' : 'Adicionar aos favoritos (⌘D)');

  const darkable = tab?.darkPages === true || tab?.darkPages === false;
  darkBtn.hidden = !darkable;
  darkBtn.classList.toggle('on', !!tab?.darkPages);
  darkBtn.title = tab?.darkPages
    ? 'Modo escuro ligado neste site. Clique para ver o site como ele é.'
    : 'Modo escuro desligado neste site. Clique para ligar.';

  const shieldable = tab && !tab.internal;
  shieldBtn.disabled = !shieldable;
  shieldBtn.classList.toggle('down', !!shieldable && !tab.shieldUp);
  shieldCount.textContent = shieldable && tab.shieldUp && tab.blocked > 0 ? String(tab.blocked) : '';
  shieldBtn.title = !shieldable
    ? 'Escudos do Kitty'
    : tab.shieldUp
      ? `Escudos ativos — ${tab.blocked} anúncio(s) e rastreador(es) bloqueado(s). Clique para desativar neste site.`
      : 'Escudos desativados neste site. Clique para reativar.';

  renderPermission(tab);
  renderPasswordOffer(tab);
}

addressForm.addEventListener('submit', (e) => {
  e.preventDefault();
  // A highlighted suggestion only counts while the dropdown is open.
  const selected = openPopup === suggestionsEl && selectedSuggestion > 0 ? suggestionItems[selectedSuggestion] : null;
  go(selected ? suggestionTarget(selected) : address.value);
});

function go(input) {
  editing = false;
  closePopup({ keepFocus: true });
  api.navigate(input);
  address.blur();
}

address.addEventListener('focus', () => {
  editing = true;
  requestAnimationFrame(() => address.select());
});
address.addEventListener('blur', () => {
  editing = false;
  if (openPopup === suggestionsEl) closePopup({ keepFocus: true });
  renderToolbar();
});
address.addEventListener('input', () => requestSuggestions());
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (openPopup === suggestionsEl) {
      address.value = typedText;
      closePopup({ keepFocus: true });
    } else {
      editing = false;
      renderToolbar();
      address.select();
    }
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (openPopup !== suggestionsEl) return;
    e.preventDefault();
    moveSuggestion(e.key === 'ArrowDown' ? 1 : -1);
  }
});

$('new-tab').addEventListener('click', () => api.newTab());
$('back').addEventListener('click', () => api.back());
$('forward').addEventListener('click', () => api.forward());
reloadBtn.addEventListener('click', () => (reloadBtn.classList.contains('loading') ? api.stop() : api.reload()));
starBtn.addEventListener('click', () => api.toggleBookmark());
shieldBtn.addEventListener('click', () => api.toggleShield());
darkBtn.addEventListener('click', () => api.toggleDarkPages());
// Double click on empty space in the tab strip (or the side column) opens a tab.
for (const strip of [tabstrip, sidebar]) {
  strip.addEventListener('dblclick', (e) => {
    if (e.target === strip || e.target === tabsEl || e.target.matches('.drag-fill, #sidebar-fill')) api.newTab();
  });
}

// ---------------------------------------------------------------------------
// Address bar suggestions

let typedText = '';
let suggestionItems = [];
let selectedSuggestion = 0;
let suggestTimer = null;

function looksLikeUrl(text) {
  return /^(https?|kitty|file|view-source):/i.test(text) || (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) || /^localhost/.test(text);
}

function requestSuggestions() {
  typedText = address.value;
  clearTimeout(suggestTimer);
  const text = typedText.trim();
  if (!text) return closePopup({ keepFocus: true });
  renderSuggestions([], text); // show "what you typed" right away
  suggestTimer = setTimeout(async () => {
    const result = await api.suggest(text);
    // Drop stale answers: the user kept typing or already left the address bar.
    if (result.query === address.value.trim() && openPopup === suggestionsEl) renderSuggestions(result.items, text);
  }, 70);
}

function suggestionTarget(item) {
  return item.type === 'search' ? item.text : item.url;
}

function renderSuggestions(items, text) {
  const first = looksLikeUrl(text) ? { type: 'url', url: text } : { type: 'search', text, typed: true };
  suggestionItems = [first, ...items.filter((i) => suggestionTarget(i) !== text)];
  selectedSuggestion = 0;
  suggestionsEl.replaceChildren(
    ...suggestionItems.map((item, i) => {
      const row = el('div', 'suggestion');
      row.setAttribute('role', 'option');
      let icon = ICONS.search;
      let main = item.text;
      let sub = item.typed ? `Pesquisar no ${uiSettings.engineName}` : '';
      if (item.type === 'url') {
        icon = ICONS.globe;
        main = item.url;
        sub = 'Abrir endereço';
      } else if (item.type === 'history' || item.type === 'bookmark') {
        icon = item.type === 'bookmark' ? ICONS.star : ICONS.history;
        main = item.title || item.url;
        sub = item.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      }
      row.innerHTML = icon;
      row.append(el('span', 'main', main), el('span', 'sub', sub));
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        go(suggestionTarget(item));
      });
      row.addEventListener('mousemove', () => selectSuggestion(i, { fill: false }));
      return row;
    }),
  );
  selectSuggestion(0, { fill: false });
  if (openPopup !== suggestionsEl) {
    const r = addressForm.getBoundingClientRect();
    // In the compact layout the address bar is narrow: the list gets some more room.
    const width = Math.min(Math.max(r.width, 460), window.innerWidth - r.left - 8);
    showPopup(suggestionsEl, { left: `${r.left}px`, top: `${r.bottom + 6}px`, width: `${width}px` });
  }
}

function selectSuggestion(i, { fill = true } = {}) {
  selectedSuggestion = i;
  [...suggestionsEl.children].forEach((row, j) => row.classList.toggle('selected', j === i));
  if (fill) address.value = i === 0 ? typedText : suggestionTarget(suggestionItems[i]);
}

function moveSuggestion(delta) {
  const n = suggestionItems.length;
  if (n) selectSuggestion((selectedSuggestion + delta + n) % n);
}

// ---------------------------------------------------------------------------
// Bookmarks bar
//
// Bookmarks and folders come in one list, in order (see main/bookmarks.js):
// `folder` is the path of folder names an item lives in, folders have
// `type: 'folder'`. Imported ones that weren't on the other browser's bar
// (`bar: false`) only show in kitty://bookmarks.

const folderPanel = $('folder-panel');
const bookmarkDialog = $('bookmark-dialog');

const isFolderItem = (b) => b.type === 'folder';
const pathOf = (b) => (Array.isArray(b.folder) ? b.folder : []);
const findBookmark = (id) => bookmarks.find((b) => b.id === id);

/** What's directly inside a folder item, or on the bar itself for null. */
function childrenOf(folder) {
  const path = folder ? [...pathOf(folder), folder.title] : [];
  const bar = folder ? folder.bar !== false : true;
  return bookmarks.filter((b) => {
    const p = pathOf(b);
    return (b.bar !== false) === bar && p.length === path.length && path.every((name, i) => p[i] === name);
  });
}

function bookmarkButton(b) {
  const button = el('button', 'bookmark');
  button.dataset.id = b.id;
  button.draggable = true;
  button.title = `${b.title}\n${b.url}`;
  button.append(faviconOrLetter(b.url, b.favicon), el('span', '', b.title || b.url));
  button.addEventListener('click', (e) => api.openBookmark({ id: b.id, newTab: e.metaKey || e.ctrlKey }));
  button.addEventListener('auxclick', (e) => e.button === 1 && api.openBookmark({ id: b.id, newTab: true }));
  return button;
}

/** A folder on the bar: opens its contents in a panel right below it. */
function folderButton(f) {
  const button = el('button', 'bookmark folder');
  button.dataset.id = f.id;
  button.draggable = true;
  button.title = f.title;
  const icon = el('span', 'icon');
  icon.innerHTML = ICONS.folder;
  button.append(icon, el('span', '', f.title));
  button.addEventListener('click', () => openFolder(f, button));
  return button;
}

function renderBookmarks() {
  const top = childrenOf(null);
  const mode = uiSettings.bookmarksBar;
  const onNewTab = !!activeTab()?.url?.startsWith('kitty://newtab');
  bookmarksBar.hidden = top.length === 0 || mode === 'never' || (mode === 'newtab' && !onNewTab);
  bookmarksBar.replaceChildren(...top.map((b) => (isFolderItem(b) ? folderButton(b) : bookmarkButton(b))));
  if (openPopup === folderPanel) renderFolderPanel();
}

// Right click: on a bookmark or folder, or on empty space (to add one).
bookmarksBar.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.bookmarkMenu({ id: e.target.closest('[data-id]')?.dataset.id ?? null });
});

// ---- Folder panel: the folder's contents; subfolders open in the same panel.

let folderTrail = []; // ids of the folders opened, the shown one last

function openFolder(f, anchor) {
  folderTrail = [f.id];
  renderFolderPanel();
  const r = anchor.getBoundingClientRect();
  showPopup(folderPanel, { left: `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`, top: `${r.bottom + 4}px` });
}

function renderFolderPanel() {
  const folder = findBookmark(folderTrail.at(-1));
  if (!folder) return closePopup();
  const rows = [];
  if (folderTrail.length > 1) {
    const back = el('button', 'folder-row back');
    back.innerHTML = ICONS.back;
    back.append(el('span', 'name', findBookmark(folderTrail.at(-2))?.title ?? ''));
    back.addEventListener('click', () => {
      folderTrail.pop();
      renderFolderPanel();
    });
    rows.push(back);
  }
  const kids = childrenOf(folder);
  for (const b of kids) {
    const row = el('button', 'folder-row');
    row.dataset.id = b.id;
    row.draggable = true;
    if (isFolderItem(b)) {
      const icon = el('span', 'icon');
      icon.innerHTML = ICONS.folder;
      row.append(icon, el('span', 'name', b.title));
      const more = el('span', 'more');
      more.innerHTML = ICONS.forward;
      row.append(more);
      row.addEventListener('click', () => {
        folderTrail.push(b.id);
        renderFolderPanel();
      });
    } else {
      row.title = b.url;
      row.append(faviconOrLetter(b.url, b.favicon), el('span', 'name', b.title || b.url));
      row.addEventListener('click', (e) => {
        closePopup();
        api.openBookmark({ id: b.id, newTab: e.metaKey || e.ctrlKey });
      });
      row.addEventListener('auxclick', (e) => e.button === 1 && api.openBookmark({ id: b.id, newTab: true }));
    }
    rows.push(row);
  }
  if (!kids.length) rows.push(el('div', 'folder-empty', 'Pasta vazia'));
  folderPanel.replaceChildren(...rows);
}

folderPanel.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const id = e.target.closest('[data-id]')?.dataset.id ?? null;
  api.bookmarkMenu({ id, parentId: folderTrail.at(-1) });
});

// ---- Drag and drop: reorder on the bar and in folders, drop on a folder to put it inside.

let draggedId = null;

function clearDropMarks() {
  for (const node of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) {
    node.classList.remove('drop-before', 'drop-after', 'drop-into');
  }
}

/** Where a drop at the pointer would put the dragged item, inside `container`. */
function dropSpot(e, container, parentId) {
  const target = e.target.closest('[data-id]');
  if (!target || !container.contains(target)) return { parentId, beforeId: null, node: null };
  const vertical = container === folderPanel;
  const r = target.getBoundingClientRect();
  const pos = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  const item = findBookmark(target.dataset.id);
  if (item && isFolderItem(item) && item.id !== draggedId && pos > 0.25 && pos < 0.75) {
    return { parentId: item.id, beforeId: null, node: target, mark: 'drop-into' };
  }
  if (pos < 0.5) return { parentId, beforeId: target.dataset.id, node: target, mark: 'drop-before' };
  let next = target.nextElementSibling;
  while (next && !next.dataset.id) next = next.nextElementSibling;
  return { parentId, beforeId: next?.dataset.id ?? null, node: target, mark: 'drop-after' };
}

function acceptDrops(container, parentIdOf) {
  container.addEventListener('dragover', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const spot = dropSpot(e, container, parentIdOf());
    clearDropMarks();
    if (spot.node && spot.node.dataset.id !== draggedId) spot.node.classList.add(spot.mark);
  });
  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) clearDropMarks();
  });
  container.addEventListener('drop', async (e) => {
    if (!draggedId) return;
    e.preventDefault();
    const id = draggedId;
    const spot = dropSpot(e, container, parentIdOf());
    clearDropMarks();
    if (spot.node?.dataset.id === id) return;
    await api.bookmarkOp({ op: 'move', id, parentId: spot.parentId, beforeId: spot.beforeId });
    // Dropped from a folder onto the bar: the folder's panel is in the way now.
    if (container === bookmarksBar && openPopup === folderPanel) closePopup();
  });
}

for (const container of [bookmarksBar, folderPanel]) {
  container.addEventListener('dragstart', (e) => {
    const node = e.target.closest('[data-id]');
    if (!node) return;
    draggedId = node.dataset.id;
    const b = findBookmark(draggedId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', b?.url || b?.title || '');
    // Lets a bookmark leave its folder's panel for the bar.
    document.body.classList.add('dragging-bookmark');
  });
  container.addEventListener('dragend', () => {
    draggedId = null;
    clearDropMarks();
    document.body.classList.remove('dragging-bookmark');
  });
}
acceptDrops(bookmarksBar, () => null);
acceptDrops(folderPanel, () => folderTrail.at(-1));

// ---- Dialog to add or edit a bookmark or folder (opened from the right-click menu).

const DIALOG_TITLES = { edit: 'Editar favorito', add: 'Adicionar página', folder: 'Nova pasta', rename: 'Renomear pasta' };
let dialogState = null;

api.onBookmarkDialog((d) => {
  dialogState = d;
  const withUrl = d.mode === 'edit' || d.mode === 'add';
  $('bd-heading').textContent = DIALOG_TITLES[d.mode] ?? 'Favorito';
  $('bd-name').value = d.title || (d.mode === 'folder' ? 'Nova pasta' : '');
  $('bd-url').value = d.url || '';
  $('bd-url-row').hidden = !withUrl;
  $('bd-error').hidden = true;
  const top = chrome.getBoundingClientRect().bottom;
  showPopup(bookmarkDialog, { left: `${Math.max(8, (window.innerWidth - 380) / 2)}px`, top: `${top + 8}px` });
  $('bd-name').focus();
  $('bd-name').select();
});

bookmarkDialog.addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = dialogState;
  if (!d) return;
  const title = $('bd-name').value;
  const url = $('bd-url').value;
  const op = {
    edit: { op: 'update', id: d.id, title, url },
    rename: { op: 'update', id: d.id, title },
    add: { op: 'add', title, url, parentId: d.parentId ?? null },
    folder: { op: 'addFolder', title, parentId: d.parentId ?? null },
  }[d.mode];
  const result = op && (await api.bookmarkOp(op));
  if (result?.error) {
    $('bd-error').textContent = result.error;
    $('bd-error').hidden = false;
    return;
  }
  closePopup();
});
$('bd-cancel').addEventListener('click', () => closePopup());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (openPopup === bookmarkDialog || openPopup === folderPanel)) closePopup();
});

// ---------------------------------------------------------------------------
// Permission prompts

function renderPermission(tab) {
  const prompt = tab?.prompt;
  permBar.hidden = !prompt;
  if (!prompt) return;
  const host = prompt.origin.replace(/^https?:\/\//, '');
  const text = $('perm-text');
  text.replaceChildren(el('strong', '', host), document.createTextNode(` quer ${prompt.label}.`));
  permBar.dataset.tabId = tab.id;
  permBar.dataset.promptId = prompt.id;
}

for (const [id, allow] of [['perm-allow', true], ['perm-deny', false]]) {
  $(id).addEventListener('click', () =>
    api.answerPermission({ tabId: Number(permBar.dataset.tabId), promptId: permBar.dataset.promptId, allow }),
  );
}

// ---------------------------------------------------------------------------
// "Save password?" bar, after a login (passwords.js)

const pwBar = $('pw-bar');

function renderPasswordOffer(tab) {
  const offer = tab?.passwordOffer;
  pwBar.hidden = !offer;
  if (!offer) return;
  const host = offer.origin.replace(/^https?:\/\//, '');
  const text = [document.createTextNode(offer.update ? 'Atualizar a senha salva' : 'Salvar a senha')];
  if (offer.username) text.push(document.createTextNode(' de '), el('strong', '', offer.username));
  text.push(document.createTextNode(' em '), el('strong', '', host), document.createTextNode('?'));
  $('pw-text').replaceChildren(...text);
  $('pw-save').textContent = offer.update ? 'Atualizar' : 'Salvar';
  pwBar.dataset.tabId = tab.id;
  pwBar.dataset.offerId = offer.id;
}

for (const [id, answer] of [['pw-save', 'save'], ['pw-never', 'never'], ['pw-dismiss', 'dismiss']]) {
  $(id).addEventListener('click', () =>
    api.answerPassword({ tabId: Number(pwBar.dataset.tabId), offerId: pwBar.dataset.offerId, answer }),
  );
}

// ---------------------------------------------------------------------------
// Find in page

function openFind() {
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) api.find({ text: findInput.value });
}

function closeFind() {
  if (findBar.hidden) return;
  findBar.hidden = true;
  findCount.textContent = '';
  findInput.classList.remove('none');
  api.stopFind();
}

function stepFind(direction) {
  if (findBar.hidden) return openFind();
  if (findInput.value) api.find({ text: findInput.value, forward: direction > 0, next: true });
}

findInput.addEventListener('input', () => api.find({ text: findInput.value }));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') stepFind(e.shiftKey ? -1 : 1);
  if (e.key === 'Escape') closeFind();
});
$('find-next').addEventListener('click', () => stepFind(1));
$('find-prev').addEventListener('click', () => stepFind(-1));
$('find-close').addEventListener('click', closeFind);

api.onFindOpen(openFind);
api.onFindClose(() => {
  findBar.hidden = true;
  findCount.textContent = '';
});
api.onFindStep(stepFind);
api.onFindResult(({ active, matches }) => {
  findCount.textContent = findInput.value ? (matches ? `${active} de ${matches}` : 'Nenhum resultado') : '';
  findInput.classList.toggle('none', !!findInput.value && matches === 0);
});

// ---------------------------------------------------------------------------
// Downloads

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

function downloadStatus(d) {
  switch (d.state) {
    case 'progressing': {
      if (d.paused) return `Pausado · ${formatBytes(d.received)}${d.total ? ` de ${formatBytes(d.total)}` : ''}`;
      const elapsed = (Date.now() - d.startTime) / 1000;
      const speed = elapsed > 0.5 ? d.received / elapsed : 0;
      const of = d.total ? ` de ${formatBytes(d.total)}` : '';
      return `${formatBytes(d.received)}${of}${speed ? ` · ${formatBytes(speed)}/s` : ''}`;
    }
    case 'completed':
      return `Concluído · ${formatBytes(d.received || d.total)}`;
    case 'cancelled':
      return 'Cancelado';
    case 'removed':
      return 'Arquivo removido';
    default:
      return 'Falhou';
  }
}

// The toolbar button only shows while something is downloading, for a while
// after the last download ends, and while its panel is open.
const DOWNLOADS_LINGER_MS = 30000;

function updateDownloadsBtn() {
  const busy = downloads.some((d) => d.state === 'progressing');
  if (busy) {
    clearTimeout(downloadsLinger);
    downloadsLinger = null;
  } else if (!downloadsBtn.hidden && !downloadsLinger && openPopup !== downloadsPanel) {
    downloadsLinger = setTimeout(() => {
      downloadsLinger = null;
      if (openPopup !== downloadsPanel) downloadsBtn.hidden = true;
    }, DOWNLOADS_LINGER_MS);
  }
  downloadsBtn.hidden = !busy && !downloadsLinger && openPopup !== downloadsPanel;
}

function renderDownloads() {
  updateDownloadsBtn();
  const active = downloads.filter((d) => d.state === 'progressing');
  const total = active.reduce((s, d) => s + (d.total || 0), 0);
  const received = active.reduce((s, d) => s + d.received, 0);
  downloadsBtn.classList.toggle('active', active.length > 0);
  downloadsBtn.style.setProperty('--progress', total ? String(received / total) : '0.1');

  const list = $('downloads-list');
  if (!downloads.length) return list.replaceChildren(el('div', 'empty', 'Nenhum download por aqui.'));
  list.replaceChildren(
    ...downloads.map((d) => {
      const row = el('div', 'download');
      const done = d.state === 'completed';
      row.classList.toggle('done', done);
      row.classList.toggle('failed', d.state === 'interrupted');
      const ext = (d.filename.split('.').pop() || '').slice(0, 4);
      const info = el('div', 'info');
      const name = el('div', 'name', d.filename);
      if (done) name.addEventListener('click', () => api.downloadAction({ id: d.id, what: 'open' }));
      info.append(name, el('div', 'status', downloadStatus(d)));
      if (d.state === 'progressing' && d.total) {
        const bar = el('div', 'bar');
        const fill = el('div');
        fill.style.width = `${Math.round((d.received / d.total) * 100)}%`;
        bar.append(fill);
        info.append(bar);
      }
      const actions = [];
      const action = (icon, title, what) => {
        const b = el('button', 'icon-btn small');
        b.innerHTML = icon;
        b.title = title;
        b.addEventListener('click', () => api.downloadAction({ id: d.id, what }));
        actions.push(b);
      };
      if (d.state === 'progressing') {
        if (d.paused) action(ICONS.play, 'Continuar', 'resume');
        else action(ICONS.pause, 'Pausar', 'pause');
        action(ICONS.close, 'Cancelar', 'cancel');
      } else {
        if (done) action(ICONS.folder, isMac ? 'Mostrar no Finder' : 'Mostrar na pasta', 'show');
        action(ICONS.close, 'Remover da lista', 'remove');
      }
      row.append(el('div', 'file-icon', ext), info, ...actions);
      return row;
    }),
  );
}

function toggleDownloads() {
  if (openPopup === downloadsPanel) return closePopup();
  downloadsBtn.hidden = false;
  const r = downloadsBtn.getBoundingClientRect();
  showPopup(downloadsPanel, { top: `${r.bottom + 6}px`, right: `${Math.max(8, window.innerWidth - r.right)}px` });
}

downloadsBtn.addEventListener('click', toggleDownloads);
$('downloads-clear').addEventListener('click', () => api.clearDownloads());
api.onToggleDownloads(toggleDownloads);
api.onDownloadStarted(() => {
  downloadsBtn.hidden = false;
  updateDownloadsBtn();
  downloadsBtn.classList.remove('bump');
  void downloadsBtn.offsetWidth;
  downloadsBtn.classList.add('bump');
});
setInterval(() => {
  if (openPopup === downloadsPanel && downloads.some((d) => d.state === 'progressing')) renderDownloads();
}, 1000);

// ---------------------------------------------------------------------------
// Menu

$('menu-btn').addEventListener('click', () => {
  if (openPopup === menuPanel) return closePopup();
  const r = $('menu-btn').getBoundingClientRect();
  showPopup(menuPanel, { top: `${r.bottom + 6}px`, right: `${Math.max(8, window.innerWidth - r.right)}px` });
});
menuPanel.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (!action) return;
  closePopup();
  if (action === 'new-tab') api.newTab();
  if (action === 'private') api.newPrivateWindow();
  if (action === 'new-window') api.newWindow();
  if (['history', 'bookmarks', 'settings', 'passwords', 'extensions'].includes(action)) api.openInternal(action);
  if (action === 'downloads') toggleDownloads();
  if (action === 'find') openFind();
});

// ---------------------------------------------------------------------------
// Messages from the main process

api.onState((next) => {
  state = next;
  renderTabs();
  renderToolbar();
  renderBookmarks();
});
api.onBookmarks((items) => {
  bookmarks = items;
  renderBookmarks();
});
api.onDownloads((items) => {
  downloads = items;
  renderDownloads();
});
api.onSettings((next) => {
  uiSettings = next;
  applyLayout();
  renderBookmarks();
  renderToolbar();
});
api.onFullscreen((on) => document.body.classList.toggle('fullscreen', on));
api.onFocusAddress(() => {
  closePopup({ keepFocus: true });
  address.focus();
  address.select();
});

const updateBtn = $('update-btn');
api.onUpdate((update) => {
  updateBtn.hidden = update.status !== 'ready';
  updateBtn.title = `Kitty ${update.available} foi baixado. Clique para reiniciar e atualizar — suas abas voltam abertas.`;
});
updateBtn.addEventListener('click', () => api.installUpdate());

window.addEventListener('resize', renderTabs);
// The window opens straight in the chosen layout (main passes it along), before the settings arrive.
{
  const query = new URLSearchParams(location.search);
  uiSettings.tabLayout = query.get('layout') || 'classic';
  uiSettings.verticalTabsCollapsed = query.get('collapsed') === '1';
  applyLayout();
}

api.ready();
