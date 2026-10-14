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
$('open-downloads').addEventListener('click', () => settings.openDownloads());
$('clear').addEventListener('click', async () => {
  const kinds = [...document.querySelectorAll('.checks input:checked')].map((i) => i.value);
  if (!kinds.length || !confirm('Apagar os dados selecionados? Isso não pode ser desfeito.')) return;
  render(await settings.clearData(kinds));
  $('cleared').hidden = false;
  setTimeout(() => ($('cleared').hidden = true), 3000);
});

settings.get().then(render);
