'use strict';

const { Menu, clipboard, dialog } = require('electron');

const { data, engine, searchUrl } = require('./data');
const { registry } = require('./registry');
const downloads = require('./downloads');
const { cleanUrl } = require('./privacy');

/** Set by main.js so menus can open windows and toggle bookmarks. */
const actions = {
  newWindow: () => {},
  newPrivateWindow: () => {},
  openInternal: () => {},
  toggleBookmark: () => {},
  toggleBookmarksBar: () => {},
};

const current = () => registry.current();
const withWin = (fn) => () => {
  const kwin = current();
  if (kwin) fn(kwin);
};

function buildAppMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu', label: 'Kitty' }] : []),
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Nova aba', accelerator: 'CmdOrCtrl+T', click: () => (current() ? current().createTab() : actions.newWindow()) },
        { label: 'Nova janela', accelerator: 'CmdOrCtrl+N', click: () => actions.newWindow() },
        { label: 'Nova janela privativa', accelerator: 'CmdOrCtrl+Shift+N', click: () => actions.newPrivateWindow() },
        { label: 'Abrir local', accelerator: 'CmdOrCtrl+L', click: withWin((w) => w.focusAddressBar()) },
        { type: 'separator' },
        { label: 'Reabrir aba fechada', accelerator: 'CmdOrCtrl+Shift+T', click: withWin((w) => w.reopenClosedTab()) },
        { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: withWin((w) => w.closeTab()) },
        { label: 'Fechar janela', accelerator: 'CmdOrCtrl+Shift+W', click: withWin((w) => w.win.close()) },
        { type: 'separator' },
        { label: 'Salvar página como…', accelerator: 'CmdOrCtrl+S', click: withWin((w) => savePage(w)) },
        { label: 'Imprimir…', accelerator: 'CmdOrCtrl+P', click: withWin((w) => w.activeWebContents()?.print()) },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'pasteAndMatchStyle', label: 'Colar e manter estilo' },
        { role: 'selectAll', label: 'Selecionar tudo' },
        { type: 'separator' },
        { label: 'Buscar na página…', accelerator: 'CmdOrCtrl+F', click: withWin((w) => w.openFind()) },
        { label: 'Buscar próxima', accelerator: 'CmdOrCtrl+G', click: withWin((w) => w.sendUi('find:step', 1)) },
        { label: 'Buscar anterior', accelerator: 'CmdOrCtrl+Shift+G', click: withWin((w) => w.sendUi('find:step', -1)) },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: withWin((w) => w.reload()) },
        { label: 'Recarregar sem cache', accelerator: 'CmdOrCtrl+Shift+R', click: withWin((w) => w.reload({ hard: true })) },
        { label: 'Mostrar barra de favoritos', accelerator: 'CmdOrCtrl+Shift+B', click: () => actions.toggleBookmarksBar() },
        { type: 'separator' },
        { label: 'Ampliar', accelerator: 'CmdOrCtrl+Plus', click: withWin((w) => zoom(w, 0.5)) },
        { label: 'Ampliar', accelerator: 'CmdOrCtrl+=', visible: false, click: withWin((w) => zoom(w, 0.5)) },
        { label: 'Reduzir', accelerator: 'CmdOrCtrl+-', click: withWin((w) => zoom(w, -0.5)) },
        { label: 'Tamanho real', accelerator: 'CmdOrCtrl+0', click: withWin((w) => zoom(w, 0)) },
        { type: 'separator' },
        { label: 'Ver código-fonte', accelerator: 'Alt+CmdOrCtrl+U', click: withWin((w) => viewSource(w)) },
        {
          label: 'Ferramentas do desenvolvedor',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: withWin((w) => w.activeWebContents()?.toggleDevTools()),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
    {
      label: 'Histórico',
      submenu: [
        { label: 'Voltar', accelerator: 'CmdOrCtrl+[', click: withWin((w) => w.activeWebContents()?.navigationHistory.goBack()) },
        { label: 'Avançar', accelerator: 'CmdOrCtrl+]', click: withWin((w) => w.activeWebContents()?.navigationHistory.goForward()) },
        { type: 'separator' },
        { label: 'Mostrar histórico', accelerator: 'CmdOrCtrl+Y', click: () => actions.openInternal('kitty://history') },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+Shift+J', click: withWin((w) => w.sendUi('downloads:toggle')) },
      ],
    },
    {
      label: 'Favoritos',
      submenu: [
        { label: 'Adicionar/remover favorito', accelerator: 'CmdOrCtrl+D', click: withWin((w) => actions.toggleBookmark(w)) },
        { label: 'Gerenciar favoritos', accelerator: 'Alt+CmdOrCtrl+B', click: () => actions.openInternal('kitty://bookmarks') },
      ],
    },
    {
      label: 'Abas',
      submenu: [
        { label: 'Próxima aba', accelerator: 'Ctrl+Tab', click: withWin((w) => w.cycleTab(1)) },
        { label: 'Aba anterior', accelerator: 'Ctrl+Shift+Tab', click: withWin((w) => w.cycleTab(-1)) },
        { label: 'Próxima aba', accelerator: 'Alt+CmdOrCtrl+Right', visible: false, click: withWin((w) => w.cycleTab(1)) },
        { label: 'Aba anterior', accelerator: 'Alt+CmdOrCtrl+Left', visible: false, click: withWin((w) => w.cycleTab(-1)) },
        { label: 'Silenciar aba', accelerator: 'Ctrl+M', click: withWin((w) => w.toggleMute()) },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
          label: n === 9 ? 'Última aba' : `Aba ${n}`,
          accelerator: `CmdOrCtrl+${n}`,
          click: withWin((w) => {
            const id = n === 9 ? w.order.at(-1) : w.order[n - 1];
            if (id != null) w.switchTab(id);
          }),
        })),
      ],
    },
    { role: 'windowMenu', label: 'Janela' },
    {
      label: 'Ajustes',
      submenu: [
        { label: 'Configurações', accelerator: 'CmdOrCtrl+,', click: () => actions.openInternal('kitty://settings') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    filters: [{ name: 'Página web completa', extensions: ['html'] }],
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
      { label: 'Abrir link em nova aba', click: () => kwin.createTab(params.linkURL, { activate: false }) },
      { label: 'Abrir link em nova janela', click: () => actions.newWindow(params.linkURL) },
      { label: 'Abrir link em janela privativa', click: () => actions.newPrivateWindow(params.linkURL) },
      { type: 'separator' },
      { label: 'Salvar link como…', click: () => downloads.saveAs(wc, params.linkURL) },
      { label: 'Copiar endereço do link', click: () => clipboard.writeText(params.linkURL) },
    );
    const clean = cleanUrl(params.linkURL);
    if (clean !== params.linkURL) {
      items.push({ label: 'Copiar link sem rastreadores', click: () => clipboard.writeText(clean) });
    }
  }

  if (params.mediaType === 'image' && params.srcURL) {
    sep();
    items.push(
      { label: 'Abrir imagem em nova aba', click: () => kwin.createTab(params.srcURL, { activate: false }) },
      { label: 'Salvar imagem como…', click: () => downloads.saveAs(wc, params.srcURL) },
      { label: 'Copiar imagem', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copiar endereço da imagem', click: () => clipboard.writeText(params.srcURL) },
    );
  } else if ((params.mediaType === 'video' || params.mediaType === 'audio') && isHttp(params.srcURL)) {
    sep();
    const what = params.mediaType === 'video' ? 'vídeo' : 'áudio';
    items.push(
      { label: `Abrir ${what} em nova aba`, click: () => kwin.createTab(params.srcURL, { activate: false }) },
      { label: `Salvar ${what} como…`, click: () => downloads.saveAs(wc, params.srcURL) },
      { label: `Copiar endereço do ${what}`, click: () => clipboard.writeText(params.srcURL) },
    );
  }

  if (params.isEditable) {
    sep();
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'Sem sugestões', enabled: false });
      items.push(
        { label: 'Adicionar ao dicionário', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' },
      );
    }
    const f = params.editFlags;
    items.push(
      { role: 'undo', label: 'Desfazer', enabled: f.canUndo },
      { role: 'redo', label: 'Refazer', enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Recortar', enabled: f.canCut },
      { role: 'copy', label: 'Copiar', enabled: f.canCopy },
      { role: 'paste', label: 'Colar', enabled: f.canPaste },
      { role: 'selectAll', label: 'Selecionar tudo', enabled: f.canSelectAll },
    );
  } else if (params.selectionText.trim()) {
    sep();
    const text = params.selectionText.trim();
    items.push(
      { role: 'copy', label: 'Copiar' },
      { label: `Pesquisar “${shorten(text)}” no ${engine().name}`, click: () => kwin.createTab(searchUrl(text)) },
    );
  }

  if (!items.length) {
    const nav = wc.navigationHistory;
    items.push(
      { label: 'Voltar', enabled: nav.canGoBack(), click: () => nav.goBack() },
      { label: 'Avançar', enabled: nav.canGoForward(), click: () => nav.goForward() },
      { label: 'Recarregar', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Salvar página como…', enabled: isHttp(wc.getURL()), click: () => savePage(kwin) },
      { label: 'Imprimir…', click: () => wc.print() },
      { label: 'Ver código-fonte', enabled: isHttp(wc.getURL()), click: () => kwin.createTab(`view-source:${wc.getURL()}`) },
    );
  }

  sep();
  items.push({ label: 'Inspecionar', click: () => wc.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(items).popup({ window: kwin.win });
}

function tabContextMenu(kwin, id) {
  const tab = kwin.tabs.get(id);
  if (!tab) return;
  const index = kwin.order.indexOf(id);
  const muted = tab.view.webContents.isAudioMuted();
  Menu.buildFromTemplate([
    { label: 'Nova aba à direita', click: () => kwin.createTab(undefined, { index: index + 1 }) },
    { type: 'separator' },
    { label: 'Recarregar', click: () => tab.view.webContents.reload() },
    { label: 'Duplicar', click: () => kwin.duplicateTab(id) },
    { label: muted ? 'Ativar som da aba' : 'Silenciar aba', click: () => kwin.toggleMute(id) },
    { type: 'separator' },
    { label: 'Fechar aba', click: () => kwin.closeTab(id) },
    { label: 'Fechar outras abas', enabled: kwin.order.length > 1, click: () => kwin.closeOtherTabs(id) },
    {
      label: 'Fechar abas à direita',
      enabled: index < kwin.order.length - 1,
      click: () => kwin.closeOtherTabs(id, { onlyRight: true }),
    },
    { type: 'separator' },
    { label: 'Reabrir aba fechada', enabled: kwin.closedTabs.length > 0, click: () => kwin.reopenClosedTab() },
  ]).popup({ window: kwin.win });
}

function bookmarkContextMenu(kwin, id) {
  const bookmark = data.bookmarks.get('items').find((b) => b.id === id);
  if (!bookmark) return;
  Menu.buildFromTemplate([
    { label: 'Abrir em nova aba', click: () => kwin.createTab(bookmark.url) },
    { label: 'Abrir em nova janela', click: () => actions.newWindow(bookmark.url) },
    { label: 'Abrir em janela privativa', click: () => actions.newPrivateWindow(bookmark.url) },
    { type: 'separator' },
    { label: 'Copiar endereço', click: () => clipboard.writeText(bookmark.url) },
    { label: 'Gerenciar favoritos', click: () => actions.openInternal('kitty://bookmarks') },
    { type: 'separator' },
    { label: 'Remover', click: () => actions.removeBookmark(id) },
  ]).popup({ window: kwin.win });
}

module.exports = { actions, buildAppMenu, pageContextMenu, tabContextMenu, bookmarkContextMenu };
