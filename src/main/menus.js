'use strict';

const { Menu, clipboard, dialog } = require('electron');

const { data, engine, searchUrl } = require('./data');
const { registry } = require('./registry');
const downloads = require('./downloads');
const bookmarks = require('./bookmarks');
const { cleanUrl } = require('./privacy');
const { t } = require('../i18n');

/** Set by main.js so menus can open windows and toggle bookmarks. */
const actions = {
  newWindow: () => {},
  newPrivateWindow: () => {},
  openInternal: () => {},
  toggleBookmark: () => {},
  toggleBookmarksBar: () => {},
  setBookmarksBar: () => {},
  setTabLayout: () => {},
  editBookmarks: () => ({}),
  bookmarkDialog: () => {},
};

const current = () => registry.current();
const withWin = (fn) => () => {
  const kwin = current();
  if (kwin) fn(kwin);
};

const TAB_LAYOUT_NAMES = { classic: 'Clássico', compact: 'Compacto', vertical: 'Abas verticais' };

/** Radio items to pick where the tabs go (Visualizar menu and the tab's right-click menu). */
function tabLayoutItems() {
  const currentLayout = data.settings.get('tabLayout');
  return Object.entries(TAB_LAYOUT_NAMES).map(([id, label]) => ({
    label: t(label),
    type: 'radio',
    checked: id === currentLayout,
    click: () => actions.setTabLayout(id),
  }));
}

const BOOKMARKS_BAR_NAMES = { always: 'Sempre mostrar', newtab: 'Só na nova aba', never: 'Sempre esconder' };

/** Radio items for when the bookmarks bar shows (Visualizar menu and the bar's right-click menu). */
function bookmarksBarItems() {
  const current = data.settings.get('bookmarksBar');
  return Object.entries(BOOKMARKS_BAR_NAMES).map(([id, label]) => ({
    label: t(label),
    type: 'radio',
    checked: id === current,
    click: () => actions.setBookmarksBar(id),
  }));
}

function buildAppMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [
          {
            // Spelled out so the items follow Kitty's language, not Electron's English.
            label: 'Kitty',
            submenu: [
              { role: 'about', label: t('Sobre o Kitty') },
              { type: 'separator' },
              { role: 'services', label: t('Serviços') },
              { type: 'separator' },
              { role: 'hide', label: t('Ocultar Kitty') },
              { role: 'hideOthers', label: t('Ocultar outros') },
              { role: 'unhide', label: t('Mostrar tudo') },
              { type: 'separator' },
              { role: 'quit', label: t('Encerrar Kitty') },
            ],
          },
        ] : []),
    {
      label: t('Arquivo'),
      submenu: [
        { label: t('Nova aba'), accelerator: 'CmdOrCtrl+T', click: () => (current() ? current().createTab() : actions.newWindow()) },
        { label: t('Nova janela'), accelerator: 'CmdOrCtrl+N', click: () => actions.newWindow() },
        { label: t('Nova janela privativa'), accelerator: 'CmdOrCtrl+Shift+N', click: () => actions.newPrivateWindow() },
        { label: t('Abrir local'), accelerator: 'CmdOrCtrl+L', click: withWin((w) => w.focusAddressBar()) },
        { type: 'separator' },
        { label: t('Reabrir aba fechada'), accelerator: 'CmdOrCtrl+Shift+T', click: withWin((w) => w.reopenClosedTab()) },
        { label: t('Fechar aba'), accelerator: 'CmdOrCtrl+W', click: withWin((w) => w.closeTab()) },
        { label: t('Fechar janela'), accelerator: 'CmdOrCtrl+Shift+W', click: withWin((w) => w.win.close()) },
        { type: 'separator' },
        { label: t('Salvar página como…'), accelerator: 'CmdOrCtrl+S', click: withWin((w) => savePage(w)) },
        { label: t('Imprimir…'), accelerator: 'CmdOrCtrl+P', click: withWin((w) => w.activeWebContents()?.print()) },
      ],
    },
    {
      label: t('Editar'),
      submenu: [
        { role: 'undo', label: t('Desfazer') },
        { role: 'redo', label: t('Refazer') },
        { type: 'separator' },
        { role: 'cut', label: t('Recortar') },
        { role: 'copy', label: t('Copiar') },
        { role: 'paste', label: t('Colar') },
        { role: 'pasteAndMatchStyle', label: t('Colar e manter estilo') },
        { role: 'selectAll', label: t('Selecionar tudo') },
        { type: 'separator' },
        { label: t('Buscar na página…'), accelerator: 'CmdOrCtrl+F', click: withWin((w) => w.openFind()) },
        { label: t('Buscar próxima'), accelerator: 'CmdOrCtrl+G', click: withWin((w) => w.sendUi('find:step', 1)) },
        { label: t('Buscar anterior'), accelerator: 'CmdOrCtrl+Shift+G', click: withWin((w) => w.sendUi('find:step', -1)) },
      ],
    },
    {
      label: t('Visualizar'),
      submenu: [
        { label: t('Recarregar'), accelerator: 'CmdOrCtrl+R', click: withWin((w) => w.reload()) },
        { label: t('Recarregar sem cache'), accelerator: 'CmdOrCtrl+Shift+R', click: withWin((w) => w.reload({ hard: true })) },
        {
          label: t('Barra de favoritos'),
          submenu: [
            ...bookmarksBarItems(),
            { type: 'separator' },
            { label: t('Mostrar ou esconder'), accelerator: 'CmdOrCtrl+Shift+B', click: () => actions.toggleBookmarksBar() },
          ],
        },
        { label: t('Layout das abas'), submenu: tabLayoutItems() },
        { type: 'separator' },
        { label: t('Ampliar'), accelerator: 'CmdOrCtrl+Plus', click: withWin((w) => zoom(w, 0.5)) },
        { label: t('Ampliar'), accelerator: 'CmdOrCtrl+=', visible: false, click: withWin((w) => zoom(w, 0.5)) },
        { label: t('Reduzir'), accelerator: 'CmdOrCtrl+-', click: withWin((w) => zoom(w, -0.5)) },
        { label: t('Tamanho real'), accelerator: 'CmdOrCtrl+0', click: withWin((w) => zoom(w, 0)) },
        { type: 'separator' },
        { label: t('Ver código-fonte'), accelerator: 'Alt+CmdOrCtrl+U', click: withWin((w) => viewSource(w)) },
        {
          label: t('Ferramentas do desenvolvedor'),
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withWin((w) => w.activeWebContents()?.toggleDevTools()),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Tela cheia') },
      ],
    },
    {
      label: t('Histórico'),
      submenu: [
        { label: t('Voltar'), accelerator: 'CmdOrCtrl+[', click: withWin((w) => w.activeWebContents()?.navigationHistory.goBack()) },
        { label: t('Avançar'), accelerator: 'CmdOrCtrl+]', click: withWin((w) => w.activeWebContents()?.navigationHistory.goForward()) },
        { type: 'separator' },
        { label: t('Mostrar histórico'), accelerator: 'CmdOrCtrl+Y', click: () => actions.openInternal('kitty://history') },
        { label: t('Downloads'), accelerator: 'CmdOrCtrl+Shift+J', click: withWin((w) => w.sendUi('downloads:toggle')) },
      ],
    },
    {
      label: t('Favoritos'),
      submenu: [
        { label: t('Adicionar/remover favorito'), accelerator: 'CmdOrCtrl+D', click: withWin((w) => actions.toggleBookmark(w)) },
        { label: t('Gerenciar favoritos'), accelerator: 'Alt+CmdOrCtrl+B', click: () => actions.openInternal('kitty://bookmarks') },
        { type: 'separator' },
        { label: t('Importar de outro navegador…'), click: () => actions.openInternal('kitty://settings#importar') },
      ],
    },
    {
      label: t('Abas'),
      submenu: [
        { label: t('Próxima aba'), accelerator: 'Ctrl+Tab', click: withWin((w) => w.cycleTab(1)) },
        { label: t('Aba anterior'), accelerator: 'Ctrl+Shift+Tab', click: withWin((w) => w.cycleTab(-1)) },
        { label: t('Próxima aba'), accelerator: 'Alt+CmdOrCtrl+Right', visible: false, click: withWin((w) => w.cycleTab(1)) },
        { label: t('Aba anterior'), accelerator: 'Alt+CmdOrCtrl+Left', visible: false, click: withWin((w) => w.cycleTab(-1)) },
        { label: t('Silenciar aba'), accelerator: 'Ctrl+M', click: withWin((w) => w.toggleMute()) },
        { label: t('Fixar/desafixar aba'), click: withWin((w) => w.togglePin()) },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: n === 9 ? t('Última aba') : t('Aba {n}', { n }),
          accelerator: `CmdOrCtrl+${n}`,
          click: withWin((w) => {
            const id = n === 9 ? w.order.at(-1) : w.order[n - 1];
            if (id != null) w.switchTab(id);
          }),
        })),
      ],
    },
    {
      role: 'windowMenu',
      label: t('Janela'),
      submenu: [
        { role: 'minimize', label: t('Minimizar') },
        ...(process.platform === 'darwin'
          ? [{ role: 'zoom', label: t('Zoom') }, { type: 'separator' }, { role: 'front', label: t('Trazer tudo para a frente') }]
          : [{ role: 'close', label: t('Fechar') }]),
      ],
    },
    {
      label: t('Ajustes'),
      submenu: [
        { label: t('Configurações'), accelerator: 'CmdOrCtrl+,', click: () => actions.openInternal('kitty://settings') },
        { label: t('Senhas'), click: () => actions.openInternal('kitty://passwords') },
        { label: t('Extensões'), click: () => actions.openInternal('kitty://extensions') },
        { label: t('Chrome Web Store'), click: () => actions.openExtensionStore() },
      ],
    },
  ];
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }
  // Windows/Linux: the title bar is hidden, so a menu bar would never show (and
  // its accelerators aren't reliable without it). Shortcuts are matched from
  // each webContents instead; Chromium already handles editing keys (Ctrl+C…).
  Menu.setApplicationMenu(null);
  shortcuts = [];
  collectShortcuts(template);
  for (const [accelerator, click] of windowsShortcuts()) shortcuts.push({ ...parseAccelerator(accelerator), click });
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts on Windows/Linux

