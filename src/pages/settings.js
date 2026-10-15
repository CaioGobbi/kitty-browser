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
$('open-downloads').addEventListener('click', () => settings.openDownloads());
$('clear').addEventListener('click', async () => {
  const kinds = [...document.querySelectorAll('.checks input:checked')].map((i) => i.value);
  if (!kinds.length || !confirm('Apagar os dados selecionados? Isso não pode ser desfeito.')) return;
  render(await settings.clearData(kinds));
  $('cleared').hidden = false;
  setTimeout(() => ($('cleared').hidden = true), 3000);
});

settings.get().then(render);
