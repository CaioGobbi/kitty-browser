'use strict';

// Bookmarks and folders come in one list, in order (see main/bookmarks.js):
// `folder` is the path of folder names an item lives in, folders have
// `type: 'folder'`, and imported ones that weren't on the other browser's bar
// (`bar: false`) are grouped under "Outros favoritos".

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const filter = document.getElementById('filter');

const BAR_NAME = 'Barra de favoritos';
const OTHER_NAME = 'Outros favoritos';

let items = [];
let draggedId = null;

const isFolder = (b) => b.type === 'folder';
const onBar = (b) => b.bar !== false;
const pathOf = (b) => (Array.isArray(b.folder) ? b.folder : []);
const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What's directly inside a folder, or at the top level (of the bar, or of "Outros favoritos"). */
function childrenOf(folder, bar = true) {
  const path = folder ? [...pathOf(folder), folder.title] : [];
  const side = folder ? onBar(folder) : bar;
  return items.filter((b) => onBar(b) === side && samePath(pathOf(b), path));
}

/** Every group to show, in order: the bar, its folders (depth first), then "Outros favoritos". */
function groups() {
  const result = [];
  const walk = (folder, bar, label) => {
    result.push({ folder, bar, label, entries: childrenOf(folder, bar).filter((b) => !isFolder(b)) });
    for (const sub of childrenOf(folder, bar).filter(isFolder)) walk(sub, bar, [...label, sub.title]);
  };
  walk(null, true, [BAR_NAME]);
  walk(null, false, [OTHER_NAME]);
  return result;
}

const run = async (op) => {
  const result = await window.kitty.bookmarkOp(op);
  await render();
  return result;
};

function icon(bookmark) {
  if (bookmark.favicon) {
    const img = new Image();
    img.src = bookmark.favicon;
    img.onerror = () => img.replaceWith(letter(bookmark));
    return img;
  }
  return letter(bookmark);
}

function letter(bookmark) {
  const span = document.createElement('span');
  span.className = 'letter';
  try {
    span.textContent = new URL(bookmark.url).hostname.replace(/^www\./, '').charAt(0);
  } catch {
    span.textContent = '•';
  }
  return span;
}

function button(label, title, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** Edits a piece of text in place; `save` gets the new text when Enter is pressed or focus leaves. */
function editInPlace(node, save) {
  node.contentEditable = 'true';
  node.focus();
  document.getSelection().selectAllChildren(node);
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    node.contentEditable = 'false';
    if (keep) save(node.textContent.trim());
    else render();
  };
  node.addEventListener('blur', () => finish(true), { once: true });
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
}

/** "Mover para…": every folder, plus the bar and "Outros favoritos" themselves. */
function moveSelect(b) {
  const select = document.createElement('select');
  select.title = 'Mover para outra pasta';
  const placeholder = new Option('Mover para…', '');
  placeholder.disabled = true;
  select.append(placeholder);
  for (const g of groups()) {
    const option = new Option(g.label.join(' › '), JSON.stringify({ parentId: g.folder?.id ?? null, bar: g.bar }));
    select.append(option);
  }
  select.value = '';
  select.addEventListener('change', () => {
    const { parentId, bar } = JSON.parse(select.value);
    run({ op: 'move', id: b.id, parentId, bar });
  });
  return select;
}

function entry(b, group) {
  const row = document.createElement('div');
  row.className = 'entry';
  row.draggable = true;
  row.dataset.id = b.id;

  const link = document.createElement('a');
  link.href = b.url;
  link.draggable = false;
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = b.title;
  const host = document.createElement('span');
  host.className = 'host';
  try {
    host.textContent = new URL(b.url).hostname.replace(/^www\./, '');
  } catch {}
  link.append(title, host);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    button('✎', 'Renomear', () => {
      link.addEventListener('click', (e) => e.preventDefault(), { once: true });
      editInPlace(title, (text) => run({ op: 'update', id: b.id, title: text, url: b.url }));
    }),
    moveSelect(b),
    button('✕', 'Excluir', () => run({ op: 'remove', id: b.id })),
  );

  row.append(icon(b), link, actions);
  dropTarget(row, (e) => {
    const r = row.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    const siblings = group.entries;
    const next = after ? siblings[siblings.indexOf(b) + 1] : b;
    return { parentId: group.folder?.id ?? null, bar: group.bar, beforeId: next?.id ?? null, mark: after ? 'drop-after' : 'drop-before' };
  });
  return row;
}

