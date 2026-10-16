#!/bin/sh
# Builds Kitty.app (Apple Silicon), wraps it in a .dmg (first install) and a
# .zip + latest-mac.yml (automatic updates, read by electron-updater) and
# uploads them to the GitHub release of the current version. Needs `gh auth login`.
# The app has no Apple Developer ID signature, so on first open macOS asks
# the user to allow it in System Settings → Privacy & Security. Updates must be
# signed with the same "Kitty Local" certificate as the installed app.
# Usage: run after `npm run release:win` (which creates the release).
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
REPO=CaioGobbi/kitty-browser
DMG="out/Kitty-$VERSION-mac-arm64.dmg"
ZIP="out/Kitty-$VERSION-mac-arm64.zip"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Há alterações sem commit: o DMG precisa sair de um código igual ao da versão." >&2
  exit 1
fi

npm run dist
if ! codesign -dr - out/Kitty-darwin-arm64/Kitty.app 2>&1 | grep -q 'certificate leaf'; then
  echo "O app saiu sem a assinatura \"Kitty Local\": quem já tem o Kitty não conseguiria atualizar." >&2
  exit 1
fi

STAGE=$(mktemp -d)
cp -R out/Kitty-darwin-arm64/Kitty.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Kitty $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO "$DMG"
rm -rf "$STAGE"

rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent out/Kitty-darwin-arm64/Kitty.app "$ZIP"
sh scripts/mac-update-yml.sh "$ZIP" "$VERSION" > out/latest-mac.yml

gh release view "$TAG" --repo "$REPO" > /dev/null
gh release upload "$TAG" --repo "$REPO" --clobber "$DMG" "$ZIP"
# Last, so no installed Kitty sees the version before its .zip is there.
gh release upload "$TAG" --repo "$REPO" --clobber out/latest-mac.yml
sh scripts/release-notes.sh
echo "Publicado: https://github.com/$REPO/releases/tag/$TAG"
