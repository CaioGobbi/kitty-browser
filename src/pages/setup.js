'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

// kitty://setup: the first page Kitty shows. Until the person finishes it,
// Kitty makes no connection by itself (list and app updates, Widevine,
// search suggestions); the choices made here release them.
const $ = (id) => document.getElementById(id);
const settings = window.kitty.settings;

const ENGINE_NOTES = {
  duckduckgo: t('Não guarda o que você pesquisa'),
  brave: t('Índice próprio, não guarda o que você pesquisa'),
  startpage: t('Resultados do Google sem rastreamento (sem sugestões)'),
  ecosia: t('Usa a receita para plantar árvores'),
  google: t('Guarda o que você pesquisa para personalizar anúncios'),
};

const steps = [...document.querySelectorAll('.step')];
const dots = [...document.querySelectorAll('.dots li')];
let current = 0;
let snapshot = null;

function show(index) {
  current = Math.max(0, Math.min(steps.length - 1, index));
  steps.forEach((s, i) => (s.hidden = i !== current));
  dots.forEach((d, i) => d.classList.toggle('on', i === current));
  steps[current].querySelector('.primary')?.focus();
}

for (const b of document.querySelectorAll('[data-next]')) b.addEventListener('click', () => show(current + 1));
for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => show(current - 1));

function chosenEngine() {
  return document.querySelector('#engines input:checked')?.value || 'duckduckgo';
}

function updateSuggest() {
  const hasSuggest = snapshot.engines.find((e) => e.id === chosenEngine())?.suggest;
  $('searchSuggestions').disabled = !hasSuggest;
  $('suggest-hint').textContent = hasSuggest
    ? t('Envia ao buscador o que você digita na barra de endereço, para sugerir termos. Nunca em janelas privativas.')
    : t('Este buscador não oferece sugestões.');
}

function render(s) {
  snapshot = s;
  const language = $('language');
  if (!language.options.length) language.append(...s.languages.map((l) => new Option(l.name, l.id)));
  language.value = s.values.language;
  if (s.setup.for === 'update') {
    $('welcome-title').textContent = t('O Kitty agora pergunta antes');
    $('welcome-text').textContent =
      t('Nesta versão, nada se conecta sozinho sem a sua escolha. Suas escolhas atuais já vêm marcadas: é só conferir.');
  }

  $('engines').replaceChildren(
    ...s.engines.map((e) => {
      const label = document.createElement('label');
      label.className = 'choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'engine';
      input.value = e.id;
      input.checked = e.id === s.values.searchEngine;
      input.addEventListener('change', updateSuggest);
      const text = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = e.name;
      const note = document.createElement('small');
      note.textContent = ENGINE_NOTES[e.id] || '';
      text.append(name, note);
      label.append(input, text);
      return label;
    }),
  );
  $('searchSuggestions').checked = s.values.searchSuggestions;
  updateSuggest();

  $('autoUpdateLists').checked = s.values.autoUpdateLists;
  $('autoUpdate').checked = s.values.autoUpdate;
  $('widevine').checked = s.values.widevine;
  $('widevine-later').hidden = s.widevineActive;
  $('update-row').hidden = !s.update.supported;
  $('update-note').hidden = s.update.supported;
  $('update-note').textContent = t('A atualização automática do Kitty funciona só no app instalado.');
}

// ---- Import (same flow as in Settings)
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
  select.replaceChildren(...sources.map((s) => option(s.id, s.name)), ...blocked.map((name) => option(BLOCKED + name, `🔒 ${name}`)));
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  const any = sources.length + blocked.length > 0;
  $('import-box').hidden = !any;
  $('import-hint').textContent = any
    ? t('Copia favoritos e histórico salvos neste computador. Nada é enviado pela internet. Se não quiser, é só seguir.')
    : t('Nenhum outro navegador encontrado neste computador. Dá para importar depois, em Configurações.');
  updateImportChoice();
}

function updateImportChoice() {
  const value = $('import-source').value;
  const blockedName = value.startsWith(BLOCKED) ? value.slice(BLOCKED.length) : null;
  $('import-blocked').hidden = !blockedName;
  if (blockedName) {
    $('import-blocked').textContent =
      t('O macOS não deixa o Kitty ler os dados do {browser}. Para liberar, ative o Kitty em {path} e volte para esta tela.', { browser: blockedName, path: PRIVACY_PATH });
  }
  $('import').textContent = blockedName ? t('Dar permissão') : t('Importar');
  $('import').disabled = !value;
}

$('import-source').addEventListener('change', () => {
  $('import-status').textContent = '';
  updateImportChoice();
});
window.addEventListener('focus', loadImportSources);

$('import').addEventListener('click', async (e) => {
  if ($('import-source').value.startsWith(BLOCKED)) return settings.importOpenPrivacy();
  const kinds = [...document.querySelectorAll('.checks input:checked')].map((i) => i.value);
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
    status.textContent = t('Nada novo para importar.');
    return;
  }
  const parts = [];
  if (kinds.includes('bookmarks')) parts.push(r.bookmarks === 1 ? t('1 favorito') : t('{n} favoritos', { n: r.bookmarks }));
  if (kinds.includes('history')) parts.push(r.history === 1 ? t('1 página do histórico') : t('{n} páginas do histórico', { n: r.history }));
  status.textContent = t('Importado: {what}.', { what: parts.join(` ${t('e')} `) });
});

$('finish').addEventListener('click', async (e) => {
  e.target.disabled = true;
  await settings.finishSetup({
    searchEngine: chosenEngine(),
    searchSuggestions: $('searchSuggestions').checked,
    autoUpdateLists: $('autoUpdateLists').checked,
    autoUpdate: $('autoUpdate').checked,
    widevine: $('widevine').checked,
  });
  location.replace('kitty://newtab');
});

// Kitty reloads this page in the new language.
$('language').addEventListener('change', (e) => settings.set('language', e.target.value));

settings.get().then((s) => {
  render(s);
  show(0);
});
loadImportSources();
