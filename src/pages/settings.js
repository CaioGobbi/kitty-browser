'use strict';

const $ = (id) => document.getElementById(id);
const settings = window.kitty.settings;

const PERMISSION_NAMES = {
  camera: 'Câmera',
  microphone: 'Microfone',
  geolocation: 'Localização',
  notifications: 'Notificações',
  midi: 'Dispositivos MIDI',
  midiSysex: 'Controle MIDI',
  'clipboard-read': 'Área de transferência',
  'idle-detection': 'Detecção de ausência',
  'window-management': 'Gerenciar janelas',
  'storage-access': 'Cookies em outros sites',
  'top-level-storage-access': 'Cookies em outros sites',
  hid: 'Dispositivos HID',
  serial: 'Portas seriais',
  usb: 'Dispositivos USB',
  speaker: 'Saída de áudio',
  'speaker-selection': 'Saída de áudio',
  keyboardLock: 'Captura do teclado',
  openExternal: 'Abrir aplicativos externos',
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
  remove.textContent = 'Remover';
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
    ...[{ id: 'off', name: 'Desligado (DNS do sistema)' }, ...s.dnsProviders].map((p) => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      return option;
    }),
  );
  dns.value = s.values.secureDns;

  const ago = (t) => {
    if (!t) return 'nunca';
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
  };
  $('lists-status').textContent = s.lists.refreshing
    ? 'Atualizando…'
    : `Anúncios e rastreadores: ${ago(s.lists.ads)} · Sites perigosos: ${ago(s.lists.threats)}. O Kitty atualiza sozinho.`;

  $('default-status').textContent = !s.canBeDefault
    ? 'Disponível no app instalado (não no modo de desenvolvimento)'
    : s.isDefaultBrowser
      ? 'O Kitty é o seu navegador padrão 🎉'
      : 'Links de outros apps abrem em outro navegador';
  $('make-default').hidden = s.isDefaultBrowser || !s.canBeDefault;
  $('make-default').textContent = s.platform === 'win32' ? 'Escolher nas Configurações do Windows' : 'Tornar padrão';

  $('allowlist').replaceChildren(
    ...(s.allowlist.length
      ? s.allowlist.map((host) => item(host, null, async () => render(await settings.removeAllowlisted(host))))
      : [none('Nenhum — os escudos estão ativos em todos os sites.')]),
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
      : [none('Nenhum site pediu permissões ainda. Quando pedir, o Kitty pergunta antes de liberar.')]),
  );

  $('downloads-dir').textContent = s.downloadsDir;

  const u = s.update;
  $('current-version').textContent = u.version;
  $('check-update').hidden = !u.supported || u.status === 'ready' || u.status === 'downloading';
  $('update-status').textContent = !u.supported
    ? s.platform === 'darwin'
      ? 'No Mac, a atualização automática exige uma assinatura paga da Apple. Por enquanto, instale as versões novas manualmente.'
      : 'Atualização automática disponível no app instalado.'
    : {
        idle: 'O Kitty procura atualizações sozinho, a cada poucas horas, em github.com/caiogobbi/kitty-browser.',
        checking: 'Procurando atualizações…',
        downloading: `Baixando a versão ${u.available}… ${u.progress}%`,
        ready: `A versão ${u.available} está pronta. Use o botão “Atualizar” na barra de ferramentas para reiniciar.`,
        latest: 'Você está usando a versão mais recente.',
        error: `Não foi possível procurar atualizações (${u.error}).`,
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
$('update-lists').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('lists-status').textContent = 'Atualizando…';
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
  if (!kinds.length || !confirm('Apagar os dados selecionados? Isso não pode ser desfeito.')) return;
  render(await settings.clearData(kinds));
  $('cleared').hidden = false;
  setTimeout(() => ($('cleared').hidden = true), 3000);
});

// ---- Import from another browser
// Browsers that macOS keeps Kitty out of still show up in the list, marked, so
// picking one leads to the permission instead of an empty list.
const BLOCKED = 'blocked:';
const PRIVACY_PATH = 'Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco';

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
      ? 'Traz favoritos e histórico salvos no computador. Nada é enviado pela internet.'
      : 'Nenhum outro navegador encontrado neste computador.';
  updateImportChoice();
}

function updateImportChoice() {
  const value = $('import-source').value;
  const blockedName = value.startsWith(BLOCKED) ? value.slice(BLOCKED.length) : null;
  $('import-blocked').hidden = !blockedName;
  if (blockedName) {
    $('import-blocked-text').textContent =
      `O macOS não deixa o Kitty ler os dados do ${blockedName}. Para liberar, ative o Kitty em ` +
      `${PRIVACY_PATH} e volte para esta tela. Se o Kitty já estiver na lista, apague-o com o botão − e ` +
      'adicione de novo com o +: o macOS esquece a permissão quando o Kitty é atualizado.';
  }
  $('import').textContent = blockedName ? 'Dar permissão' : 'Importar';
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
  status.textContent = 'Importando…';
  const r = await settings.importRun($('import-source').value, kinds);
  e.target.disabled = false;
  if (!r || r.error) {
    status.textContent = r?.error || 'Não foi possível importar.';
    return;
  }
  if (!r.bookmarks && !r.history) {
    status.textContent = 'Nada novo para importar: o Kitty já tem tudo isso.';
    return;
  }
  const parts = [];
  if (kinds.includes('bookmarks')) parts.push(`${r.bookmarks} ${r.bookmarks === 1 ? 'favorito' : 'favoritos'}`);
  if (kinds.includes('history')) parts.push(`${r.history} ${r.history === 1 ? 'página' : 'páginas'} do histórico`);
  status.textContent = `Pronto: ${parts.join(' e ')} ${r.bookmarks + r.history === 1 ? 'importado' : 'importados'}.`;
});

settings.get().then(render);
loadImportSources();