let shortcuts = [];

/** The usual Windows browser keys, on top of the menu's own shortcuts. */
function windowsShortcuts() {
  const nav = (fn) => withWin((w) => fn(w.activeWebContents()?.navigationHistory));
  return [
    ['F5', withWin((w) => w.reload())],
    ['Ctrl+F5', withWin((w) => w.reload({ hard: true }))],
    ['Shift+F5', withWin((w) => w.reload({ hard: true }))],
    ['Alt+Left', nav((h) => h?.goBack())],
    ['Alt+Right', nav((h) => h?.goForward())],
    ['Alt+Home', withWin((w) => w.navigate('kitty://newtab'))],
    ['Ctrl+H', () => actions.openInternal('kitty://history')],
    ['Ctrl+J', withWin((w) => w.sendUi('downloads:toggle'))],
    ['Ctrl+Shift+O', () => actions.openInternal('kitty://bookmarks')],
    ['Ctrl+PageDown', withWin((w) => w.cycleTab(1))],
    ['Ctrl+PageUp', withWin((w) => w.cycleTab(-1))],
    ['Ctrl+F4', withWin((w) => w.closeTab())],
    ['Ctrl+Shift+I', withWin((w) => w.activeWebContents()?.toggleDevTools())],
    ['F12', withWin((w) => w.activeWebContents()?.toggleDevTools())],
    ['F11', withWin((w) => w.win.setFullScreen(!w.win.isFullScreen()))],
    ['F6', withWin((w) => w.focusAddressBar())],
    ['Alt+D', withWin((w) => w.focusAddressBar())],
    ['Ctrl+E', withWin((w) => w.focusAddressBar())],
    ['Ctrl+K', withWin((w) => w.focusAddressBar())],
    ['F3', withWin((w) => w.sendUi('find:step', 1))],
    ['Shift+F3', withWin((w) => w.sendUi('find:step', -1))],
  ];
}