function heading(group) {
  const h = document.createElement('h2');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = group.label.join(' › ');
  h.append(name);
  const f = group.folder;
  if (f) {
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      button('Renomear', 'Renomear a pasta', () => {
        name.textContent = f.title;
        editInPlace(name, (text) => run({ op: 'update', id: f.id, title: text }));
      }),
      button('Excluir', 'Excluir a pasta e o que tem dentro', () => {
        const count = items.filter((b) => b !== f && onBar(b) === onBar(f) && [...pathOf(f), f.title].every((n, i) => pathOf(b)[i] === n)).length;
        if (count && !confirm(`Excluir a pasta "${f.title}" e os ${count} itens dentro dela?`)) return;
        run({ op: 'remove', id: f.id });
      }),
    );
    h.append(actions);
    h.draggable = true;
    h.dataset.id = f.id;
  }
  // Dropping on a folder's name puts the item at the end of that folder.
  dropTarget(h, () => ({ parentId: f?.id ?? null, bar: group.bar, beforeId: null, mark: 'drop-into' }));
  return h;
}

function dropTarget(node, spotAt) {
  node.addEventListener('dragover', (e) => {
    if (!draggedId || draggedId === node.dataset.id) return;
    e.preventDefault();
    clearMarks();
    node.classList.add(spotAt(e).mark);
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after', 'drop-into'));
  node.addEventListener('drop', (e) => {
    if (!draggedId || draggedId === node.dataset.id) return;
    e.preventDefault();
    const { parentId, bar, beforeId } = spotAt(e);
    const id = draggedId;
    clearMarks();
    run({ op: 'move', id, parentId, bar, beforeId: beforeId === id ? null : beforeId });
  });
}

function clearMarks() {
  for (const node of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) {
    node.classList.remove('drop-before', 'drop-after', 'drop-into');
  }
}

list.addEventListener('dragstart', (e) => {
  const node = e.target.closest?.('[data-id]');
  if (!node) return;
  draggedId = node.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', node.querySelector('a')?.href || node.textContent);
});
list.addEventListener('dragend', () => {
  draggedId = null;
  clearMarks();
});

async function render() {
  items = await window.kitty.bookmarks();
  const q = filter.value.toLowerCase();
  const matches = (b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q);
  list.replaceChildren();
  let shown = 0;
  for (const group of groups()) {
    const entries = group.entries.filter(matches);
    const label = group.label.join(' › ').toLowerCase();
    // Without a search every folder shows, even empty ones (so they can be filled or deleted);
    // "Outros favoritos" only when it has something.
    if (q ? !entries.length && !label.includes(q) : !group.folder && !group.bar && !group.entries.length) continue;
    list.append(heading(group));
    for (const b of entries) list.append(entry(b, group));
    shown += entries.length;
  }
  empty.hidden = shown > 0 || items.length > 0;
}

document.getElementById('new-folder').addEventListener('click', async () => {
  const { id } = await run({ op: 'addFolder', title: 'Nova pasta' });
  const h = id && list.querySelector(`h2[data-id="${CSS.escape(id)}"] .name`);
  if (!h) return;
  h.scrollIntoView({ block: 'center' });
  h.textContent = items.find((b) => b.id === id)?.title ?? h.textContent;
  editInPlace(h, (text) => run({ op: 'update', id, title: text }));
});

if (window.kitty.platform !== 'darwin') empty.textContent = empty.textContent.replace('⌘D', 'Ctrl+D');

filter.addEventListener('input', render);
window.addEventListener('focus', render); // the bar may have changed them meanwhile
render();
