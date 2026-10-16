#!/bin/sh
# Instala (ou atualiza) o Kitty no Linux x64 com a versão mais nova do GitHub:
#   curl -fsSL https://raw.githubusercontent.com/CaioGobbi/kitty-browser/main/install.sh | sh
# Debian/Ubuntu e derivados: pacote .deb (apt). Fedora/openSUSE e derivados:
# pacote .rpm (dnf/zypper). Outros: AppImage em ~/.local, sem precisar de sudo.
set -eu

REPO=CaioGobbi/kitty-browser
API="${KITTY_RELEASES_API:-https://api.github.com/repos/$REPO/releases/latest}"

fail() { echo "Kitty: $*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || fail "este instalador é só para Linux. Para Windows e Mac, veja https://github.com/$REPO/releases/latest"
case "$(uname -m)" in
  x86_64 | amd64) ;;
  *) fail "por enquanto só há versão para Linux x64 (este computador é $(uname -m))." ;;
esac
command -v curl > /dev/null || fail "precisa do curl."

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO=sudo; fi

if command -v apt-get > /dev/null && command -v dpkg > /dev/null; then
  KIND=deb
elif command -v dnf > /dev/null || command -v zypper > /dev/null || command -v yum > /dev/null; then
  KIND=rpm
else
  KIND=AppImage
fi

echo "Procurando a versão mais nova do Kitty…"
URL=$(curl -fsSL "$API" \
  | grep -o "\"browser_download_url\": *\"[^\"]*-linux-[^\"]*\.$KIND\"" \
  | sed 's/.*"\(http[^"]*\)"/\1/' | head -n 1)
# Sem .rpm no release: cai para o AppImage.
if [ -z "$URL" ] && [ "$KIND" = rpm ]; then
  KIND=AppImage
  URL=$(curl -fsSL "$API" \
    | grep -o "\"browser_download_url\": *\"[^\"]*-linux-[^\"]*\.AppImage\"" \
    | sed 's/.*"\(http[^"]*\)"/\1/' | head -n 1)
fi
[ -n "$URL" ] || fail "não achei o pacote para Linux na última versão: https://github.com/$REPO/releases/latest"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FILE="$TMP/$(basename "$URL")"
echo "Baixando $(basename "$URL")…"
curl -fL --progress-bar -o "$FILE" "$URL"

case "$KIND" in
  deb)
    chmod 644 "$FILE"
    $SUDO apt-get install -y "$FILE"
    ;;
  rpm)
    if command -v dnf > /dev/null; then $SUDO dnf install -y "$FILE"
    elif command -v zypper > /dev/null; then $SUDO zypper --non-interactive install --allow-unsigned-rpm "$FILE"
    else $SUDO yum install -y "$FILE"
    fi
    ;;
  AppImage)
    BIN="$HOME/.local/bin"
    APPS="$HOME/.local/share/applications"
    mkdir -p "$BIN" "$APPS"
    install -m 755 "$FILE" "$BIN/kitty-browser.AppImage"
    ln -sf "$BIN/kitty-browser.AppImage" "$BIN/kitty-browser"
    cat > "$APPS/kitty-browser.desktop" << DESKTOP
[Desktop Entry]
Name=Kitty
GenericName=Navegador
Comment=Navegador rápido e focado em privacidade
Exec=$BIN/kitty-browser.AppImage %U
Terminal=false
Type=Application
Icon=kitty-browser
StartupWMClass=Kitty
Categories=Network;WebBrowser;
MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;application/xhtml+xml;
DESKTOP
    ICON="$HOME/.local/share/icons/hicolor/512x512/apps/kitty-browser.png"
    mkdir -p "$(dirname "$ICON")"
    curl -fsSL -o "$ICON" "https://raw.githubusercontent.com/$REPO/main/assets/icon.png" || true
    command -v update-desktop-database > /dev/null && update-desktop-database "$APPS" 2> /dev/null || true
    echo "O AppImage precisa da biblioteca FUSE 2 (pacote libfuse2 ou fuse2, conforme a distribuição)."
    ;;
esac

echo "Pronto. Abra o Kitty pelo menu de aplicativos ou com o comando: kitty-browser"
[ "$KIND" = AppImage ] && case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "(para usar o comando, adicione ~/.local/bin ao PATH)";; esac
exit 0