const KEY_NAMES = { Plus: '+', Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Esc: 'Escape' };

function parseAccelerator(accelerator) {
  const parts = accelerator.split('+');
  const key = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    key: (KEY_NAMES[key] || key).toLowerCase(),
    ctrl: mods.has('cmdorctrl') || mods.has('ctrl') || mods.has('control') || mods.has('cmd') || mods.has('command'),
    shift: mods.has('shift'),
    alt: mods.has('alt') || mods.has('option'),
  };
}

function collectShortcuts(items) {
  for (const item of items) {
    if (item.submenu) collectShortcuts(item.submenu);
    else if (item.accelerator && item.click && !item.role) {
      // macOS-only spellings (Alt+Cmd+I) have Windows equivalents above.
      if (/\bCmd\b|Command/.test(item.accelerator)) continue;
      shortcuts.push({ ...parseAccelerator(item.accelerator), click: item.click });
    }
  }
}

/** Runs the shortcut matching a key press; returns true when one did. */
function handleShortcut(input) {
  if (input.type !== 'keyDown' || input.meta) return false;
  const key = String(input.key).toLowerCase();
  const match = shortcuts.find(
    (s) => s.key === key && s.ctrl === input.control && s.alt === input.alt && (s.key === '+' || s.shift === input.shift),
  );
  if (!match) return false;
  match.click();
  return true;
}

function zoom(kwin, delta) {
  const wc = kwin.activeWebContents();
  if (wc) wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta);
}

function viewSource(kwin) {
  const url = kwin.activeWebContents()?.getURL();
  if (url && /^https?:/.test(url)) kwin.createTab(`view-source:${url}`);
}

async function savePage(kwin) {
  const wc = kwin.activeWebContents();
  if (!wc || !/^https?:/.test(wc.getURL())) return;
  const name = (wc.getTitle() || 'pagina').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(kwin.win, {
    defaultPath: `${name}.html`,
    filters: [{ name: t('Página web completa'), extensions: ['html'] }],
  });
  if (!canceled && filePath) wc.savePage(filePath, 'HTMLComplete').catch(() => {});
}

function shorten(text, max = 28) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ---------------------------------------------------------------------------
// Right-click menus

