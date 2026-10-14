'use strict';

const q = document.getElementById('q');
q.focus();

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (text) location.href = 'https://duckduckgo.com/?q=' + encodeURIComponent(text);
});

function formatSaved(blocked) {
  // Rough estimate, like Brave: ~50 ms of load time saved per blocked request.
  const seconds = Math.round(blocked * 0.05);
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace('.', ',')} h`;
}

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
    const name = document.createElement('span');
    name.textContent = site.host;
    a.append(letter, name);
    recent.append(a);
  }
  recent.hidden = stats.recent.length === 0;
});
