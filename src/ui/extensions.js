'use strict';

// Chrome extensions in the toolbar: the puzzle button (next to the shield)
// lists them, each can be pinned to the toolbar as its own button, with the
// badge the extension sets. Clicking one opens its popup (a small window the
// main process places under the button). Uses showPopup/closePopup/openPopup
// and the helpers from ui.js. Private windows have no extensions.

const extBtn = $('ext-btn');
const extPinned = $('ext-pinned');
const extPanel = $('ext-panel');
const extList = $('ext-list');

const PIN_ICON = '<svg viewBox="0 0 16 16"><path d="M6 2.5h4M7 2.5v4l-2.5 2.5h7L9 6.5v-4M8 9v4.5" /></svg>';

let extensionsState = null; // null in private windows
let openExtPopup = null; // id of the extension whose popup is open

const rectOf = (node) => {
  const r = node.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
};

/** Where an extension's popup hangs from: its pinned button, or the puzzle. */
function anchorFor(id) {
  const pinned = extPinned.querySelector(`[data-id="${id}"]`);
  return rectOf(pinned && pinned.offsetParent ? pinned : extBtn);
}

function runExtension(id) {
  closePopup({ keepFocus: true });
  api.extClick({ id, rect: anchorFor(id) });
}

function extIcon(ext) {
  if (ext.icon) {
    const img = document.createElement('img');
    img.src = ext.icon;
    img.alt = '';
    img.draggable = false;
    return img;
  }
  return el('span', 'letter', ext.name.charAt(0) || '•');
}

function badge(ext) {
  if (!ext.badgeText) return null;
  const b = el('span', 'ext-badge', ext.badgeText.slice(0, 4));
  b.style.background = ext.badgeBackground;
  b.style.color = ext.badgeColor;
  return b;
}

function renderPinned() {
  const list = extensionsState || [];
  extBtn.hidden = !extensionsState;
  const byId = new Map(list.map((e) => [e.id, e]));
  const pinned = list.filter((e) => e.pinned);
  extPinned.replaceChildren(
    ...pinned.map((ext) => {
      const b = el('button', 'icon-btn ext-action');
      b.dataset.id = ext.id;
      b.title = ext.title || ext.name;
      b.setAttribute('aria-label', ext.title || ext.name);
      b.classList.toggle('inactive', !ext.enabled);
      b.classList.toggle('open', openExtPopup === ext.id);
      b.append(extIcon(ext));
      const bd = badge(ext);
      if (bd) b.append(bd);
      b.addEventListener('click', () => runExtension(ext.id));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        api.extMenu(ext.id);
      });
      return b;
    }),
  );
  extBtn.classList.toggle('open', !!openExtPopup && !byId.get(openExtPopup)?.pinned);
  if (openPopup === extPanel) renderExtPanel();
}

function renderExtPanel(highlight = null) {
  const list = extensionsState || [];
  if (!list.length) {
    const empty = el('div', 'ext-empty');
    empty.append(el('p', null, 'Nenhuma extensão instalada.'), el('p', 'ext-hint', 'Extensões do Chrome, como o Bitwarden, se instalam pela Chrome Web Store.'));
    extList.replaceChildren(empty);
    return;
  }
  extList.replaceChildren(
    ...list.map((ext) => {
      const row = el('div', 'ext-row');
      row.classList.toggle('highlight', ext.id === highlight);
      const main = el('button', 'ext-main');
      main.title = ext.title || ext.name;
      const icon = el('span', 'ext-icon');
      icon.append(extIcon(ext));
      const bd = badge(ext);
      if (bd) icon.append(bd);
      main.append(icon, el('span', 'ext-name', ext.name));
      main.addEventListener('click', () => runExtension(ext.id));
      main.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        api.extMenu(ext.id);
      });
      const pin = el('button', 'icon-btn small ext-pin');
      pin.innerHTML = PIN_ICON;
      pin.classList.toggle('on', ext.pinned);
      pin.title = ext.pinned ? 'Desafixar da barra' : 'Fixar na barra';
      pin.setAttribute('aria-label', pin.title);
      pin.addEventListener('click', () => api.extPin({ id: ext.id, pinned: !ext.pinned }));
      row.append(main, pin);
      return row;
    }),
  );
}

function toggleExtPanel(highlight = null) {
  if (openPopup === extPanel && !highlight) return closePopup();
  renderExtPanel(highlight);
  const r = extBtn.getBoundingClientRect();
  showPopup(extPanel, { top: `${r.bottom + 6}px`, right: `${Math.max(8, window.innerWidth - r.right)}px` });
}

extBtn.addEventListener('click', () => toggleExtPanel());
$('ext-store').addEventListener('click', () => {
  closePopup();
  api.extStore();
});
$('ext-manage').addEventListener('click', () => {
  closePopup();
  api.extManage();
});

api.onExtensions((list) => {
  extensionsState = list;
  renderPinned();
});
// Just installed from the Web Store: show where it is, and that it can be pinned.
api.onExtInstalled((id) => {
  if (extensionsState) toggleExtPanel(id);
});
// chrome.action.openPopup(): the main process needs to know where the button is.
api.onExtOpenPopup((id) => api.extClick({ id, rect: anchorFor(id) }));
api.onExtPopup((id) => {
  openExtPopup = id;
  renderPinned();
});

api.extReady();
