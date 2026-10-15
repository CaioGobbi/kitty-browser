'use strict';

// electron-builder afterSign hook: Castlabs VMP signature for Windows builds.
// Streaming services (Crunchyroll, Netflix…) only grant Widevine licenses to
// VMP-signed apps. On Windows it must run after code signing, which is why
// this is afterSign and not afterPack. Needs a free EVS account:
//   npm run evs-signup
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = async function evsAfterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  const python = path.join(__dirname, '..', '.venv', 'bin', 'python');
  const config = path.join(os.homedir(), '.config', 'evs', 'config.json');
  if (!fs.existsSync(python) || !fs.existsSync(config)) {
    console.warn('⚠️  Sem conta Castlabs EVS: o Kitty para Windows não terá assinatura VMP (Crunchyroll/Netflix vão recusar a licença).');
    return;
  }
  execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
};
