#!/bin/sh
# Builds the Windows installer and publishes it as a GitHub release, which
# installed copies of Kitty pick up automatically. Needs `gh auth login`.
# Usage: bump "version" in package.json, commit, then: npm run release:win
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
REPO=CaioGobbi/kitty-browser

rm -rf out/windows
npm run lists
npx electron-builder --win nsis --x64 --publish never

git push origin HEAD
if ! gh release view "$TAG" --repo "$REPO" > /dev/null 2>&1; then
  gh release create "$TAG" --repo "$REPO" --target "$(git rev-parse HEAD)" --title "Kitty $VERSION" --notes "Kitty $VERSION"
fi
# latest.yml goes last: installed copies only see the new version once the installer is there.
gh release upload "$TAG" --repo "$REPO" --clobber "out/windows/Kitty-Setup-$VERSION.exe" "out/windows/Kitty-Setup-$VERSION.exe.blockmap"
gh release upload "$TAG" --repo "$REPO" --clobber out/windows/latest.yml
echo "Publicado: https://github.com/$REPO/releases/tag/$TAG"
