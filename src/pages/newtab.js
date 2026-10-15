'use strict';

const q = document.getElementById('q');
q.focus();

let searchUrl = 'https://duckduckgo.com/?q=';

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (text) location.href = searchUrl + encodeURIComponent(text);
});

function formatSaved(blocked) {
  // Rough estimate, like Brave: ~50 ms of load time saved per blocked request.
  const seconds = Math.round(blocked * 0.05);
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace('.', ',')} h`;
}

window.kitty.context().then((ctx) => {
  if (!ctx) return;
  searchUrl = ctx.searchUrl;
  q.placeholder = `Pesquise com ${ctx.engineName}`;
  document.body.classList.toggle('private', ctx.isPrivate);
  document.getElementById('private-note').hidden = !ctx.isPrivate;
  if (ctx.isPrivate) document.title = 'Janela privativa';
});

window.kitty.stats().then((stats) => {
  if (!stats) return;
  document.getElementById('blocked').textContent = stats.blockedTotal.toLocaleString('pt-BR');
  document.getElementById('saved').textContent = formatSaved(stats.blockedTotal);

  const recent = document.getElementById('recent');
  for (const site of stats.recent) {
    const a = document.createElement('a');
    a.className = 'site';
    a.href = site.url;
    a.title = site.title;
    const letter = document.createElement('span');
    letter.className = 'letter';
    letter.textContent = site.host.charAt(0) || '?';
    if (site.favicon) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = site.favicon;
      // Broken icon: keep the letter.
      img.addEventListener('error', () => {
        letter.classList.remove('has-icon');
        letter.textContent = site.host.charAt(0) || '?';
      });
      // The icon replaces the letter: both in the box would stack and push the
      // icon off center.
      letter.classList.add('has-icon');
      letter.replaceChildren(img);
    }
    const name = document.createElement('span');
    name.textContent = site.host;
    a.append(letter, name);
    recent.append(a);
  }
  recent.hidden = stats.recent.length === 0;
});
