'use strict';

// Site info panel: the button at the left of the address bar. The main view
// lists connection, fingerprinting protection, cookies and site data and site
// settings; the first three open a page of their own inside the panel.
// Uses showPopup/closePopup/openPopup and the helpers from ui.js.

const siteBtn = $('site-icon');
const sitePanel = $('site-panel');

const SITE_ICONS = {
  lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  insecure: '<svg viewBox="0 0 16 16"><path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6.4v3M8 11.2v.1"/></svg>',
  fingerprint:
    '<svg viewBox="0 0 16 16"><path d="M8 1.8 2.8 3.8v3.9c0 3.2 2.2 5.7 5.2 6.5 3-.8 5.2-3.3 5.2-6.5V3.8z"/><path d="M6 8.6c0-1.2.9-2.1 2-2.1s2 .9 2 2.1M8 8.4v2.2"/></svg>',
  cookie:
    '<svg viewBox="0 0 16 16"><path d="M13.6 8.4A5.6 5.6 0 1 1 7.6 2.4a2 2 0 0 0 2.6 2.4 2 2 0 0 0 3.4 3.6"/><path d="M5.6 7.2v.1M8 10.4v.1M5.8 10.4v.1M10.6 10v.1"/></svg>',
  gear:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/></svg>',
  chevron: '<svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg>',
  external: '<svg viewBox="0 0 16 16"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3.5h-9v-9H6"/></svg>',
  back: '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg>',
  close: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  kitty: '<svg class="kitty" viewBox="0 0 24 24"><path d="M4 3l4 4.5h8L20 3v9a8 8 0 0 1-16 0z"/></svg>',
  file: '<svg viewBox="0 0 16 16"><path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/></svg>',
};

let siteInfo = null;
let sitePage = 'main'; // main | connection | fingerprint | cookies
let confirmingClear = false;
let siteTabId = null;

function iconSpan(name, cls = 'si-icon') {
  const span = el('span', cls);
  span.innerHTML = SITE_ICONS[name];
  return span;
}

function headerButton(name, label, onClick) {
  const b = el('button', 'icon-btn small');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = SITE_ICONS[name];
  b.addEventListener('click', onClick);
  return b;
}

function siteHeader(title, { back = false } = {}) {
  const head = el('div', 'si-head');
  if (back) head.append(headerButton('back', t('Voltar'), () => showSitePage('main')));
  head.append(el('strong', 'si-title', title), headerButton('close', t('Fechar'), () => closePopup()));
  return head;
}

function siteRow({ icon, label, detail, trailing = 'chevron', onClick, tone }) {
  const row = el('button', 'si-row');
  row.type = 'button';
  if (tone) row.classList.add(tone);
  const text = el('span', 'si-text');
  text.append(el('span', 'si-label', label));
  if (detail) text.append(el('span', 'si-detail', detail));
  row.append(iconSpan(icon), text);
  if (trailing) row.append(iconSpan(trailing, 'si-trailing'));
  row.addEventListener('click', onClick);
  return row;
}

function para(text, cls = 'si-para') {
  return el('p', cls, text);
}

function switchRow(label, detail, checked, disabled, onChange) {
  const row = el('label', 'si-switch');
  const text = el('span', 'si-text');
  text.append(el('span', 'si-label', label));
  if (detail) text.append(el('span', 'si-detail', detail));
  const input = el('input', 'toggle');
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(text, input);
  return row;
}

function formatDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(api.lang, { day: 'numeric', month: 'long', year: 'numeric' });
}

function cookieCount(n) {
  return n === 0 ? t('Nenhum cookie') : n === 1 ? t('1 cookie') : t('{n} cookies', { n });
}

function connectionSummary(info) {
  if (info.kind === 'https') return info.certificate && !info.certificate.ok ? t('Certificado com problema') : t('A conexão é segura');
  return t('A conexão não é segura');
}

// ---- Pages

