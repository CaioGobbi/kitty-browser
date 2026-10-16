'use strict';

const $ = (id) => document.getElementById(id);
const api = window.kitty.passwords;
let snapshot = { logins: [], never: [], available: true };
let editing = null; // id of the login being edited

const hostOf = (origin) => origin.replace(/^https?:\/\//, '').replace(/^www\./, '');

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function button(label, title, onClick, cls = '') {
  const b = make('button', cls, label);
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function icon(login) {
  if (login.icon) {
    const img = new Image();
    img.src = login.icon;
    return img;
  }
  return make('span', 'letter', hostOf(login.origin).charAt(0) || '•');
}

let toastTimer = null;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = make('div', 'toast', text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 1800);
}

function row(login) {
  const r = make('div', 'entry');
  const site = make('a', 'site');
  site.href = login.origin;
  site.append(make('span', 'host', hostOf(login.origin)));
  const user = make('span', login.username ? 'user' : 'user none', login.username || 'sem nome de usuário');
  const secret = make('span', 'secret', '••••••••');
  let shown = false;
  const show = button('Mostrar', 'Mostrar a senha', async () => {
    if (shown) {
      secret.textContent = '••••••••';
      show.textContent = 'Mostrar';
      shown = false;
      return;
    }
    const password = await api.reveal(login.id);
    if (password == null) return;
    secret.textContent = password;
    show.textContent = 'Ocultar';
    shown = true;
  });
  const actions = make('div', 'actions');
  actions.append(
    show,
    button('Copiar', 'Copiar a senha', async () => {
      if (await api.copy(login.id)) toast('Senha copiada');
    }),
    button('Editar', 'Editar', () => {
      editing = login.id;
      render();
    }),
    button('Apagar', 'Apagar esta senha', async () => {
      if (!confirm(`Apagar a senha de ${login.username || 'sem nome de usuário'} em ${hostOf(login.origin)}?`)) return;
      snapshot = await api.remove(login.id);
      render();
    }, 'remove'),
  );
  r.append(icon(login), site, user, secret, actions);
  return r;
}

function editor(login) {
  const r = make('form', 'entry editing');
  const user = make('input');
  user.value = login.username;
  user.placeholder = 'Nome de usuário';
  user.autocomplete = 'off';
  const pass = make('input');
  pass.type = 'password';
  pass.placeholder = 'Nova senha (vazio mantém a atual)';
  pass.autocomplete = 'new-password';
  const error = make('div', 'error');
  error.hidden = true;
  r.append(icon(login), make('span', 'host', hostOf(login.origin)), user, pass,
    button('Cancelar', 'Cancelar', (e) => {
      e.preventDefault();
      editing = null;
      render();
    }),
    make('button', 'primary', 'Salvar'),
    error,
  );
  r.addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = await api.update(login.id, { username: user.value.trim(), password: pass.value });
    if (result?.error === 'duplicate') {
      error.textContent = 'Já existe uma senha salva com esse nome de usuário neste site.';
      error.hidden = false;
      return;
    }
    snapshot = result;
    editing = null;
    render();
    toast('Alterações salvas');
  });
  setTimeout(() => user.focus());
  return r;
}

function render() {
  const q = $('filter').value.trim().toLowerCase();
  const logins = snapshot.logins.filter((l) => !q || l.origin.toLowerCase().includes(q) || l.username.toLowerCase().includes(q));
  $('list').replaceChildren(...logins.map((l) => (l.id === editing ? editor(l) : row(l))));
  $('empty').hidden = snapshot.logins.length > 0;
  $('unavailable').hidden = snapshot.available;
  $('never-section').hidden = snapshot.never.length === 0;
  $('never').replaceChildren(
    ...snapshot.never.map((origin) => {
      const r = make('div', 'entry');
      r.append(make('span', 'user', hostOf(origin)), button('Remover', 'Voltar a oferecer salvar neste site', async () => {
        snapshot = await api.removeNever(origin);
        render();
      }));
      return r;
    }),
  );
}

async function load() {
  snapshot = await api.list();
  const where = { darwin: 'pelo Keychain do macOS', win32: 'pela proteção de dados do Windows' }[snapshot.platform] || 'pelo sistema';
  $('note').textContent = `As senhas ficam só neste computador, criptografadas ${where}. Nada é enviado pela internet.`;
  render();
}

$('filter').addEventListener('input', render);
window.addEventListener('focus', () => editing == null && load());
load();
