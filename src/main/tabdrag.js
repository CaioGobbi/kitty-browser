'use strict';

// Dragging a tab out of its window, like Chrome: once the pointer leaves the
// tab strip, the tab becomes a window of its own that follows the cursor (the
// page keeps running: a video doesn't restart). Dropped on the tab strip of
// another Kitty window, it joins that window instead. A window's only tab
// drags the whole window along.
//
// The UI that started the drag keeps receiving the pointer (it was pressed
// there), so it reports moves and the drop; positions come from the cursor.
const { screen } = require('electron');

const { registry } = require('./registry');
const { KittyWindow } = require('./window');

const STRIP_HEIGHT = 40; // #tabstrip in ui.css
const STRIP_SLACK = 10; // a little below the strip still counts as "on it"

/** @type {{ kwin: KittyWindow, tabId: number, offset: {x: number, y: number}, target: KittyWindow | null } | null} */
let drag = null;

/** The window whose tab strip is under `point`, other than the one being dragged. */
function stripAt(point, dragged) {
  const candidates = [...registry.windows].filter(
    (w) => w !== dragged && w.session === dragged.session && !w.win.isDestroyed() && w.win.isVisible() && !w.win.isMinimized(),
  );
  // The focused window is on top of the others.
  candidates.sort((a, b) => Number(b.win.isFocused()) - Number(a.win.isFocused()));
  return (
    candidates.find((w) => {
      const b = w.win.getContentBounds();
      return point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + STRIP_HEIGHT + STRIP_SLACK;
    }) || null
  );
}

function setTarget(target) {
  if (drag.target === target) return;
  drag.target?.sendUi('tabs:drop-hint', false);
  drag.target = target;
  target?.sendUi('tabs:drop-hint', true);
  // The dragged window turns see-through over a strip, so the drop spot shows.
  if (!drag.kwin.win.isDestroyed()) drag.kwin.win.setOpacity(target ? 0.55 : 1);
}

/**
 * The pointer left the strip. `grab` is where the pointer sits inside the
 * window the tab ends up in: over the tab, at the start of the new strip.
 */
function start(kwin, tabId, grab) {
  if (drag) {
    // A drop that never arrived (the pointer was lost): forget that drag.
    setTarget(null);
    if (!drag.kwin.win.isDestroyed()) drag.kwin.win.focus();
    drag = null;
  }
  if (!kwin.tabs.has(tabId)) return;
  const cursor = screen.getCursorScreenPoint();
  if (kwin.order.length === 1) {
    if (kwin.win.isFullScreen() || kwin.win.isMaximized()) return;
    const [x, y] = kwin.win.getPosition();
    drag = { kwin, tabId, offset: { x: cursor.x - x, y: cursor.y - y }, target: null };
    return;
  }
  const offset = { x: Math.round(grab?.x) || 100, y: Math.round(grab?.y) || 20 };
  const [width, height] = kwin.win.getSize();
  const tab = kwin.releaseTab(tabId);
  if (!tab) return;
  const fresh = new KittyWindow({ adopt: tab, bounds: { x: cursor.x - offset.x, y: cursor.y - offset.y, width, height } });
  drag = { kwin: fresh, tabId, offset, target: null };
}

function move() {
  if (!drag || drag.kwin.win.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  drag.kwin.win.setPosition(cursor.x - drag.offset.x, cursor.y - drag.offset.y);
  setTarget(stripAt(cursor, drag.kwin));
}

async function end() {
  if (!drag) return;
  move();
  const { kwin, tabId, target } = drag;
  setTarget(null);
  drag = null;
  if (kwin.win.isDestroyed()) return;
  if (!target || target.win.isDestroyed()) return kwin.win.focus();

  // Joins the other window where it was dropped, like a reorder there.
  const cursor = screen.getCursorScreenPoint();
  const x = cursor.x - target.win.getContentBounds().x;
  const index = await target.ui.webContents
    .executeJavaScript(
      `(() => {
        const tabs = [...document.querySelectorAll('#tabs .tab:not(.closing)')];
        const i = tabs.findIndex((t) => { const r = t.getBoundingClientRect(); return ${x} < r.left + r.width / 2; });
        return i === -1 ? tabs.length : i;
      })()`,
    )
    .catch(() => target.order.length);
  if (kwin.win.isDestroyed() || target.win.isDestroyed()) return;
  const tab = kwin.releaseTab(tabId, { allowEmpty: true });
  if (!tab) return;
  target.adoptTab(tab, index);
  target.win.focus();
  if (kwin.order.length === 0) kwin.win.close();
}

module.exports = { start, move, end };
