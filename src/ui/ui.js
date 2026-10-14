'use strict';

const api = window.kittyUI;
const $ = (id) => document.getElementById(id);

const tabsEl = $('tabs');
const address = $('address');
const siteIcon = $('site-icon');
const reloadBtn = $('reload');
const shieldBtn = $('shield');
const shieldCount = $('shield-count');

document.body.classList.add(api.platform === 'darwin' ? 'mac' : api.platform === 'win32' ? 'win' : 'linux');

let state = { activeTabId: null, tabs: [] };
let editing = false; // true while the user is typing in the address bar

const KITTY_ICON = '<svg class="kitty" viewBox="0 0 24 24"><path d="M4 3l4 4.5h8L20 3v9a8 8 0 0 1-16 0z"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

function displayUrl(tab) {
  if (!tab || tab.internal) {
    if (!tab) return '';
    if (tab.url.startsWith('kitty://history')) return 'kitty://history';
    if (tab.url.startsWith('kitty://error')) return new URL(tab.url).searchParams.get('url') || '';
    return '';
  }
  return tab.url;
}

function renderTabs() {
  const existing = new Map([...tabsEl.children].map((el) => [Number(el.dataset.id), el]));
  const narrow = state.tabs.length * 120 > tabsEl.parentElement.clientWidth - 160;

  state.tabs.forEach((tab, i) => {
    let el = existing.get(tab.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tab';
      el.dataset.id = tab.id;
      el.setAttribute('role', 'tab');
      el.innerHTML = `<span class="tab-icon"></span><span class="tab-title"></span><button class="tab-close" aria-label="Fechar aba">${CLOSE_ICON}</button>`;
      el.addEventListener('mousedown', (e) => {
        if (e.button === 1) return; // middle click handled on auxclick
        if (!e.target.closest('.tab-close')) api.switchTab(tab.id);
      });
      el.addEventListener('auxclick', (e) => e.button === 1 && api.closeTab(tab.id));
      el.querySelector('.tab-close').addEventListener('click', () => api.closeTab(tab.id));
    }
    existing.delete(tab.id);
    if (tabsEl.children[i] !== el) tabsEl.insertBefore(el, tabsEl.children[i] || null);

    el.classList.toggle('active', tab.id === state.activeTabId);
    el.classList.toggle('narrow', narrow);
    el.setAttribute('aria-selected', String(tab.id === state.activeTabId));
    el.title = tab.title;
    el.querySelector('.tab-title').textContent = tab.title;

    const iconKey = tab.loading ? 'loading' : tab.internal ? 'kitty' : tab.favicon || 'none';
    const icon = el.querySelector('.tab-icon');
    if (icon.dataset.key !== iconKey) {
      icon.dataset.key = iconKey;
      if (tab.loading) icon.innerHTML = '<span class="spinner"></span>';
      else if (tab.internal || !tab.favicon) icon.innerHTML = KITTY_ICON;
      else {
        const img = new Image();
        img.src = tab.favicon;
        img.onerror = () => (icon.innerHTML = KITTY_ICON);
        icon.replaceChildren(img);
      }
    }
  });

  existing.forEach((el) => el.remove());
}

function renderToolbar() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  $('back').disabled = !tab?.canGoBack;
  $('forward').disabled = !tab?.canGoForward;
  reloadBtn.classList.toggle('loading', !!tab?.loading);
  reloadBtn.title = tab?.loading ? 'Parar' : 'Recarregar';

  if (!editing) address.value = displayUrl(tab);
  siteIcon.dataset.kind = !tab || tab.internal ? 'kitty' : tab.url.startsWith('https:') ? 'lock' : 'search';

  const shieldable = tab && !tab.internal;
  shieldBtn.disabled = !shieldable;
  shieldBtn.classList.toggle('down', !!shieldable && !tab.shieldUp);
  shieldCount.textContent = shieldable && tab.shieldUp && tab.blocked > 0 ? String(tab.blocked) : '';
  shieldBtn.title = !shieldable
    ? 'Escudos do Kitty'
    : tab.shieldUp
      ? `Escudos ativos — ${tab.blocked} anúncio(s) e rastreador(es) bloqueado(s). Clique para desativar neste site.`
      : 'Escudos desativados neste site. Clique para reativar.';
}

api.onState((next) => {
  state = next;
  renderTabs();
  renderToolbar();
});

api.onFocusAddress(() => {
  address.focus();
  address.select();
});

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  editing = false;
  api.navigate(address.value);
  address.blur();
});
address.addEventListener('focus', () => {
  editing = true;
  requestAnimationFrame(() => address.select());
});
address.addEventListener('blur', () => {
  editing = false;
  renderToolbar();
});
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    editing = false;
    renderToolbar();
    address.select();
  }
});

$('new-tab').addEventListener('click', () => api.newTab());
$('back').addEventListener('click', () => api.back());
$('forward').addEventListener('click', () => api.forward());
reloadBtn.addEventListener('click', () => (reloadBtn.classList.contains('loading') ? api.stop() : api.reload()));
shieldBtn.addEventListener('click', () => api.toggleShield());
$('history').addEventListener('click', () => api.openHistory());
window.addEventListener('resize', renderTabs);

api.ready();
