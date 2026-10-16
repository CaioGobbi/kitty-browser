'use strict';

// Dragging a tab out of its window, the way Chromium (and so Chrome, Brave and
// Helium) does it: once the pointer is pulled away from the tab strip, the tab
// becomes a window of its own that follows the cursor (the page keeps running:
// a video doesn't restart). Passing over the tab strip of any Kitty window,
// the original included, puts the tab right into it, where it can still be
// moved along or pulled out again; Esc puts everything back. A window's only
// tab drags the whole window along.
//
// The UI that started the drag keeps receiving the pointer (it was pressed
// there), so it reports moves and the drop; positions come from the cursor.
const { screen } = require('electron');

const { registry } = require('./registry');
const { KittyWindow } = require('./window');

const MAGNETISM = 15; // Chromium's kVerticalDetachMagnetism: the strip reaches this far up and down

/**
 * @type {{
 *   tabId: number,
 *   offset: {x: number, y: number},        // pointer position inside the floating window
 *   floating: KittyWindow,                 // the window following the cursor (empty and invisible while attached)
 *   attached: KittyWindow | null,          // the window whose strip the tab is in right now
 *   slots: number[] | null,                // screen x of the middle of the other tabs of `attached`
 *   busy: boolean,
 *   origin: { kwin: KittyWindow, index: number, position: number[] },
 * } | null}
 */
let drag = null;

const alive = (kwin) => kwin && !kwin.win.isDestroyed();

/** Whether `point` is over the tab strip of `kwin` (on top or, with vertical tabs, on the side). */
function inStrip(kwin, point) {
  const b = kwin.win.getContentBounds();
  const s = kwin.strip;
  const x = b.x + s.x;
  const y = b.y + s.y;
  const width = Math.min(s.width, b.width - s.x);
  if (s.vertical) {
    return point.x >= x - MAGNETISM && point.x <= x + width + MAGNETISM && point.y >= y && point.y < y + s.height;
  }
  return point.x >= x && point.x < x + width && point.y >= y - MAGNETISM && point.y <= y + s.height + MAGNETISM;
}

/** The window whose tab strip is under `point`, other than the floating one. */
function stripAt(point) {
  const candidates = [...registry.windows].filter(
    (w) => w !== drag.floating && w.session === drag.floating.session && alive(w) && w.win.isVisible() && !w.win.isMinimized(),
  );
  // The focused window is on top of the others.
  candidates.sort((a, b) => Number(b.win.isFocused()) - Number(a.win.isFocused()));
  return candidates.find((w) => inStrip(w, point)) || null;
}

/**
 * Where the middle of each tab of `kwin` is on screen (the dragged tab isn't
 * there yet), across the strip: x on top, y on the side.
 */
async function measureSlots(kwin) {
  const { vertical } = kwin.strip;
  const b = kwin.win.getContentBounds();
  const mids = await kwin.ui.webContents
    .executeJavaScript(
      `[...document.querySelectorAll('#tabs .tab:not(.closing)')].map((t) => { const r = t.getBoundingClientRect(); return ${
        vertical ? 'r.top + r.height / 2' : 'r.left + r.width / 2'
      }; })`,
    )
    .catch(() => []);
  return { vertical, mids: mids.map((mid) => (vertical ? b.y : b.x) + mid) };
}

const indexAt = (point) => {
  const at = drag.slots.vertical ? point.y : point.x;
  return drag.slots.mids.filter((mid) => mid < at).length;
};

/** Makes the floating window vanish without hiding it: it may be the window holding the pointer. */
function setFloatingVisible(kwin, visible) {
  kwin.win.setOpacity(visible ? 1 : 0);
  kwin.win.setIgnoreMouseEvents(!visible);
}

async function attach(target, cursor) {
  drag.busy = true;
  const slots = await measureSlots(target);
  if (!drag) return;
  drag.busy = false;
  if (!alive(target) || !alive(drag.floating)) return;
  const tab = drag.floating.releaseTab(drag.tabId, { allowEmpty: true });
  if (!tab) return;
  drag.slots = slots;
  drag.attached = target;
  setFloatingVisible(drag.floating, false);
  target.adoptTab(tab, indexAt(cursor), { focus: false });
}