function renderSiteMain(info) {
  const nodes = [siteHeader(info.host)];
  if (info.kind === 'internal') {
    nodes.push(el('div', 'si-note', ''));
    nodes.at(-1).append(iconSpan('kitty'), el('span', '', t('Esta é uma página do próprio Kitty. Ela não sai do seu computador.')));
    return nodes;
  }
  if (info.kind === 'file') {
    nodes.push(el('div', 'si-note', ''));
    nodes.at(-1).append(iconSpan('file'), el('span', '', t('Este é um arquivo do seu computador.')));
    return nodes;
  }
  const secure = info.kind === 'https';
  nodes.push(
    siteRow({
      icon: secure ? 'lock' : 'insecure',
      label: connectionSummary(info),
      tone: secure ? null : 'warn',
      onClick: () => showSitePage('connection'),
    }),
    siteRow({
      icon: 'fingerprint',
      label: t('Proteção contra fingerprinting'),
      detail: fingerprintState(info).short,
      onClick: () => showSitePage('fingerprint'),
    }),
    siteRow({
      icon: 'cookie',
      label: t('Cookies e dados do site'),
      detail: cookieCount(info.cookies.count),
      onClick: () => showSitePage('cookies'),
    }),
    siteRow({
      icon: 'gear',
      label: t('Configurações do site'),
      trailing: 'external',
      onClick: () => {
        closePopup();
        api.siteAction({ op: 'settings' });
      },
    }),
  );
  return nodes;
}

