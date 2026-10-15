# 🐱 Kitty

Um navegador rápido e focado em privacidade, construído sobre o Chromium (via Electron) — na mesma linha do Brave.

## Rodando

```bash
npm install
npm start
```

## Instalando no Mac

```bash
npm run install-app
```

Gera o `Kitty.app` (Apple Silicon), assina localmente e copia para `/Applications`. Para só gerar o app em `out/`, use `npm run dist`. ### Crunchyroll, Netflix e outros com DRM

Esses serviços só liberam a licença do vídeo para apps com assinatura **VMP** da Castlabs (grátis). Uma vez só:

```bash
npm run evs-signup
```

Depois disso, `npm run install-app` já assina automaticamente.

Para regerar o ícone a partir de `assets/icon.svg`, use `npm run icon`.

## O que já tem

**Navegação**
- Abas: arrastar para reordenar, silenciar, duplicar, fechar outras, reabrir fechada (`⌘⇧T`), botão do meio fecha
- Barra de endereço com sugestões do histórico, dos favoritos e do buscador
- Favoritos com barra (`⌘⇧B`) e página de gerenciamento
- Busca na página (`⌘F`), tela cheia de vídeo, zoom, imprimir, salvar página, ver código-fonte
- Menu de botão direito completo (links, imagens, texto, corretor ortográfico, inspecionar)
- Downloads direto em `~/Downloads`, com painel de progresso, pausar e cancelar
- Restaura as abas ao reabrir; janelas múltiplas; pode ser o navegador padrão do Mac
- Buscadores: DuckDuckGo, Brave Search, Startpage, Ecosia ou Google

**Privacidade**
- **Escudos**: bloqueio de anúncios e rastreadores (EasyList/EasyPrivacy) com filtros cosméticos, por site
- **Janela privativa** (`⇧⌘N`): nada fica salvo, e tudo some ao fechar
- **HTTPS automático**, com volta para HTTP só quando o site não suporta
- **Cookies de terceiros bloqueados**
- **Proteção contra sites perigosos**: avisa antes de abrir phishing e malware (listas malware-filter, URLhaus e uBlock Origin), verificando tudo localmente
- **Links sem rastreadores**: remove `utm_*`, `fbclid`, `gclid` e similares antes de abrir
- **DNS seguro** (DNS over HTTPS) com Quad9, Cloudflare ou Mullvad
- **User-Agent igual ao do Chrome**, sem revelar Electron nem Kitty
- **Proteção contra fingerprinting**: ruído por site em canvas, WebGL, áudio, medição de fontes, tela, hardware e workers, no estilo do Brave
- **WebRTC** não expõe endereços da rede local
- Listas de bloqueio **atualizadas sozinhas** (anúncios a cada 24 h, ameaças a cada 6 h)
- **Permissões de sites**: câmera, microfone, localização e notificações só com o seu OK
- **Global Privacy Control** (`Sec-GPC` e `navigator.globalPrivacyControl`)
- Vídeos com DRM via Widevine (Castlabs)

Tudo isso pode ser ajustado em `kitty://settings` (`⌘,`).

## Atalhos

| Ação | Atalho |
| --- | --- |
| Nova aba / janela / janela privativa | `⌘T` / `⌘N` / `⇧⌘N` |
| Fechar aba / reabrir fechada | `⌘W` / `⇧⌘T` |
| Barra de endereço | `⌘L` |
| Buscar na página | `⌘F` (`⌘G` próxima) |
| Favoritar / barra de favoritos | `⌘D` / `⇧⌘B` |
| Histórico / downloads | `⌘Y` / `⇧⌘J` |
| Configurações | `⌘,` |
| Voltar / Avançar | `⌘[` / `⌘]` |
| Recarregar (sem cache) | `⌘R` (`⇧⌘R`) |
| Ferramentas do desenvolvedor | `⌥⌘I` |

Para testar sem mexer no seu perfil: `KITTY_PROFILE=/tmp/kitty-teste npm start`.

## Estrutura

```
src/main/   processo principal
  main.js        inicialização, IPC, favoritos, sugestões, configurações
  window.js      uma janela: abas, layout, tela cheia, busca, permissões
  privacy.js     escudos, HTTPS, cookies, links, sites perigosos, permissões
  lists.js       listas de bloqueio e de ameaças, com atualização automática
  downloads.js   gerenciador de downloads
  menus.js       menu do app e menus de botão direito
src/ui/     barra de abas e barra de ferramentas
src/pages/  páginas internas (nova aba, histórico, favoritos, configurações, erro)
assets/     ícone do app (SVG fonte, PNG e .icns)
scripts/    geração do ícone
```

Dados do usuário ficam em `~/Library/Application Support/Kitty`.
