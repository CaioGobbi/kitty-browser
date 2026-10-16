'use strict';

// Editing bookmarks: the bookmarks bar, its folders and kitty://bookmarks.
//
// Bookmarks and folders share one list (`items`), in display order. Each item
// has `folder`, the path of folder names it lives in ([] = top level), and
// `bar`, false for imported ones that weren't on the other browser's bar
// (those only show in kitty://bookmarks, under "Outros favoritos").
// Folders are items with `type: 'folder'` and no url, so they keep their place
// and can be empty.

const { data } = require('./data');
const { t } = require('../i18n');

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const isFolder = (b) => b.type === 'folder';
const onBar = (b) => b.bar !== false;
const folderOf = (b) => (Array.isArray(b.folder) ? b.folder : []);
const pathOf = (f) => [...folderOf(f), f.title];
const samePath = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const startsWith = (p, prefix) => prefix.length <= p.length && prefix.every((x, i) => x === p[i]);

const items = () => data.bookmarks.get('items');
const find = (id) => items().find((b) => b.id === id);

/** The id of the folder a bookmark or folder lives in (null at the top level). */
function parentId(b) {
  const path = folderOf(b);
  if (!path.length) return null;
  return items().find((f) => isFolder(f) && onBar(f) === onBar(b) && samePath(pathOf(f), path))?.id ?? null;
}

/** Everything inside a folder, subfolders included. */
function descendants(folder) {
  const path = pathOf(folder);
  return items().filter((b) => b !== folder && onBar(b) === onBar(folder) && startsWith(folderOf(b), path));
}

/**
 * Gives every folder path its own folder item (imports only record paths),
 * right before the first bookmark inside it. Returns true when it changed anything.
 */
function ensureFolders() {
  const list = items();
  const key = (bar, path) => `${bar ? 1 : 0}${JSON.stringify(path)}`;
  const known = new Set(list.filter(isFolder).map((f) => key(onBar(f), pathOf(f))));
  const result = [];
  let changed = false;
  for (const b of list) {
    const path = folderOf(b);
    for (let n = 1; n <= path.length; n++) {
      const prefix = path.slice(0, n);
      if (known.has(key(onBar(b), prefix))) continue;
      known.add(key(onBar(b), prefix));
      result.push({ id: newId(), type: 'folder', title: prefix[n - 1], folder: prefix.slice(0, -1), bar: onBar(b), time: b.time || Date.now() });
      changed = true;
    }
    result.push(b);
  }
  if (changed) data.bookmarks.set('items', result);
  return changed;
}

/** Where new or moved items go: inside folder `parentId`, or at the top level (of the bar unless `bar` is false). */
function target(parentId, bar) {
  if (parentId == null) return { path: [], bar: bar !== false };
  const parent = find(parentId);
  if (!parent || !isFolder(parent)) return null;
  return { path: pathOf(parent), bar: onBar(parent) };
}

/** A folder name not taken by another folder in the same place ("Trabalho 2"...). */
function freeName(title, where, except) {
  const taken = new Set(
    items()
      .filter((b) => isFolder(b) && b !== except && onBar(b) === where.bar && samePath(folderOf(b), where.path))
      .map((f) => f.title),
  );
  let name = title;
  for (let n = 2; taken.has(name); n++) name = `${title} ${n}`;
  return name;
}

/** Puts `moving` (already out of the list) before `beforeId`, or at the end. */
function insert(list, moving, beforeId) {
  const at = beforeId ? list.findIndex((b) => b.id === beforeId) : -1;
  if (at === -1) list.push(...moving);
  else list.splice(at, 0, ...moving);
  data.bookmarks.set('items', list);
}

const cleanTitle = (title) => String(title ?? '').trim().slice(0, 300);

/** "kitty.app" → "https://kitty.app/"; null when it isn't a web address. */
function cleanUrl(url) {
  let text = String(url ?? '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const parsed = new URL(text);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname ? parsed.href : null;
  } catch {
    return null;
  }
}

function add({ title, url, parentId, bar, beforeId } = {}) {
  const where = target(parentId, bar);
  const href = cleanUrl(url);
  if (!where) return { error: t('Pasta não encontrada.') };
  if (!href) return { error: t('Endereço inválido.') };
  const bookmark = { id: newId(), url: href, title: cleanTitle(title) || href, favicon: null, time: Date.now(), bar: where.bar, folder: where.path };
  insert(items(), [bookmark], beforeId);
  return { id: bookmark.id };
}

function addFolder({ title, parentId, bar, beforeId } = {}) {
  const where = target(parentId, bar);
  if (!where) return { error: t('Pasta não encontrada.') };
  const folder = { id: newId(), type: 'folder', title: '', folder: where.path, bar: where.bar, time: Date.now() };
  folder.title = freeName(cleanTitle(title).slice(0, 100) || t('Nova pasta'), where, folder);
  insert(items(), [folder], beforeId);
  return { id: folder.id };
}

/** Moves a folder's contents along with it, from `oldPath` to its current path. */
function repath(folder, inside, oldPath, bar) {
  const path = pathOf(folder);
  for (const b of inside) {
    b.folder = [...path, ...folderOf(b).slice(oldPath.length)];
    b.bar = bar;
  }
}

function update(id, { title, url } = {}) {
  const b = find(id);
  if (!b) return { error: t('Favorito não encontrado.') };
  if (isFolder(b)) {
    const inside = descendants(b);
    const oldPath = pathOf(b);
    b.title = freeName(cleanTitle(title).slice(0, 100) || b.title, { path: folderOf(b), bar: onBar(b) }, b);
    repath(b, inside, oldPath, onBar(b));
  } else {
    const href = url === undefined ? b.url : cleanUrl(url);
    if (!href) return { error: t('Endereço inválido.') };
    if (href !== b.url) b.favicon = null;
    b.url = href;
    b.title = cleanTitle(title) || href;
  }
  data.bookmarks.set('items', items());
  return { id };
}

function remove(id) {
  const b = find(id);
  if (!b) return {};
  const gone = new Set([b, ...(isFolder(b) ? descendants(b) : [])]);
  data.bookmarks.set('items', items().filter((x) => !gone.has(x)));
  return {};
}

/** Moves a bookmark or a folder (with everything in it) into `parentId`, before `beforeId`. */
function move(id, { parentId, bar, beforeId } = {}) {
  const b = find(id);
  const where = target(parentId, bar);
  if (!b || !where) return { error: t('Favorito não encontrado.') };
  const inside = isFolder(b) ? descendants(b) : [];
  if (parentId === id || inside.some((x) => x.id === parentId)) return { error: t('Uma pasta não pode ir para dentro dela mesma.') };
  const moving = [b, ...inside];
  const oldPath = isFolder(b) ? pathOf(b) : null;
  const rest = items().filter((x) => !moving.includes(x));
  b.folder = where.path;
  b.bar = where.bar;
  b.moved = true; // a new import won't put it back in its old folder
  if (isFolder(b)) {
    b.title = freeName(b.title, where, b);
    repath(b, inside, oldPath, where.bar);
  }
  insert(rest, moving, moving.some((x) => x.id === beforeId) ? null : beforeId);
  return { id };
}

const OPS = { add, addFolder, update, remove, move };

/** Runs one editing operation sent by the bar or kitty://bookmarks. */
function run(op) {
  const fn = OPS[op?.op];
  if (!fn) return { error: t('Operação desconhecida.') };
  return op.op === 'remove' ? remove(op.id) : fn === add || fn === addFolder ? fn(op) : fn(op.id, op);
}

module.exports = { ensureFolders, run, find, descendants, isFolder, parentId };
