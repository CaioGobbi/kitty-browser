# 🐱 Kitty

Um navegador rápido e focado em privacidade, construído sobre o Chromium (via Electron), na mesma linha do Brave. Bloqueia anúncios e rastreadores, protege contra fingerprinting e phishing e não manda nenhum dado seu para ninguém: não há conta, telemetria nem servidor do Kitty.

![Nova aba do Kitty](docs/screenshots/nova-aba.png)

![Configurações de privacidade do Kitty](docs/screenshots/privacidade.png)

## Baixar

**Windows 10/11 (64 bits):** baixe o `Kitty-Setup-*.exe` da [versão mais recente](https://github.com/CaioGobbi/kitty-browser/releases/latest) e abra. O Kitty se atualiza sozinho depois de instalado.

> O instalador ainda não tem assinatura digital, então o Windows SmartScreen avisa na primeira vez: clique em **Mais informações → Executar assim mesmo**.

O instalador:
- instala só para o usuário atual (sem pedir administrador), com atalhos na área de trabalho e no menu Iniciar;
- registra o Kitty como navegador, para ele aparecer em Configurações → Apps → Aplicativos padrão;
- remove tudo isso ao desinstalar (seus dados ficam em `%APPDATA%\Kitty`).

**macOS (Apple Silicon, M1 ou mais novo):** baixe o `Kitty-*-mac-arm64.dmg` da [versão mais recente](https://github.com/CaioGobbi/kitty-browser/releases/latest), abra e arraste o Kitty para a pasta Aplicativos.

> O Kitty ainda não tem assinatura da Apple, então o macOS bloqueia na primeira vez que você abre. Para liberar: abra o Kitty uma vez e feche o aviso, vá em **Ajustes do Sistema → Privacidade e Segurança**, role até o fim e clique em **Abrir Mesmo Assim**. Depois disso ele abre normalmente. No Mac o Kitty ainda não se atualiza sozinho: para atualizar, baixe o DMG da versão nova.

Linux ainda não é suportado.

## O que já tem

**Privacidade**
- **Escudos**: bloqueio de anúncios e rastreadores (EasyList/EasyPrivacy) com filtros cosméticos, por site. No YouTube, os anúncios são silenciados, acelerados e pulados na hora, sem mexer nos dados do player
- **Janela privativa** (`⇧⌘N`): nada fica salvo, e tudo some ao fechar
- **HTTPS automático**, com volta para HTTP só quando o site não suporta
- **Cookies de terceiros bloqueados**, inclusive os criados por scripts dentro de iframes
- **Proteção contra sites perigosos**: avisa antes de abrir phishing e malware (listas malware-filter, URLhaus e uBlock Origin), verificando tudo localmente
- **Links sem rastreadores**: remove `utm_*`, `fbclid`, `gclid` e similares antes de abrir
- **DNS seguro** (DNS over HTTPS) com Quad9, Cloudflare ou Mullvad
- **User-Agent igual ao do Chrome**, sem revelar Electron nem Kitty
- **Proteção contra fingerprinting**: ruído por site em canvas, WebGL, áudio, medição de fontes, tela, hardware e workers, no estilo do Brave
- **WebRTC** não expõe endereços da rede local
- Listas de bloqueio **atualizadas sozinhas** (anúncios a cada 24 h, ameaças a cada 6 h)
- **Permissões de sites**: câmera, microfone, localização e notificações só com o seu OK
- **Global Privacy Control** (`Sec-GPC` e `navigator.globalPrivacyControl`)

**Navegação**
- Abas: fixar, arrastar para reordenar, silenciar, duplicar, fechar outras, reabrir fechada (`⇧⌘T`), botão do meio fecha
- Gestos: deslize dois dedos no trackpad para voltar/avançar (ou três, se o Mac estiver configurado assim) e botões laterais do mouse
- Barra de endereço com sugestões do histórico, dos favoritos e do buscador
- Favoritos com barra (`⇧⌘B`) e página de gerenciamento
- Importa favoritos e histórico do Chrome, Brave, Edge e Firefox
- Acesso rápido na nova aba, com os ícones dos sites
- Busca na página (`⌘F`), tela cheia de vídeo, zoom, imprimir, salvar página, ver código-fonte
- Menu de botão direito completo (links, imagens, texto, corretor ortográfico, inspecionar)
- Downloads direto na pasta Downloads, com painel de progresso, pausar e cancelar
- Restaura as abas ao reabrir; janelas múltiplas; pode ser o navegador padrão
- Buscadores: DuckDuckGo, Brave Search, Startpage, Ecosia ou Google
- Vídeos com DRM via Widevine (Castlabs), com assinatura VMP: Crunchyroll, Netflix e outros serviços de streaming funcionam

Tudo isso pode ser ajustado em `kitty://settings` (`⌘,`).

## Atalhos

| Ação | Mac | Windows |
| --- | --- | --- |
| Nova aba / janela / janela privativa | `⌘T` / `⌘N` / `⇧⌘N` | `Ctrl+T` / `Ctrl+N` / `Ctrl+Shift+N` |
| Fechar aba / reabrir fechada | `⌘W` / `⇧⌘T` | `Ctrl+W` / `Ctrl+Shift+T` |
| Barra de endereço | `⌘L` | `Ctrl+L` |
| Buscar na página | `⌘F` (`⌘G` próxima) | `Ctrl+F` (`Ctrl+G` próxima) |
| Favoritar / barra de favoritos | `⌘D` / `⇧⌘B` | `Ctrl+D` / `Ctrl+Shift+B` |
| Histórico / downloads | `⌘Y` / `⇧⌘J` | `Ctrl+H` / `Ctrl+J` |
| Configurações | `⌘,` | `Ctrl+,` |
| Voltar / Avançar | `⌘[` / `⌘]` | `Alt+←` / `Alt+→` |
| Recarregar (sem cache) | `⌘R` (`⇧⌘R`) | `F5` (`Ctrl+F5`) |
| Ferramentas do desenvolvedor | `⌥⌘I` | `F12` |

No Windows também valem `F11` (tela cheia) e `Ctrl+Tab`/`Ctrl+PageDown` para trocar de aba.

## Compilar

Você precisa do [Node.js](https://nodejs.org) (versão atual) e do git.

```bash
git clone https://github.com/CaioGobbi/kitty-browser.git
cd kitty-browser
npm install
npm start
```

O `npm install` baixa o Electron da Castlabs (Chromium com Widevine). Para testar sem mexer no seu perfil: `KITTY_PROFILE=/tmp/kitty-teste npm start`.

### Compilar no Mac

Precisa de um Mac com Apple Silicon e das ferramentas de linha de comando do Xcode (`xcode-select --install`), usadas para compilar o módulo nativo dos gestos de trackpad.

```bash
npm run install-app
```

Gera o `Kitty.app`, assina localmente e copia para `/Applications`. Para só gerar o app em `out/`, use `npm run dist`. Para regerar o ícone a partir de `assets/icon.svg`, use `npm run icon`.

### Gerar o instalador para Windows

```bash
npm run dist:win
```

Gera `out/windows/Kitty-Setup-<versão>.exe` (Windows 10/11, 64 bits); dá para gerar direto do Mac.

### Crunchyroll, Netflix e outros com DRM

Esses serviços só liberam a licença do vídeo (Widevine) para apps com assinatura **VMP**, que a Castlabs emite de graça pelo serviço EVS. As versões publicadas do Kitty já vêm assinadas. Sem a assinatura o Kitty funciona normalmente, só esses vídeos não tocam. Para assinar os seus próprios builds, crie uma conta EVS uma vez:

```bash
python3 -m venv .venv
.venv/bin/pip install castlabs-evs
npm run evs-signup
```

Depois disso, `npm run dist` (Mac) e `npm run dist:win` (Windows) assinam sozinhos. No Mac a assinatura VMP é feita antes da assinatura da Apple; no Windows, depois.

### Publicar uma versão (mantenedores)

Suba a versão no `package.json`, faça o commit e rode `npm run release:win` (precisa do `gh auth login`). O script gera o instalador e cria a versão no GitHub Releases, de onde os Kitty instalados no Windows se atualizam sozinhos. Depois rode `npm run release:mac`, que gera o DMG para Mac e anexa na mesma versão (o código precisa estar sem alterações pendentes).

## Estrutura

```
src/main/   processo principal
  main.js        inicialização, IPC, favoritos, sugestões, configurações
  window.js      uma janela: abas, layout, tela cheia, busca, permissões
  privacy.js     escudos, HTTPS, cookies, links, sites perigosos, permissões
  lists.js       listas de bloqueio e de ameaças, com atualização automática
  importer.js    importação de outros navegadores
  updater.js     atualização automática (Windows)
  downloads.js   gerenciador de downloads
  menus.js       menu do app e menus de botão direito
  preload-*.js   proteções que rodam dentro das páginas (fingerprinting, scriptlets)
src/ui/     barra de abas e barra de ferramentas
src/pages/  páginas internas (nova aba, histórico, favoritos, configurações, erro)
native/     módulo nativo dos gestos de trackpad (macOS)
assets/     ícone do app e arquivos do instalador
scripts/    geração do ícone, assinatura e publicação
```

Dados do usuário ficam em `~/Library/Application Support/Kitty` no Mac e em `%APPDATA%\Kitty` no Windows.

## Contribuir

Achou um bug ou quer sugerir algo? Abra uma [issue](https://github.com/CaioGobbi/kitty-browser/issues). Pull requests são bem-vindos.

## Apoiar

O Kitty é gratuito e não tem anúncios nem coleta de dados. Se ele te ajuda, você pode apoiar o projeto pelo [GitHub Sponsors](https://github.com/sponsors/CaioGobbi) ou com um café no [Buy Me a Coffee](https://buymeacoffee.com/caiogobbii).

## Licença

[MPL-2.0](LICENSE), a mesma do Firefox.
