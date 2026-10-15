'use strict';

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const filter = document.getElementById('filter');

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

const folderOf = (b) => (Array.isArray(b.folder) ? b.folder.join(' › ') : '');

function entry(b) {
  const row = document.createElement('div');
  row.className = 'entry';

  const link = document.createElement('a');
  link.href = b.url;
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
      title.contentEditable = 'true';
      title.focus();
      document.getSelection().selectAllChildren(title);
      link.addEventListener('click', (e) => e.preventDefault(), { once: true });
      const save = async () => {
        title.contentEditable = 'false';
        await window.kitty.renameBookmark(b.id, title.textContent.trim());
        render();
      };
      title.addEventListener('blur', save, { once: true });
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          title.blur();
        }
      });
    }),
    button('✕', 'Remover dos favoritos', async () => {
      await window.kitty.removeBookmark(b.id);
      render();
    }),
  );

  row.append(icon(b), link, actions);
  return row;
}

async function render() {
  const q = filter.value.toLowerCase();
  const items = (await window.kitty.bookmarks()).filter(
    (b) =>
      !q ||
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      folderOf(b).toLowerCase().includes(q),
  );
  list.replaceChildren();
  empty.hidden = items.length > 0;

  // Bookmarks without a folder first, then one group per folder, in the order they were saved.
  const groups = new Map([['', []]]);
  for (const b of items) {
    const key = folderOf(b);
    (groups.get(key) ?? groups.set(key, []).get(key)).push(b);
  }
  for (const [folder, bookmarks] of groups) {
    if (!bookmarks.length) continue;
    if (folder) {
      const heading = document.createElement('h2');
      heading.textContent = folder;
      list.append(heading);
    }
    for (const b of bookmarks) list.append(entry(b));
  }
}

if (window.kitty.platform !== 'darwin') empty.textContent = empty.textContent.replace('⌘D', 'Ctrl+D');

filter.addEventListener('input', render);
render();
