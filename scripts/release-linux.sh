#!/bin/sh
# Builds Kitty for Linux x64 (AppImage, .deb and, with Docker, .rpm) and uploads
# them to the GitHub release of the current version. Needs `gh auth login`.
# Usage: run after `npm run release:win` (which creates the release).
# Linux has no VMP signature (Castlabs only signs Windows and macOS); Widevine
# still works there, downloaded by Chromium like on the other systems.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
REPO=CaioGobbi/kitty-browser
OUT=out/linux

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Há alterações sem commit: os pacotes precisam sair de um código igual ao da versão." >&2
  exit 1
fi

rm -rf "$OUT"
npm run dist:linux

# The .rpm needs rpmbuild, which macOS lacks: build it in a Linux container
# from the app electron-builder already assembled.
if docker info > /dev/null 2>&1; then
  docker run --rm --platform linux/amd64 -v "$PWD":/project -w /project electronuserland/builder:latest \
    npx electron-builder --linux rpm --x64 -c.directories.output=$OUT --prepackaged $OUT/linux-unpacked
else
  echo "⚠️  Docker não está rodando: o release sai sem o .rpm."
fi

gh release view "$TAG" --repo "$REPO" > /dev/null
gh release upload "$TAG" --repo "$REPO" --clobber "$OUT"/Kitty-"$VERSION"-linux-*.AppImage "$OUT"/Kitty-"$VERSION"-linux-*.deb
ls "$OUT"/Kitty-"$VERSION"-linux-*.rpm > /dev/null 2>&1 && gh release upload "$TAG" --repo "$REPO" --clobber "$OUT"/Kitty-"$VERSION"-linux-*.rpm
echo "Publicado: https://github.com/$REPO/releases/tag/$TAG"
