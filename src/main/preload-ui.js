'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);
const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

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

contextBridge.exposeInMainWorld('kittyUI', {
  isPrivate: new URLSearchParams(location.search).get('private') === '1',
  platform: process.platform,
  lang: i18n.lang,
  t,
  translate: () => translate(document), // DOM nodes can't cross the bridge

  ready: send('ui:ready'),
  setChrome: send('ui:chrome'),
  setLayoutSetting: send('ui:layout-setting'),
  newTab: send('tab:new'),
  closeTab: send('tab:close'),
  switchTab: send('tab:switch'),
  moveTab: send('tab:move'),
  dragTabOut: send('tab:drag-out'),
  dragTabMove: send('tab:drag-move'),
  dragTabEnd: send('tab:drag-end'),
  cancelTabDrag: send('tab:drag-cancel'),
  tabMenu: send('tab:menu'),
  muteTab: send('tab:mute'),
  navigate: send('nav:go'),
  back: send('nav:back'),
  forward: send('nav:forward'),
  reload: send('nav:reload'),
  stop: send('nav:stop'),
  toggleShield: send('shield:toggle'),
  openInternal: send('open:internal'),
  newPrivateWindow: send('window:private'),
  newWindow: send('window:new'),
  find: send('find:query'),
  stopFind: send('find:stop'),
  answerPermission: send('perm:answer'),
  answerPassword: send('pw:answer'),
  toggleBookmark: send('bookmark:toggle'),
  openBookmark: send('bookmark:open'),
  bookmarkMenu: send('bookmark:menu'),
  bookmarkOp: (op) => ipcRenderer.invoke('ui:bookmark-op', op),
  downloadAction: send('downloads:action'),
  clearDownloads: send('downloads:clear'),
  installUpdate: send('update:install'),
  suggest: (text) => ipcRenderer.invoke('ui:suggest', text),
  siteInfo: () => ipcRenderer.invoke('ui:site-info'),
  siteAction: (action) => ipcRenderer.invoke('ui:site-action', action),

  extReady: send('ext:ui-ready'),
  extClick: send('ext:ui-click'),
  extMenu: send('ext:ui-menu'),
  extPin: send('ext:ui-pin'),
  extManage: send('ext:ui-manage'),
  extStore: send('ext:ui-store'),
  onExtensions: on('extensions:state'),
  onExtInstalled: on('extensions:installed'),
  onExtOpenPopup: on('extensions:open-popup'),
  onExtPopup: on('extensions:popup'),

  onState: on('tabs:state'),
  onBookmarks: on('bookmarks:state'),
  onBookmarkDialog: on('bookmark:dialog'),
  onDownloads: on('downloads:state'),
  onDownloadStarted: on('downloads:started'),
  onToggleDownloads: on('downloads:toggle'),
  onSettings: on('settings:state'),
  onUpdate: on('update:state'),
  onFullscreen: on('ui:fullscreen'),
  onFocusAddress: on('ui:focus-address'),
  onFindOpen: on('find:open'),
  onFindClose: on('find:close'),
  onFindStep: on('find:step'),
  onFindResult: on('find:result'),
});
