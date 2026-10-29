'use strict';

// Ad-blocking scriptlets (uBlock-style "+js(...)" rules) must run before any of
// the page's own scripts: sites keep references to fetch, JSON.parse and
// XMLHttpRequest from their first lines, and a scriptlet that arrives later
// can no longer intercept them. webFrame.executeJavaScript from a preload runs
// synchronously in the page's main world, before the document's first script.
//
// On YouTube there's also a fallback for ads the lists miss (youtubeAdSkipper).
const { ipcRenderer, webFrame } = require('electron');

/**
 * YouTube: the lists' scriptlets remove the ads from the player's data, so
 * normally none plays. One that still shows (YouTube changed something the
 * lists don't cover yet) is muted, hidden and skipped as soon as YouTube
 * offers the button. It plays at normal speed: YouTube holds the video until
 * an ad would be skippable in real time anyway, and fast-forwarded ads make it
 * show its ad blocker wall. This
 * runs in the preload's isolated world, invisible to YouTube's scripts, and
 * the skip button gets a real click from the main process — YouTube ignores
 * clicks made by page scripts.
 */
function youtubeAdSkipper() {
  const SKIP_BUTTONS = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button';
  let saved = null; // the viewer's own sound, restored after the ad
  let lastClick = 0;

  const tick = () => {
    const player = document.querySelector('#movie_player');
    const video = player?.querySelector('video');
    if (!player || !video) return;

    if (!player.classList.contains('ad-showing')) {
      if (saved) {
        video.muted = saved.muted;
        saved = null;
      }
      return;
    }
    saved ??= { muted: video.muted };
    video.muted = true;

    const button = document.querySelector(SKIP_BUTTONS);
    const box = button?.getBoundingClientRect();
    if (box && box.width > 0 && box.height > 0 && Date.now() - lastClick > 600) {
      const x = Math.round(box.left + box.width / 2);
      const y = Math.round(box.top + box.height / 2);
      // Only click when the button is what's under the point: a click that
      // lands on the video pauses or resumes it instead of skipping.
      if (!button.contains(document.elementFromPoint(x, y))) return;
      lastClick = Date.now();
      ipcRenderer.send('kitty:click', { x, y });
    }
  };

  const start = () => {
    new MutationObserver(tick).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
    setInterval(tick, 250);
  };
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
}

/**
 * YouTube, page world: on some accounts YouTube answers a video with ads taken
 * out by "Ad blockers violate YouTube's Terms of Service" (status ERROR). The
 * lists already handle that wall in uBlock's way, by tagging the player's
 * client with another name (channel, lactmilli…) and loading the video again,
 * but only for the older UNPLAYABLE answer. This does the same for ERROR,
 * trying the next name each time, until the video plays.
 */
function youtubeWallRetry() {
  const NAMES = ['lactmilli', 'channel', 'inline', 'yahi'];
  const TAG = new RegExp(`; (${NAMES.join('|')})\\b`);
  const tried = new Map(); // video id → names already tried
  let last = 0;
  let hidden = null; // the wall's box, shown again on the next page
  document.addEventListener('yt-navigate-start', () => {
    if (hidden) hidden.style.display = '';
    hidden = null;
  });
  setInterval(() => {
    if (Date.now() - last < 1500) return; // the new answer is still on its way
    const player = document.getElementById('movie_player');
    const response = player?.getPlayerResponse?.();
    const status = response?.playabilityStatus;
    const id = response?.videoDetails?.videoId || new URLSearchParams(location.search).get('v');
    const wall = document.getElementById('error-screen');
    if (status?.status === 'OK' && tried.has(id) && wall) {
      // Playing again, but the page keeps the wall or error over the player.
      document.querySelector('ytd-watch-flexy[player-unavailable]')?.removeAttribute('player-unavailable');
      if (wall.style.display !== 'none') {
        wall.style.display = 'none';
        hidden = wall;
      }
      return;
    }
    // The wall (ERROR), or "This content isn't available" pointing to the ad
    // blocker help page (UNPLAYABLE), which a name YouTube refuses gets.
    const blocked =
      (status?.status === 'ERROR' && status.errorScreen?.enforcementMessageViewModel) ||
      (status?.status === 'UNPLAYABLE' && JSON.stringify(status.errorScreen || {}).includes('youtube/answer/3037019'));
    if (!blocked) return;
    const client = window.ytcfg?.data_?.INNERTUBE_CONTEXT?.client;
    if (!id || !client?.userAgent) return;
    const used = tried.get(id) || 0;
    if (used >= NAMES.length) return;
    tried.set(id, used + 1);
    last = Date.now();
    const base = client.userAgent.replace(TAG, '');
    const head = base.match(/Mozilla\/5\.0 \([^)]+/)?.[0];
    if (!head) return;
    client.userAgent = base.replace(head, `${head}; ${NAMES[used]}`);
    const start = parseInt(new URLSearchParams(location.search).get('t'), 10) || 0;
    player.loadVideoById(id, start);
  }, 500);
}

if (/^https?:$/.test(location.protocol)) {
  let shields = { scripts: [], adSkipper: false };
  try {
    shields = ipcRenderer.sendSync('kitty:scriptlets', location.href) || shields;
  } catch {
    // main process busy or not ready: the page loads without scriptlets
  }
  for (const script of shields.scripts) {
    webFrame.executeJavaScript(script).catch(() => {});
  }
  if (shields.adSkipper && window === window.top) {
    webFrame.executeJavaScript(`(${youtubeWallRetry})();`).catch(() => {});
    youtubeAdSkipper();
  }
}
