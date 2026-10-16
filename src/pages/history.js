'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const filter = document.getElementById('filter');

const dayFmt = new Intl.DateTimeFormat(window.kitty.lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(window.kitty.lang, { hour: '2-digit', minute: '2-digit' });

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t('Hoje');
  if (date.toDateString() === yesterday.toDateString()) return t('Ontem');
  return dayFmt.format(date);
}

async function render() {
  const entries = await window.kitty.history(filter.value);
  list.replaceChildren();
  empty.hidden = entries.length > 0;

  let currentDay = '';
  for (const entry of entries) {
    const date = new Date(entry.time);
    const day = dayLabel(date);
    if (day !== currentDay) {
      currentDay = day;
      const h2 = document.createElement('h2');
      h2.textContent = day;
      list.append(h2);
    }

    const row = document.createElement('div');
    row.className = 'entry';

    const time = document.createElement('time');
    time.textContent = timeFmt.format(date);

    const link = document.createElement('a');
    link.href = entry.url;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = entry.title;
    const host = document.createElement('span');
    host.className = 'host';
    try {
      host.textContent = new URL(entry.url).hostname.replace(/^www\./, '');
    } catch {}
    link.append(title, host);

    const remove = document.createElement('button');
    remove.title = t('Remover do histórico');
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      await window.kitty.removeHistory(entry.time);
      render();
    });

    row.append(time, link, remove);
    list.append(row);
  }
}

let debounce;
filter.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(render, 120);
});

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm(t('Apagar todo o histórico de navegação?'))) return;
  await window.kitty.clearHistory();
  render();
});

render();
