'use strict';

// Renders assets/icon.svg to assets/icon.png (1024px) and assets/icon.icns.
// Run with: npm run icon
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const ASSETS = path.join(__dirname, '..', 'assets');
const SIZE = 1024;

app.dock?.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  const svg = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8');
  const render = async (markup) => {
    const html = `<html><body style="margin:0;background:transparent">${markup}</body></html>`;
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise((r) => setTimeout(r, 300));
    return (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' });
  };

  const image = await render(svg);
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), image.toPNG());

  // Windows icons fill their square: crop the macOS margin and shadow away.
  const windows = await render(
    svg.replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"').replace(' filter="url(#shadow)"', ''),
  );
  fs.writeFileSync(path.join(ASSETS, 'icon-win.png'), windows.toPNG());

  if (process.platform === 'darwin') {
    const iconset = path.join(ASSETS, 'icon.iconset');
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const px = size * scale;
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        fs.writeFileSync(path.join(iconset, name), image.resize({ width: px, height: px, quality: 'best' }).toPNG());
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(ASSETS, 'icon.icns')]);
    fs.rmSync(iconset, { recursive: true, force: true });
  }

  console.log('Ícone gerado em assets/');
  app.quit();
});
