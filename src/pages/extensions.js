'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

const $ = (id) => document.getElementById(id);
const api = window.kitty.extensions;

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function button(label, onClick, cls = '') {
  const b = make('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}

function render(snapshot) {
  if (!snapshot) return;
  const list = snapshot.extensions;
  $('empty').hidden = list.length > 0;
  $('auto').checked = snapshot.autoUpdate;
  $('list').replaceChildren(
    ...list.map((ext) => {
      const card = make('div', ext.enabled ? 'ext' : 'ext off');
      let icon;
      if (ext.icon) {
        icon = new Image();
        icon.src = ext.icon;
        icon.alt = '';
      } else icon = make('span', 'letter', ext.name.charAt(0));
      const info = make('div', 'info');
      const name = make('div', 'name', ext.name);
      name.append(make('span', 'version', ext.version));
      const actions = make('div', 'actions');
      if (ext.enabled && ext.hasOptions) actions.append(button(t('Opções'), () => api.options(ext.id)));
      if (ext.enabled) actions.append(button(ext.pinned ? t('Desafixar da barra') : t('Fixar na barra'), async () => render(await api.pin(ext.id, !ext.pinned))));
      actions.append(
        button(t('Remover'), async () => {
          if (confirm(t('Remover “{name}”? A extensão e os dados que ela guardou serão apagados.', { name: ext.name }))) render(await api.remove(ext.id));
        }, 'danger'),
      );
      info.append(name, make('div', 'desc', ext.description), actions);
      const toggle = make('input', 'toggle');
      toggle.type = 'checkbox';
      toggle.checked = ext.enabled;
      toggle.title = ext.enabled ? t('Desligar') : t('Ligar');
      toggle.addEventListener('change', async () => render(await api.enable(ext.id, toggle.checked)));
      card.append(icon, info, toggle);
      return card;
    }),
  );
}

$('store').addEventListener('click', () => api.store());
$('auto').addEventListener('change', async () => render(await api.setAutoUpdate($('auto').checked)));
$('update').addEventListener('click', async (e) => {
  e.preventDefault();
  $('update').disabled = true;
  $('update').textContent = t('Procurando…');
  render(await api.update());
  $('update').disabled = false;
  $('update').textContent = t('Procurar atualizações');
});
api.list().then(render);
// Installs and removals from elsewhere (the toolbar, the Web Store).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) api.list().then(render);
});