function renderSiteConnection(info) {
  const nodes = [siteHeader(t('Segurança da conexão'), { back: true })];
  const c = info.certificate;
  if (info.kind === 'http') {
    const box = el('div', 'si-status warn');
    box.append(iconSpan('insecure'), el('strong', '', t('A conexão não é segura')));
    nodes.push(
      box,
      para(t('Não digite informações sensíveis neste site (senhas, cartões de crédito), porque quem estiver na mesma rede pode ler o que é enviado.')),
    );
    if (info.httpsFailed) nodes.push(para(t('O Kitty tentou abrir este site por HTTPS, mas ele não oferece uma conexão segura.'), 'si-para muted'));
    return nodes;
  }
  const problem = c && !c.ok;
  const box = el('div', `si-status ${problem ? 'warn' : 'ok'}`);
  box.append(iconSpan(problem ? 'insecure' : 'lock'), el('strong', '', connectionSummary(info)));
  nodes.push(
    box,
    para(
      problem
        ? t('O certificado deste site não pôde ser verificado. Tome cuidado com o que você envia aqui.')
        : t('Suas informações, como senhas e números de cartão, ficam privadas quando são enviadas a este site.'),
    ),
  );
  if (!c) {
    nodes.push(para(t('Os dados do certificado aparecem depois que o Kitty abre uma conexão nova com o site. Recarregue a página para ver.'), 'si-para muted'));
    return nodes;
  }
  const list = el('dl', 'si-cert');
  const add = (term, value) => value && list.append(el('dt', '', term), el('dd', '', value));
  add(t('Emitido para'), c.subject + (c.organization ? ` (${c.organization})` : ''));
  add(t('Emitido por'), c.issuer + (c.issuerOrganization && c.issuerOrganization !== c.issuer ? ` (${c.issuerOrganization})` : ''));
  add(t('Válido de'), formatDate(c.validStart));
  add(t('Válido até'), formatDate(c.validExpiry));
  add(t('Impressão digital'), c.fingerprint.replace(/^sha256\//, 'SHA-256 ').slice(0, 60));
  nodes.push(el('h4', 'si-sub', t('Certificado')), list);
  return nodes;
}

function fingerprintState(info) {
  const f = info.fingerprint;
  if (!f.enabled) return { on: false, locked: true, short: t('Desligada nas configurações'), why: t('A proteção está desligada para todos os sites nas configurações do Kitty.') };
  if (!info.shieldUp) return { on: false, locked: true, short: t('Desligada (escudos desativados)'), why: t('Os escudos do Kitty estão desativados neste site, e a proteção vai junto. Reative os escudos para usá-la.') };
  return f.site ? { on: true, short: t('Ativada') } : { on: false, short: t('Desativada neste site') };
}

function renderSiteFingerprint(info) {
  const state = fingerprintState(info);
  const nodes = [
    siteHeader(t('Proteção contra fingerprinting'), { back: true }),
    para(t('Sites podem identificar você sem cookies, lendo detalhes do navegador e do computador (desenho em canvas, áudio, placa de vídeo, telas). O Kitty mistura um ruído imperceptível nesses dados, diferente em cada site, para que eles não sirvam de impressão digital.')),
    switchRow(
      t('Proteger neste site'),
      state.locked ? state.why : t('Se algo no site não funcionar direito, desligue só aqui. A página recarrega.'),
      state.on,
      !!state.locked,
      async (on) => renderSitePanel(await api.siteAction({ op: 'fingerprint', on })),
    ),
  ];
  return nodes;
}

function formatSize(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toLocaleString(api.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
}

function renderSiteCookies(info) {
  const nodes = [siteHeader(t('Cookies e dados do site'), { back: true })];
  const summary = el('div', 'si-facts');
  const fact = (label, value) => {
    const row = el('div', 'si-fact');
    row.append(el('span', '', label), el('strong', '', value));
    summary.append(row);
  };
  fact(t('Cookies'), String(info.cookies.count));
  fact(t('Outros dados guardados'), formatSize(info.storage));
  fact(t('Cookies de terceiros'), info.thirdPartyCookiesBlocked ? t('Bloqueados') : t('Permitidos'));
  nodes.push(summary);

  if (info.cookies.domains.length) {
    nodes.push(el('h4', 'si-sub', t('Cookies por endereço')));
    const list = el('div', 'si-domains');
    for (const d of info.cookies.domains.slice(0, 8)) {
      const row = el('div', 'si-fact');
      row.append(el('span', '', d.domain), el('span', 'muted', String(d.count)));
      list.append(row);
    }
    nodes.push(list);
  }
  nodes.push(
    para(
      info.isPrivate
        ? t('Numa janela privativa, tudo isso é apagado quando você fecha a janela.')
        : t('Inclui o que {site} guardou neste computador: cookies (que mantêm você conectado), armazenamento local, bancos de dados e cache.', { site: info.site || info.host }),
      'si-para muted',
    ),
  );

  const actions = el('div', 'si-actions');
  if (!confirmingClear) {
    const clear = el('button', 'btn danger', t('Apagar dados do site'));
    clear.type = 'button';
    clear.disabled = info.cookies.count === 0 && !info.storage;
    clear.addEventListener('click', () => {
      confirmingClear = true;
      renderSitePanel(siteInfo);
    });
    actions.append(clear);
  } else {
    actions.append(el('span', 'si-confirm', t('Você vai sair da sua conta neste site. Apagar?')));
    const cancel = el('button', 'btn', t('Cancelar'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      confirmingClear = false;
      renderSitePanel(siteInfo);
    });
    const ok = el('button', 'btn primary danger-bg', t('Apagar'));
    ok.type = 'button';
    ok.addEventListener('click', async () => {
      confirmingClear = false;
      renderSitePanel(await api.siteAction({ op: 'clear-data' }));
    });
    actions.append(cancel, ok);
  }
  nodes.push(actions);
  return nodes;
}

const SITE_PAGES = {
  main: renderSiteMain,
  connection: renderSiteConnection,
  fingerprint: renderSiteFingerprint,
  cookies: renderSiteCookies,
};

function renderSitePanel(info) {
  if (!info) return closePopup();
  siteInfo = info;
  const isWeb = info.kind === 'https' || info.kind === 'http';
  if (!isWeb) sitePage = 'main';
  sitePanel.dataset.page = sitePage;
  sitePanel.replaceChildren(...SITE_PAGES[sitePage](info));
}

function showSitePage(page) {
  sitePage = page;
  confirmingClear = false;
  renderSitePanel(siteInfo);
  sitePanel.querySelector('.si-head button:not([aria-label="Voltar"]), .si-row')?.focus({ preventScroll: true });
}

async function openSitePanel() {
  if (openPopup === sitePanel) return closePopup();
  const info = await api.siteInfo();
  if (!info) return;
  sitePage = 'main';
  confirmingClear = false;
  siteTabId = state.activeTabId;
  renderSitePanel(info);
  const r = siteBtn.getBoundingClientRect();
  showPopup(sitePanel, { left: `${Math.max(8, Math.min(r.left - 4, window.innerWidth - 348))}px`, top: `${r.bottom + 8}px` });
  siteBtn.classList.add('open');
}

siteBtn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the address bar as it is
siteBtn.addEventListener('click', openSitePanel);

// Closed from anywhere (scrim, Esc, another popup): the button stops looking pressed.
new MutationObserver(() => siteBtn.classList.toggle('open', !sitePanel.hidden)).observe(sitePanel, {
  attributes: true,
  attributeFilter: ['hidden'],
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || openPopup !== sitePanel) return;
  if (sitePage !== 'main') showSitePage('main');
  else closePopup();
});

api.onState(() => {
  siteBtn.disabled = siteBtn.dataset.kind === 'search';
  siteBtn.title = siteBtn.dataset.kind === 'insecure' ? t('Não seguro: ver informações do site') : t('Informações do site');
  // Another tab, or the page went somewhere else: the panel no longer applies.
  if (openPopup === sitePanel && (state.activeTabId !== siteTabId || activeTab()?.url !== siteInfo?.url)) {
    if (activeTab()?.loading) return;
    closePopup();
  }
});
