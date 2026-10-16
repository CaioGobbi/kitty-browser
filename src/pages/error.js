'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
let host = url;
try {
  host = new URL(url).hostname;
} catch {}
document.getElementById('detail').textContent = t('O Kitty não conseguiu se conectar a {host}.', { host });
document.getElementById('reason').textContent = params.get('reason') || '';
document.getElementById('retry').addEventListener('click', () => {
  if (/^https?:/.test(url)) location.replace(url);
});
