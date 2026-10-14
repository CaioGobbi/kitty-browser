#!/bin/sh
# Signs out/Kitty-darwin-arm64/Kitty.app after packaging.
#  1. Castlabs VMP signature (Widevine "verified media path") — streaming
#     services like Crunchyroll and Netflix refuse licenses without it.
#     Needs a free EVS account: .venv/bin/python -m castlabs_evs.account signup
#  2. Ad-hoc Apple code signature, so macOS on Apple Silicon runs the app.
# On macOS the VMP signature must come before the Apple one.
set -e
cd "$(dirname "$0")/.."
PKG=out/Kitty-darwin-arm64

if [ -f "$HOME/.config/evs/config.json" ] && [ -x .venv/bin/python ]; then
  .venv/bin/python -m castlabs_evs.vmp sign-pkg "$PKG"
else
  echo "⚠️  Sem conta Castlabs EVS: o app não terá assinatura VMP (Crunchyroll/Netflix vão recusar a licença)."
  echo "   Crie com: .venv/bin/python -m castlabs_evs.account signup"
fi

codesign --force --deep --sign - "$PKG/Kitty.app"