function detach(cursor) {
  const tab = drag.attached.releaseTab(drag.tabId);
  if (!tab) return; // it's that window's only tab: it stays
  drag.attached = null;
  drag.slots = null;
  const { floating } = drag;
  floating.win.setPosition(cursor.x - drag.offset.x, cursor.y - drag.offset.y);
  floating.adoptTab(tab, 0, { focus: false });
  setFloatingVisible(floating, true);
}

/**
 * The pointer left the strip. `grab` is where the pointer sits inside the
 * window the tab ends up in: over the tab, at the start of the new strip.
 */
function start(kwin, tabId, grab) {
  if (drag) end(); // a drop that never arrived (the pointer was lost)
  if (!kwin.tabs.has(tabId)) return;
  const cursor = screen.getCursorScreenPoint();
  const origin = { kwin, index: kwin.order.indexOf(tabId), position: kwin.win.getPosition() };
  // Esc arrives at the UI that owns the pointer.
  kwin.ui.webContents.focus();
  if (kwin.order.length === 1) {
    if (kwin.win.isFullScreen() || kwin.win.isMaximized()) return;
    const [x, y] = origin.position;
    drag = { tabId, offset: { x: cursor.x - x, y: cursor.y - y }, floating: kwin, attached: null, slots: null, busy: false, origin };
    return;
  }
  const offset = { x: Math.round(grab?.x) || 100, y: Math.round(grab?.y) || 20 };
  const { width, height } = kwin.win.getNormalBounds(); // not the whole screen of a fullscreen window
  const tab = kwin.releaseTab(tabId);
  if (!tab) return;
  const floating = new KittyWindow({ adopt: tab, bounds: { x: cursor.x - offset.x, y: cursor.y - offset.y, width, height } });
  drag = { tabId, offset, floating, attached: null, slots: null, busy: false, origin };
}

function move() {
  if (!drag || drag.busy) return;
  if (!alive(drag.floating)) return void (drag = null);
  const cursor = screen.getCursorScreenPoint();
  const { attached } = drag;
  if (attached) {
    if (!alive(attached)) return void (drag = null);
    if (!inStrip(attached, cursor)) return detach(cursor);
    // Slides along the strip, like a reorder.
    const index = indexAt(cursor);
    const pinned = attached.tabs.get(drag.tabId)?.pinned;
    if (attached.order.indexOf(drag.tabId) !== attached.clampToGroup(index, pinned)) attached.moveTab(drag.tabId, index);
    return;
  }
  drag.floating.win.setPosition(cursor.x - drag.offset.x, cursor.y - drag.offset.y);
  const target = stripAt(cursor);
  if (target) attach(target, cursor);
}

function end() {
  if (!drag) return;
  move();
  const { floating, attached } = drag;
  drag = null;
  if (alive(attached)) {
    attached.win.focus();
    if (alive(floating) && floating.order.length === 0) floating.win.close();
  } else if (alive(floating)) {
    setFloatingVisible(floating, true);
    floating.win.focus();
  }
}

/** Esc: the tab goes back where it was. */
function cancel() {
  if (!drag) return;
  const { floating, attached, origin, tabId } = drag;
  drag = null;
  const holder = attached || floating;
  if (!alive(holder) || !alive(origin.kwin)) return;
  if (origin.kwin === floating) {
    // The whole window was dragged along: back to its place, with its tab.
    if (attached) {
      const tab = attached.releaseTab(tabId);
      if (tab) floating.adoptTab(tab, 0);
    }
    floating.win.setPosition(...origin.position);
  } else if (holder === origin.kwin) {
    origin.kwin.moveTab(tabId, origin.index);
  } else {
    const tab = holder.releaseTab(tabId, { allowEmpty: true });
    if (tab) origin.kwin.adoptTab(tab, origin.index);
  }
  if (alive(floating)) {
    setFloatingVisible(floating, true);
    if (floating.order.length === 0) floating.win.close();
  }
  origin.kwin.win.focus();
}

module.exports = { start, move, end, cancel };
