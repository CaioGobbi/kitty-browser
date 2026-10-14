'use strict';

const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
let host = url;
try {
  host = new URL(url).hostname;
} catch {}
document.getElementById('detail').textContent = `O Kitty não conseguiu se conectar a ${host}.`;
document.getElementById('reason').textContent = params.get('reason') || '';
document.getElementById('retry').addEventListener('click', () => {
  if (/^https?:/.test(url)) location.replace(url);
});
