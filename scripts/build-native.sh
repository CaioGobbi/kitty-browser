#!/bin/sh
# Builds the macOS swipe-phase native module into src/main/native/.
# Uses the full Xcode toolchain: the Command Line Tools linker can be older
# than the installed SDK.
set -e
[ "$(uname)" = "Darwin" ] || exit 0
cd "$(dirname "$0")/../native/swipe-phase"
if [ -d /Applications/Xcode.app ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
fi
npx node-gyp rebuild --arch=arm64 --silent
mkdir -p ../../src/main/native
cp build/Release/swipe_phase.node ../../src/main/native/swipe_phase.node
echo "Módulo de gestos: src/main/native/swipe_phase.node"
