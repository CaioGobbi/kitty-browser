'use strict';

const $ = (id) => document.getElementById(id);
const site = window.kitty.site;
const origin = new URLSearchParams(location.search).get('origin') || '';

const PERMISSION_NAMES = {
  camera: ['Câmera', 'Usar a câmera'],
  microphone: ['Microfone', 'Usar o microfone'],
  geolocation: ['Localização', 'Saber onde você está'],
  notifications: ['Notificações', 'Mostrar notificações'],
  midi: ['Dispositivos MIDI', 'Usar dispositivos MIDI'],
  midiSysex: ['Controle MIDI', 'Controlar e reprogramar dispositivos MIDI'],
  'clipboard-read': ['Área de transferência', 'Ler o que você copiou'],
  'idle-detection': ['Detecção de ausência', 'Saber quando você não está usando o computador'],
  'window-management': ['Gerenciar janelas', 'Abrir e posicionar janelas nas suas telas'],
  'storage-access': ['Cookies em outros sites', 'Usar seus cookies quando estiver embutido em outro site'],
  'top-level-storage-access': ['Cookies em outros sites', 'Usar seus cookies em sites relacionados'],
  hid: ['Dispositivos HID', 'Acessar teclados, controles e outros dispositivos'],
  serial: ['Portas seriais', 'Acessar portas seriais'],
  usb: ['Dispositivos USB', 'Acessar dispositivos USB'],
  speaker: ['Saída de áudio', 'Escolher onde o som toca'],
  'speaker-selection': ['Saída de áudio', 'Escolher onde o som toca'],
  keyboardLock: ['Captura do teclado', 'Usar atalhos do teclado que seriam do sistema'],
  openExternal: ['Abrir aplicativos externos', 'Abrir links em outros aplicativos'],
};

const CHOICES = [
  ['ask', 'Perguntar'],
  ['allow', 'Permitir'],
  ['deny', 'Bloquear'],
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
  document.title = `${info.host} · Configurações do site`;
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
    ? 'Desligada para todos os sites nas Configurações'
    : !info.shieldUp
      ? 'Desligada junto com os escudos deste site'
      : 'Mistura ruído em canvas, áudio e dados do hardware para o site não identificar você';
  $('passwords').checked = info.passwords;
  $('passwords').disabled = info.isPrivate;
  $('cookies').textContent = info.cookies === 0 ? 'Nenhum cookie' : info.cookies === 1 ? '1 cookie' : `${info.cookies} cookies`;
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
  if (confirm('Apagar os cookies e os dados deste site? Você vai sair da sua conta nele.')) change('clear-data', null);
});
$('reset').addEventListener('click', () => change('reset', null, 'Pronto, tudo voltou ao padrão.'));

site.get(origin).then(render);
