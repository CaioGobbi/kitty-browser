#!/bin/sh
# Writes the notes of the current version's GitHub release: the changes from
# docs/releases/<version>.md (if present) and a download section per system,
# with direct links to the files already attached. Each release script runs
# it at the end, so the notes always match the files that are there.
# Usage: sh scripts/release-notes.sh [version]
set -e
cd "$(dirname "$0")/.."
VERSION=${1:-$(node -p "require('./package.json').version")}
TAG="v$VERSION"
REPO=CaioGobbi/kitty-browser
BASE="https://github.com/$REPO/releases/download/$TAG"
ASSETS=$(gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[].name')
NOTES=$(mktemp)

# Prints a table row when the file is attached to the release.
row() {
  echo "$ASSETS" | grep -qx "$2" && echo "| [$2]($BASE/$2) | $1 |"
  return 0
}
# Prints a table from rows on stdin, or nothing when there are none.
table() {
  ROWS=$(cat)
  [ -n "$ROWS" ] && printf '| File | |\n| --- | --- |\n%s\n\n' "$ROWS"
  return 0
}

{
  [ -f "docs/releases/$VERSION.md" ] && cat "docs/releases/$VERSION.md" && echo

  echo "## Downloads"
  echo
  echo "### Windows 10/11 (x64)"
  echo
  row "Installer. Kitty updates itself after installing." "Kitty-Setup-$VERSION.exe" | table
  echo "On the SmartScreen warning, click **More info → Run anyway** (Kitty isn't signed by Microsoft yet)."
  echo
  echo "### macOS (Apple Silicon)"
  echo
  row "Disk image. Open it and drag Kitty to Applications. Kitty updates itself after installing." "Kitty-$VERSION-mac-arm64.dmg" | table
  echo "Kitty isn't signed by Apple yet: open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**."
  echo
  echo "### Linux (x64)"
  echo
  echo "Install or update from the terminal (picks the \`.deb\`, \`.rpm\` or AppImage for your distribution):"
  echo
  echo '```bash'
  echo "curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | sh"
  echo '```'
  echo
  echo "Or download a package:"
  echo
  {
    row "Debian, Ubuntu and derivatives" "Kitty-$VERSION-linux-amd64.deb"
    row "Fedora, openSUSE and derivatives" "Kitty-$VERSION-linux-x86_64.rpm"
    row "Any distribution (needs FUSE 2)" "Kitty-$VERSION-linux-x86_64.AppImage"
  } | table
  echo "<sub>The \`.zip\`, \`.blockmap\` and \`latest*.yml\` files are used by automatic updates; you don't need to download them.</sub>"
} > "$NOTES"

gh release edit "$TAG" --repo "$REPO" --notes-file "$NOTES"
rm -f "$NOTES"
