'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

const $ = (id) => document.getElementById(id);
const settings = window.kitty.settings;

const PERMISSION_NAMES = {
  camera: t('Câmera'),
  microphone: t('Microfone'),
  geolocation: t('Localização'),
  notifications: t('Notificações'),
  midi: t('Dispositivos MIDI'),
  midiSysex: t('Controle MIDI'),
  'clipboard-read': t('Área de transferência'),
  'idle-detection': t('Detecção de ausência'),
  'window-management': t('Gerenciar janelas'),
  'storage-access': t('Cookies em outros sites'),
  'top-level-storage-access': t('Cookies em outros sites'),
  hid: t('Dispositivos HID'),
  serial: t('Portas seriais'),
  usb: t('Dispositivos USB'),
  speaker: t('Saída de áudio'),
  'speaker-selection': t('Saída de áudio'),
  keyboardLock: t('Captura do teclado'),
  openExternal: t('Abrir aplicativos externos'),
};

if (window.kitty.platform !== 'darwin') {
  for (const small of document.querySelectorAll('small')) {
    small.textContent = small.textContent.replace('⇧⌘B', 'Ctrl+Shift+B');
  }
}

function item(label, detail, onRemove) {
  const row = document.createElement('div');
  row.className = 'item';
  const text = document.createElement('span');
  text.append(label);
  if (detail) text.append(' ', detail);
  const remove = document.createElement('button');
  remove.textContent = t('Remover');
  remove.addEventListener('click', onRemove);
  row.append(text, remove);
  return row;
}

function none(text) {
  const p = document.createElement('div');
  p.className = 'none';
  p.textContent = text;
  return p;
}

function render(s) {
  if (!s) return;
  for (const input of document.querySelectorAll('[data-setting]')) input.checked = !!s.values[input.dataset.setting];

  const engine = $('engine');
  engine.replaceChildren(
    ...s.engines.map((e) => {
      const option = document.createElement('option');
      option.value = e.id;
      option.textContent = e.name;
      return option;
    }),
  );
  engine.value = s.values.searchEngine;
  const hasSuggest = s.engines.find((e) => e.id === s.values.searchEngine)?.suggest;
  document.querySelector('[data-setting="searchSuggestions"]').disabled = !hasSuggest;

  const dns = $('dns');
  dns.replaceChildren(
    ...[{ id: 'off', name: t('Desligado (DNS do sistema)') }, ...s.dnsProviders].map((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      return option;
    }),
  );
  dns.value = s.values.secureDns;
  $('tab-layout').value = s.values.tabLayout;
  $('theme').value = s.values.theme;
  const language = $('language');
  if (!language.options.length) language.append(...s.languages.map((l) => new Option(l.name, l.id)));
  language.value = s.values.language;
  $('bookmarks-bar').value = s.values.bookmarksBar;

  const ago = (time) => {
    if (!time) return t('nunca');
    const min = Math.round((Date.now() - time) / 60000);
    if (min < 1) return t('agora mesmo');
    if (min < 60) return t('há {n} min', { n: min });
    const h = Math.round(min / 60);
    return h < 48 ? t('há {n} h', { n: h }) : t('há {n} dias', { n: Math.round(h / 24) });
  };
  $('lists-status').textContent = s.lists.refreshing
    ? t('Atualizando…')
    : t('Anúncios e rastreadores: {ads} · Sites perigosos: {threats}.', { ads: ago(s.lists.ads), threats: ago(s.lists.threats) });

  $('default-status').textContent = !s.canBeDefault
    ? t('Disponível no app instalado (não no modo de desenvolvimento)')
    : s.isDefaultBrowser
      ? t('O Kitty é o seu navegador padrão 🎉')
      : t('Links de outros apps abrem em outro navegador');
  $('make-default').hidden = s.isDefaultBrowser || !s.canBeDefault;
  $('make-default').textContent = s.platform === 'win32' ? t('Escolher nas Configurações do Windows') : t('Tornar padrão');

  $('allowlist').replaceChildren(
    ...(s.allowlist.length
      ? s.allowlist.map((host) => item(host, null, async () => render(await settings.removeAllowlisted(host))))
      : [none(t('Nenhum — os escudos estão ativos em todos os sites.'))]),
  );

  $('permissions').replaceChildren(
    ...(s.permissions.length
      ? s.permissions.map((p) => {
          const detail = document.createElement('small');
          const value = document.createElement('b');
          value.className = p.value;
          value.textContent = p.value === 'allow' ? 'permitido' : 'bloqueado';
          detail.append(`${PERMISSION_NAMES[p.permission] || p.permission} · `, value);
          return item(p.origin.replace(/^https?:\/\//, ''), detail, async () =>
            render(await settings.removePermission(p.origin, p.permission)),
          );
        })
      : [none(t('Nenhum site pediu permissões ainda. Quando pedir, o Kitty pergunta antes de liberar.'))]),
  );

  $('downloads-dir').textContent = s.downloadsDir;

  const u = s.update;
  $('current-version').textContent = u.version;
  $('check-update').hidden = !u.supported || u.status === 'ready' || u.status === 'downloading';
  $('auto-update-row').hidden = !u.supported;
  $('update-status').textContent = !u.supported
    ? s.platform === 'linux'
      ? t('No Linux, o Kitty se atualiza rodando de novo o comando de instalação do README.')
      : t('Atualização automática disponível no app instalado.')
    : {
        idle: s.values.autoUpdate
          ? t('O Kitty procura atualizações sozinho, a cada poucas horas, em github.com/caiogobbi/kitty-browser.')
          : t('A busca automática está desligada. Use o botão para procurar agora.'),
        checking: t('Procurando atualizações…'),
        downloading: t('Baixando a versão {version}… {progress}%', { version: u.available, progress: u.progress }),
        ready: t('A versão {version} está pronta. Use o botão “Atualizar” na barra de ferramentas para reiniciar.', { version: u.available }),
        latest: t('Você está usando a versão mais recente.'),
        error: t('Não foi possível procurar atualizações ({error}).', { error: u.error }),
      }[u.status];
  $('version').textContent = s.version;
}

for (const input of document.querySelectorAll('[data-setting]')) {
  input.addEventListener('change', async () => render(await settings.set(input.dataset.setting, input.checked)));
}
$('engine').addEventListener('change', async (e) => render(await settings.set('searchEngine', e.target.value)));
$('make-default').addEventListener('click', async () => {
  render(await settings.makeDefaultBrowser());
  // macOS asks for confirmation in a system dialog; check again afterwards.
  setTimeout(async () => render(await settings.get()), 4000);
});
$('dns').addEventListener('change', async (e) => render(await settings.set('secureDns', e.target.value)));
$('bookmarks-bar').addEventListener('change', async (e) => render(await settings.set('bookmarksBar', e.target.value)));
$('theme').addEventListener('change', async (e) => render(await settings.set('theme', e.target.value)));
// Kitty reloads its pages in the new language.
$('language').addEventListener('change', (e) => settings.set('language', e.target.value));
$('tab-layout').addEventListener('change', async (e) => render(await settings.set('tabLayout', e.target.value)));
$('update-lists').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('lists-status').textContent = t('Atualizando…');
  render(await settings.updateLists());
  e.target.disabled = false;
});
$('check-update').addEventListener('click', async () => {
  render(await settings.checkUpdate());
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const s = await settings.get();
    render(s);
    if (!['checking', 'idle'].includes(s.update.status)) break;
  }
});
$('open-downloads').addEventListener('click', () => settings.openDownloads());
$('clear').addEventListener('click', async () => {
  const kinds = [...document.querySelectorAll('#clear-kinds input:checked')].map((i) => i.value);
  if (!kinds.length || !confirm(t('Apagar os dados selecionados? Isso não pode ser desfeito.'))) return;
  render(await settings.clearData(kinds));
  $('cleared').hidden = false;
  setTimeout(() => ($('cleared').hidden = true), 3000);
});

