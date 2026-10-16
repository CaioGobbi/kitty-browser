#!/bin/sh
# Prints the latest-mac.yml that electron-updater reads to find a Mac update.
# Usage: sh scripts/mac-update-yml.sh <Kitty-X.Y.Z-mac-arm64.zip> <X.Y.Z>
set -e
ZIP="$1"
NAME=$(basename "$ZIP")
SHA=$(openssl dgst -sha512 -binary "$ZIP" | base64 | tr -d '\n')
SIZE=$(stat -f %z "$ZIP")
cat <<YML
version: $2
files:
  - url: $NAME
    sha512: $SHA
    size: $SIZE
path: $NAME
sha512: $SHA
releaseDate: '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'
YML
