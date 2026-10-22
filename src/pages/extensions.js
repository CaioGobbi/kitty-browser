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
  $('devmode').checked = snapshot.devMode;
  document.body.classList.toggle('devmode-on', snapshot.devMode);
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
      if (ext.unpacked) name.append(make('span', 'tag', t('Sem compactação')));
      info.append(name, make('div', 'desc', ext.description));
      if (snapshot.devMode) {
        info.append(make('div', 'dev', `${t('ID')}: ${ext.id}`));
        if (ext.unpacked) info.append(make('div', 'dev', `${t('Carregada de')}: ${ext.path}`));
      }
      if (ext.error) info.append(make('div', 'error', ext.error));
      const actions = make('div', 'actions');
      if (ext.enabled && ext.hasOptions) actions.append(button(t('Opções'), () => api.options(ext.id)));
      if (ext.enabled) actions.append(button(ext.pinned ? t('Desafixar da barra') : t('Fixar na barra'), async () => render(await api.pin(ext.id, !ext.pinned))));
      if (snapshot.devMode && ext.inspectable) actions.append(button(t('Inspecionar página de fundo'), () => api.inspect(ext.id)));
      if (snapshot.devMode && (ext.unpacked || ext.error)) actions.append(button(t('Recarregar'), async () => render(await api.reload(ext.id))));
      actions.append(
        button(t('Remover'), async () => {
          const question = ext.unpacked
            ? t('Remover “{name}”? O Kitty deixa de carregá-la, mas a pasta não é apagada.', { name: ext.name })
            : t('Remover “{name}”? A extensão e os dados que ela guardou serão apagados.', { name: ext.name });
          if (confirm(question)) render(await api.remove(ext.id));
        }, 'danger'),
      );
      info.append(actions);
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
$('devmode').addEventListener('change', async () => render(await api.setDevMode($('devmode').checked)));
$('unpacked').addEventListener('click', async () => render(await api.loadUnpacked()));
$('reload-all').addEventListener('click', async () => render(await api.reload(null)));
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
