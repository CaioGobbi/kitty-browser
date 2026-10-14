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

- **Abas** — abrir, fechar (inclusive com o botão do meio), alternar, `⌘1…9`, `Ctrl+Tab`
- **Escudos** — bloqueio de anúncios e rastreadores com as listas EasyList/EasyPrivacy (motor do Ghostery), contador por página, filtros cosméticos que escondem os espaços vazios dos anúncios e opção de desativar por site
- **Global Privacy Control** — envia `Sec-GPC: 1` e `DNT: 1` em todas as requisições
- **Histórico** — `kitty://history`, agrupado por dia, com busca e remoção
- **Nova aba** — busca DuckDuckGo, total de bloqueios e sites recentes
- **Vídeos com DRM** — usa o Electron da Castlabs (com Widevine), então Crunchyroll, Netflix, Disney+ etc. conseguem tocar
- Página de erro própria e tema claro/escuro automático

## Atalhos

| Ação | Atalho |
| --- | --- |
| Nova aba | `⌘T` |
| Fechar aba | `⌘W` |
| Barra de endereço | `⌘L` |
| Histórico | `⌘Y` |
| Voltar / Avançar | `⌘[` / `⌘]` |
| Recarregar | `⌘R` |
| Ferramentas do desenvolvedor | `⌥⌘I` |

## Estrutura

```
src/main/   processo principal: abas, bloqueador, histórico, protocolo kitty://
src/ui/     barra de abas e barra de ferramentas
src/pages/  páginas internas (nova aba, histórico, erro)
assets/     ícone do app (SVG fonte, PNG e .icns)
scripts/    geração do ícone
```

Dados do usuário ficam em `~/Library/Application Support/Kitty`.
