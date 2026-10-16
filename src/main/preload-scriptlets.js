'use strict';

// Ad-blocking scriptlets (uBlock-style "+js(...)" rules) must run before any of
// the page's own scripts: sites keep references to fetch, JSON.parse and
// XMLHttpRequest from their first lines, and a scriptlet that arrives later
// can no longer intercept them. webFrame.executeJavaScript from a preload runs
// synchronously in the page's main world, before the document's first script.
//
// YouTube is the exception (see youtubeAdSkipper below).
const { ipcRenderer, webFrame } = require('electron');

/**
 * YouTube: the lists remove ads by editing the player's data, and in Kitty
 * that intermittently leaves the player reloading the video forever — its
 * length flickering between 0:00 and the real value. With the player's data
 * left alone it never loops, so ads are dealt with as they appear instead:
 * muted, played at 16× and skipped as soon as YouTube offers the button. This
 * runs in the preload's isolated world, invisible to YouTube's scripts, and
 * the skip button gets a real click from the main process — YouTube ignores
 * clicks made by page scripts.
 */
function youtubeAdSkipper() {
  const SKIP_BUTTONS = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button';
  let saved = null; // the viewer's own sound and speed, restored after the ad
  let lastClick = 0;

  const tick = () => {
    const player = document.querySelector('#movie_player');
    const video = player?.querySelector('video');
    if (!player || !video) return;

    if (!player.classList.contains('ad-showing')) {
      if (saved) {
        video.muted = saved.muted;
        video.playbackRate = saved.rate;
        saved = null;
      }
      return;
    }
    saved ??= { muted: video.muted, rate: video.playbackRate };
    video.muted = true;
    if (video.playbackRate !== 16) video.playbackRate = 16;

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
  if (shields.adSkipper && window === window.top) youtubeAdSkipper();
}
