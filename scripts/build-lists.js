'use strict';

// Downloads the filter lists and saves them, ready to use, in src/lists/, so
// they ship inside the app and blocking works from the first launch without
// any connection. Runs before every build (predist, predist:win).
// Run with: npm run lists
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { app } = require('electron');

app.dock?.hide();

const OUT = path.join(__dirname, '..', 'src', 'lists');

app.whenReady().then(async () => {
  const { build, lists, THREAT_FORMAT } = require('../src/main/lists');
  try {
    fs.mkdirSync(OUT, { recursive: true });
    for (const name of Object.keys(lists)) {
      const engine = await build(name);
      const packed = zlib.gzipSync(Buffer.from(engine.serialize()), { level: 9 });
      fs.writeFileSync(path.join(OUT, `${lists[name].file}.gz`), packed);
      console.log(`lista ${name}: ${(packed.length / 1e6).toFixed(1)} MB`);
    }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ built: Date.now(), threatFormat: THREAT_FORMAT }));
    app.exit(0);
  } catch (err) {
    // A build without lists still works (it downloads them once allowed), but
    // an old copy is better than none, so only fail when there is nothing.
    const hasCopy = fs.existsSync(path.join(OUT, 'manifest.json'));
    console.error(`Falha ao baixar as listas: ${err.message}.`, hasCopy ? 'Mantendo a cópia anterior.' : '');
    app.exit(hasCopy ? 0 : 1);
  }
});
