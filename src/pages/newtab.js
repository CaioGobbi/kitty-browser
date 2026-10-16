'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

// No search box here: typing goes to the address bar, which gets the focus
// when a new tab opens (switchTab in window.js).

window.kitty.context().then((ctx) => {
  if (!ctx) return;
  document.body.classList.toggle('private', ctx.isPrivate);
  document.getElementById('private-note').hidden = !ctx.isPrivate;
  if (ctx.isPrivate) document.title = t('Janela privativa');
});

window.kitty.stats().then((stats) => {
  if (!stats) return;
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
