#!/bin/sh
# Builds Kitty.app (Apple Silicon), wraps it in a .dmg and uploads it to the
# GitHub release of the current version. Needs `gh auth login`.
# The app has no Apple Developer ID signature, so on first open macOS asks
# the user to allow it in System Settings → Privacy & Security.
# Usage: run after `npm run release:win` (which creates the release).
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
REPO=CaioGobbi/kitty-browser
DMG="out/Kitty-$VERSION-mac-arm64.dmg"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Há alterações sem commit: o DMG precisa sair de um código igual ao da versão." >&2
  exit 1
fi

npm run dist

STAGE=$(mktemp -d)
cp -R out/Kitty-darwin-arm64/Kitty.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Kitty $VERSION" -srcfolder "$STAGE" -fs HFS+ -format UDZO "$DMG"
rm -rf "$STAGE"

gh release view "$TAG" --repo "$REPO" > /dev/null
gh release upload "$TAG" --repo "$REPO" --clobber "$DMG"
echo "Publicado: https://github.com/$REPO/releases/tag/$TAG"
