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

# A fixed identity keeps macOS permissions (Full Disk Access) across versions: an
# ad-hoc signature changes with every build and macOS forgets them. Uses the
# self-signed "Kitty Local" certificate when this Mac has it, ad-hoc otherwise.
IDENTITY="${KITTY_SIGN_IDENTITY:-Kitty Local}"
if security find-identity -p codesigning | grep -q "\"$IDENTITY\""; then
  codesign --force --deep --sign "$IDENTITY" "$PKG/Kitty.app"
else
  echo "⚠️  Sem o certificado \"$IDENTITY\": assinatura ad-hoc (o macOS esquece permissões a cada versão)."
  codesign --force --deep --sign - "$PKG/Kitty.app"
fi