function pageContextMenu(kwin, tab, params) {
  const wc = tab.view.webContents;
  const items = [];
  const sep = () => items.length && items.at(-1).type !== 'separator' && items.push({ type: 'separator' });
  const isHttp = (u) => /^https?:/.test(u || '');

  if (params.linkURL && isHttp(params.linkURL)) {
    items.push(
      { label: t('Abrir link em nova aba'), click: () => kwin.createTab(params.linkURL, { activate: false }) },
      { label: t('Abrir link em nova janela'), click: () => actions.newWindow(params.linkURL) },
      { label: t('Abrir link em janela privativa'), click: () => actions.newPrivateWindow(params.linkURL) },
      { type: 'separator' },
      { label: t('Salvar link como…'), click: () => downloads.saveAs(wc, params.linkURL) },
      { label: t('Copiar endereço do link'), click: () => clipboard.writeText(params.linkURL) },
    );
    const clean = cleanUrl(params.linkURL);
    if (clean !== params.linkURL) {
      items.push({ label: t('Copiar link sem rastreadores'), click: () => clipboard.writeText(clean) });
    }
  }

  if (params.mediaType === 'image' && params.srcURL) {
    sep();
    items.push(
      { label: t('Abrir imagem em nova aba'), click: () => kwin.createTab(params.srcURL, { activate: false }) },
      { label: t('Salvar imagem como…'), click: () => downloads.saveAs(wc, params.srcURL) },
      { label: t('Copiar imagem'), click: () => wc.copyImageAt(params.x, params.y) },
      { label: t('Copiar endereço da imagem'), click: () => clipboard.writeText(params.srcURL) },
    );
  } else if ((params.mediaType === 'video' || params.mediaType === 'audio') && isHttp(params.srcURL)) {
    sep();
    const video = params.mediaType === 'video';
    items.push(
      { label: video ? t('Abrir vídeo em nova aba') : t('Abrir áudio em nova aba'), click: () => kwin.createTab(params.srcURL, { activate: false }) },
      { label: video ? t('Salvar vídeo como…') : t('Salvar áudio como…'), click: () => downloads.saveAs(wc, params.srcURL) },
      { label: video ? t('Copiar endereço do vídeo') : t('Copiar endereço do áudio'), click: () => clipboard.writeText(params.srcURL) },
    );
  }

  if (params.isEditable) {
    sep();
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: t('Sem sugestões'), enabled: false });
      items.push(
        { label: t('Adicionar ao dicionário'), click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' },
      );
    }
    const f = params.editFlags;
    items.push(
      { role: 'undo', label: t('Desfazer'), enabled: f.canUndo },
      { role: 'redo', label: t('Refazer'), enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', label: t('Recortar'), enabled: f.canCut },
      { role: 'copy', label: t('Copiar'), enabled: f.canCopy },
      { role: 'paste', label: t('Colar'), enabled: f.canPaste },
      { role: 'selectAll', label: t('Selecionar tudo'), enabled: f.canSelectAll },
    );
  } else if (params.selectionText.trim()) {
    sep();
    const text = params.selectionText.trim();
    items.push(
      { role: 'copy', label: t('Copiar') },
      { label: t('Pesquisar “{text}” no {engine}', { text: shorten(text), engine: engine().name }), click: () => kwin.createTab(searchUrl(text)) },
    );
  }

  if (!items.length) {
    const nav = wc.navigationHistory;
    items.push(
      { label: t('Voltar'), enabled: nav.canGoBack(), click: () => nav.goBack() },
      { label: t('Avançar'), enabled: nav.canGoForward(), click: () => nav.goForward() },
      { label: t('Recarregar'), click: () => wc.reload() },
      { type: 'separator' },
      { label: t('Salvar página como…'), enabled: isHttp(wc.getURL()), click: () => savePage(kwin) },
      { label: t('Imprimir…'), click: () => wc.print() },
      { label: t('Ver código-fonte'), enabled: isHttp(wc.getURL()), click: () => kwin.createTab(`view-source:${wc.getURL()}`) },
    );
  }

  const fromExtensions = require('./extensions').pageMenuItems(kwin, tab, params);
  if (fromExtensions.length) {
    sep();
    items.push(...fromExtensions);
  }

  sep();
  items.push({ label: t('Inspecionar'), click: () => wc.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(items).popup({ window: kwin.win });
}

function tabContextMenu(kwin, id) {
  const tab = kwin.tabs.get(id);
  if (!tab) return;
  const index = kwin.order.indexOf(id);
  const muted = tab.view.webContents.isAudioMuted();
  Menu.buildFromTemplate([
    { label: data.settings.get('tabLayout') === 'vertical' ? t('Nova aba abaixo') : t('Nova aba à direita'), click: () => kwin.createTab(undefined, { index: tab.pinned ? kwin.order.length : index + 1 }) },
    { type: 'separator' },
    { label: t('Recarregar'), click: () => tab.view.webContents.reload() },
    { label: t('Duplicar'), click: () => kwin.duplicateTab(id) },
    { label: muted ? t('Ativar som da aba') : t('Silenciar aba'), click: () => kwin.toggleMute(id) },
    { label: tab.pinned ? t('Desafixar aba') : t('Fixar aba'), click: () => kwin.togglePin(id) },
    { type: 'separator' },
    { label: t('Fechar aba'), click: () => kwin.closeTab(id) },
    { label: t('Fechar outras abas'), enabled: kwin.order.length > 1, click: () => kwin.closeOtherTabs(id) },
    {
      label: data.settings.get('tabLayout') === 'vertical' ? t('Fechar abas abaixo') : t('Fechar abas à direita'),
      enabled: index < kwin.order.length - 1,
      click: () => kwin.closeOtherTabs(id, { onlyRight: true }),
    },
    { type: 'separator' },
    { label: t('Reabrir aba fechada'), enabled: kwin.closedTabs.length > 0, click: () => kwin.reopenClosedTab() },
    { type: 'separator' },
    { label: t('Layout das abas'), submenu: tabLayoutItems() },
  ]).popup({ window: kwin.win });
}

/**
 * Right click on the bookmarks bar: on a bookmark, a folder, or empty space
 * (`id` null; `parentId` is the folder whose list was clicked, if any).
 */
function bookmarkContextMenu(kwin, id, parentId = null) {
  const item = id ? bookmarks.find(id) : null;
  if (id && !item) return;
  const edit = (op) => actions.editBookmarks(op);
  // New things go inside a clicked folder, or in the folder of the clicked bookmark.
  const isFolder = item && bookmarks.isFolder(item);
  const where = { parentId: isFolder ? item.id : item ? bookmarks.parentId(item) : parentId };
  const creating = [
    { label: t('Adicionar página…'), click: () => actions.bookmarkDialog(kwin, { mode: 'add', ...where }) },
    { label: t('Nova pasta…'), click: () => actions.bookmarkDialog(kwin, { mode: 'folder', ...where }) },
  ];
  let template;
  if (!item) {
    template = creating;
  } else if (isFolder) {
    const all = bookmarks.descendants(item);
    const inside = all.filter((b) => b.url);
    const count = all.length;
    template = [
      {
        label: t('Abrir tudo ({n})', { n: inside.length }),
        enabled: inside.length > 0,
        click: () => inside.forEach((b) => kwin.createTab(b.url, { activate: false })),
      },
      { type: 'separator' },
      { label: t('Renomear…'), click: () => actions.bookmarkDialog(kwin, { mode: 'rename', id, title: item.title }) },
      {
        label: t('Excluir pasta'),
        click: () => {
          if (count) {
            const answer = dialog.showMessageBoxSync(kwin.win, {
              type: 'warning',
              buttons: [t('Excluir'), t('Cancelar')],
              defaultId: 1,
              cancelId: 1,
              message: t('Excluir a pasta "{name}"?', { name: item.title }),
              detail: count === 1 ? t('Ela tem 1 item, que também será excluído.') : t('Ela tem {n} itens, que também serão excluídos.', { n: count }),
            });
            if (answer !== 0) return;
          }
          edit({ op: 'remove', id });
        },
      },
      { type: 'separator' },
      ...creating,
    ];
  } else {
    template = [
      { label: t('Abrir em nova aba'), click: () => kwin.createTab(item.url) },
      { label: t('Abrir em nova janela'), click: () => actions.newWindow(item.url) },
      { label: t('Abrir em janela privativa'), click: () => actions.newPrivateWindow(item.url) },
      { type: 'separator' },
      { label: t('Editar…'), click: () => actions.bookmarkDialog(kwin, { mode: 'edit', id, title: item.title, url: item.url }) },
      { label: t('Copiar endereço'), click: () => clipboard.writeText(item.url) },
      { label: t('Excluir'), click: () => edit({ op: 'remove', id }) },
      { type: 'separator' },
      ...creating,
    ];
  }
  template.push(
    { type: 'separator' },
    { label: t('Mostrar barra de favoritos'), submenu: bookmarksBarItems() },
    { label: t('Gerenciar favoritos'), click: () => actions.openInternal('kitty://bookmarks') },
  );
  Menu.buildFromTemplate(template).popup({ window: kwin.win });
}

module.exports = { actions, buildAppMenu, handleShortcut, pageContextMenu, tabContextMenu, bookmarkContextMenu };
