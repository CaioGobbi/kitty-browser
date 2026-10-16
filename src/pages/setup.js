'use strict';

// kitty://setup: the first page Kitty shows. Until the person finishes it,
// Kitty makes no connection by itself (list and app updates, Widevine,
// search suggestions); the choices made here release them.
const $ = (id) => document.getElementById(id);
const settings = window.kitty.settings;

const ENGINE_NOTES = {
  duckduckgo: 'Não guarda o que você pesquisa',
  brave: 'Índice próprio, não guarda o que você pesquisa',
  startpage: 'Resultados do Google sem rastreamento (sem sugestões)',
  ecosia: 'Usa a receita para plantar árvores',
  google: 'Guarda o que você pesquisa para personalizar anúncios',
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
    ? 'Envia ao buscador o que você digita na barra de endereço, para sugerir termos. Nunca em janelas privativas.'
    : 'Este buscador não oferece sugestões.';
}

function render(s) {
  snapshot = s;
  if (s.setup.for === 'update') {
    $('welcome-title').textContent = 'O Kitty agora pergunta antes';
    $('welcome-text').textContent =
      'Nesta versão, nada se conecta sozinho sem a sua escolha. Suas escolhas atuais já vêm marcadas: é só conferir.';
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
  $('update-note').textContent =
    s.platform === 'darwin'
      ? 'Atualizar o Kitty sozinho ainda não é possível no Mac (exige uma assinatura paga da Apple). As versões novas ficam no GitHub, para instalar manualmente.'
      : 'A atualização automática do Kitty funciona só no app instalado.';
}

// ---- Import (same flow as in Settings)
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
  select.replaceChildren(...sources.map((s) => option(s.id, s.name)), ...blocked.map((name) => option(BLOCKED + name, `🔒 ${name}`)));
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  const any = sources.length + blocked.length > 0;
  $('import-box').hidden = !any;
  $('import-hint').textContent = any
    ? 'Copia favoritos e histórico salvos neste computador. Nada é enviado pela internet. Se não quiser, é só seguir.'
    : 'Nenhum outro navegador encontrado neste computador. Dá para importar depois, em Configurações.';
  updateImportChoice();
}

function updateImportChoice() {
  const value = $('import-source').value;
  const blockedName = value.startsWith(BLOCKED) ? value.slice(BLOCKED.length) : null;
  $('import-blocked').hidden = !blockedName;
  if (blockedName) {
    $('import-blocked').textContent =
      `O macOS não deixa o Kitty ler os dados do ${blockedName}. Para liberar, ative o Kitty em ${PRIVACY_PATH} e volte para esta tela.`;
  }
  $('import').textContent = blockedName ? 'Dar permissão' : 'Importar';
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
  status.textContent = 'Importando…';
  const r = await settings.importRun($('import-source').value, kinds);
  e.target.disabled = false;
  if (!r || r.error) {
    status.textContent = r?.error || 'Não foi possível importar.';
    return;
  }
  if (!r.bookmarks && !r.history) {
    status.textContent = 'Nada novo para importar.';
    return;
  }
  const parts = [];
  if (kinds.includes('bookmarks')) parts.push(`${r.bookmarks} ${r.bookmarks === 1 ? 'favorito' : 'favoritos'}`);
  if (kinds.includes('history')) parts.push(`${r.history} ${r.history === 1 ? 'página' : 'páginas'} do histórico`);
  status.textContent = `Pronto: ${parts.join(' e ')}.`;
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

settings.get().then((s) => {
  render(s);
  show(0);
});
loadImportSources();