// ---- Import from another browser
// Browsers that macOS keeps Kitty out of still show up in the list, marked, so
// picking one leads to the permission instead of an empty list.
const BLOCKED = 'blocked:';
const PRIVACY_PATH = t('Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco');

async function loadImportSources() {
  const { sources, blocked } = await settings.importSources();
  const select = $('import-source');
  const previous = select.value;
  const option = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };
  select.replaceChildren(
    ...sources.map((s) => option(s.id, s.name)),
    ...blocked.map((name) => option(BLOCKED + name, `🔒 ${name}`)),
  );
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  select.disabled = sources.length + blocked.length === 0;
  $('import-hint').textContent =
    sources.length || blocked.length
      ? t('Traz favoritos e histórico salvos no computador. Nada é enviado pela internet.')
      : t('Nenhum outro navegador encontrado neste computador.');
  updateImportChoice();
}

function updateImportChoice() {
  const value = $('import-source').value;
  const blockedName = value.startsWith(BLOCKED) ? value.slice(BLOCKED.length) : null;
  $('import-blocked').hidden = !blockedName;
  if (blockedName) {
    $('import-blocked-text').textContent =
      t('O macOS não deixa o Kitty ler os dados do {browser}. Para liberar, ative o Kitty em {path} e volte para esta tela. Se o Kitty já estiver na lista, apague-o com o botão − e adicione de novo com o +: o macOS esquece a permissão quando o Kitty é atualizado.', { browser: blockedName, path: PRIVACY_PATH });
  }
  $('import').textContent = blockedName ? t('Dar permissão') : t('Importar');
  $('import').disabled = !value;
}

$('import-source').addEventListener('change', () => {
  $('import-status').textContent = '';
  updateImportChoice();
});
// After granting the permission in System Settings, the browser shows up as soon as Kitty is back.
window.addEventListener('focus', loadImportSources);

$('import').addEventListener('click', async (e) => {
  if ($('import-source').value.startsWith(BLOCKED)) return settings.importOpenPrivacy();
  const kinds = [...document.querySelectorAll('#importar .checks input:checked')].map((i) => i.value);
  if (!kinds.length) return;
  const status = $('import-status');
  e.target.disabled = true;
  status.textContent = t('Importando…');
  const r = await settings.importRun($('import-source').value, kinds);
  e.target.disabled = false;
  if (!r || r.error) {
    status.textContent = r?.error || t('Não foi possível importar.');
    return;
  }
  if (!r.bookmarks && !r.history) {
    status.textContent = t('Nada novo para importar: o Kitty já tem tudo isso.');
    return;
  }
  const parts = [];
  if (kinds.includes('bookmarks')) parts.push(r.bookmarks === 1 ? t('1 favorito') : t('{n} favoritos', { n: r.bookmarks }));
  if (kinds.includes('history')) parts.push(r.history === 1 ? t('1 página do histórico') : t('{n} páginas do histórico', { n: r.history }));
  status.textContent = t('Importado: {what}.', { what: parts.join(` ${t('e')} `) });
});

settings.get().then(render);
loadImportSources();

// One section at a time, chosen in the side menu; the address keeps it (#senhas, #importar…).
function showSection() {
  const sections = [...document.querySelectorAll('main > section')];
  const current = sections.find((s) => `#${s.id}` === location.hash) || sections[0];
  for (const s of sections) s.classList.toggle('current', s === current);
  for (const a of document.querySelectorAll('#menu a')) {
    a.toggleAttribute('aria-current', a.getAttribute('href') === `#${current.id}`);
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showSection);
showSection();
