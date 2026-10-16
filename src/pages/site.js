'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

const $ = (id) => document.getElementById(id);
const site = window.kitty.site;
const origin = new URLSearchParams(location.search).get('origin') || '';

const PERMISSION_NAMES = {
  camera: [t('Câmera'), t('Usar a câmera')],
  microphone: [t('Microfone'), t('Usar o microfone')],
  geolocation: [t('Localização'), t('Saber onde você está')],
  notifications: [t('Notificações'), t('Mostrar notificações')],
  midi: [t('Dispositivos MIDI'), t('Usar dispositivos MIDI')],
  midiSysex: [t('Controle MIDI'), t('Controlar e reprogramar dispositivos MIDI')],
  'clipboard-read': [t('Área de transferência'), t('Ler o que você copiou')],
  'idle-detection': [t('Detecção de ausência'), t('Saber quando você não está usando o computador')],
  'window-management': [t('Gerenciar janelas'), t('Abrir e posicionar janelas nas suas telas')],
  'storage-access': [t('Cookies em outros sites'), t('Usar seus cookies quando estiver embutido em outro site')],
  'top-level-storage-access': [t('Cookies em outros sites'), t('Usar seus cookies em sites relacionados')],
  hid: [t('Dispositivos HID'), t('Acessar teclados, controles e outros dispositivos')],
  serial: [t('Portas seriais'), t('Acessar portas seriais')],
  usb: [t('Dispositivos USB'), t('Acessar dispositivos USB')],
  speaker: [t('Saída de áudio'), t('Escolher onde o som toca')],
  'speaker-selection': [t('Saída de áudio'), t('Escolher onde o som toca')],
  keyboardLock: [t('Captura do teclado'), t('Usar atalhos do teclado que seriam do sistema')],
  openExternal: [t('Abrir aplicativos externos'), t('Abrir links em outros aplicativos')],
};

const CHOICES = [
  ['ask', t('Perguntar')],
  ['allow', t('Permitir')],
  ['deny', t('Bloquear')],
];

let busy = false;

function permissionRow(p) {
  const [name, detail] = PERMISSION_NAMES[p.name] || [p.name, ''];
  const row = document.createElement('label');
  row.className = 'row';
  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = name;
  const small = document.createElement('small');
  small.textContent = detail;
  text.append(strong, small);
  const select = document.createElement('select');
  for (const [value, label] of CHOICES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = p.value;
  select.addEventListener('change', () => change('permission', { name: p.name, value: select.value }));
  row.append(text, select);
  return row;
}

function render(info) {
  if (!info) {
    $('invalid').hidden = false;
    $('content').hidden = true;
    return;
  }
  document.title = `${info.host} · ${t('Configurações do site')}`;
  $('host').textContent = info.host;
  $('origin').textContent = info.origin;
  $('private-note').hidden = !info.isPrivate;
  $('content').hidden = false;
  $('permissions').replaceChildren(...info.permissions.map(permissionRow));
  $('shield').checked = info.shieldUp;
  const fp = $('fingerprint');
  fp.checked = info.fingerprint.enabled && info.shieldUp && info.fingerprint.site;
  fp.disabled = !info.fingerprint.enabled || !info.shieldUp;
  $('fingerprint-detail').textContent = !info.fingerprint.enabled
    ? t('Desligada para todos os sites nas Configurações')
    : !info.shieldUp
      ? t('Desligada junto com os escudos deste site')
      : t('Mistura ruído em canvas, áudio e dados do hardware para o site não identificar você');
  $('passwords').checked = info.passwords;
  $('passwords').disabled = info.isPrivate;
  $('cookies').textContent = info.cookies === 0 ? t('Nenhum cookie') : info.cookies === 1 ? '1 cookie' : `${info.cookies} cookies`;
  $('site').textContent = info.site || info.host;
}

async function change(key, value, message) {
  if (busy) return;
  busy = true;
  try {
    render(await site.set(origin, key, value));
    if (message) {
      $('done').textContent = message;
      $('done').hidden = false;
      setTimeout(() => ($('done').hidden = true), 2500);
    }
  } finally {
    busy = false;
  }
}

$('shield').addEventListener('change', (e) => change('shield', e.target.checked));
$('fingerprint').addEventListener('change', (e) => change('fingerprint', e.target.checked));
$('passwords').addEventListener('change', (e) => change('passwords', e.target.checked));
$('clear').addEventListener('click', () => {
  if (confirm(t('Apagar os cookies e os dados deste site? Você vai sair da sua conta nele.'))) change('clear-data', null);
});
$('reset').addEventListener('click', () => change('reset', null, t('Pronto, tudo voltou ao padrão.')));

site.get(origin).then(render);
