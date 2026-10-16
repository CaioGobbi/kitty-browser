'use strict';

const t = window.kitty.t; // the interface language (src/i18n)
window.kitty.translate(); // the static text, before this script reads or changes it

const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
const kind = params.get('kind');
let host = url;
try {
  host = new URL(url).hostname;
} catch {}

const COPY = {
  phishing: {
    title: t('Site falso à frente'),
    lead: t('<b></b> pode estar se passando por outro site para roubar suas senhas, dados de cartão ou outras informações.'),
    why: t('Este endereço está na lista pública de phishing mantida pelo projeto malware-filter, atualizada várias vezes ao dia.'),
  },
  malware: {
    title: t('Site perigoso à frente'),
    lead: t('<b></b> é conhecido por distribuir programas maliciosos ou golpes que podem danificar seu computador ou roubar seus dados.'),
    why: t('Este endereço está nas listas públicas de malware do URLhaus (abuse.ch) e do uBlock Origin, atualizadas várias vezes ao dia.'),
  },
};
const copy = COPY[kind] || COPY.malware;
document.title = copy.title;
document.getElementById('title').textContent = copy.title;
const lead = document.getElementById('lead');
lead.innerHTML = copy.lead; // static markup only; the host goes in as text below
lead.querySelector('b').textContent = host;
document.getElementById('why').textContent = copy.why;
document.getElementById('url').textContent = url;

document.getElementById('back').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.replace('kitty://newtab');
});
document.getElementById('proceed').addEventListener('click', async () => {
  if (await window.kitty.bypassThreat(url)) location.replace(url);
});
