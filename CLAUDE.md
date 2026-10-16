# CLAUDE.md

Explicação do projeto para quem chega agora, pessoa ou Claude. Atualize no mesmo commit (ou logo depois) sempre que um trabalho mudar o app, o processo de build ou os planos.

## O que é

O Kitty é um navegador focado em privacidade, no estilo do Brave, feito em Electron (Electron da Castlabs 44.1.0+wvcus, Chromium 152, com Widevine para vídeo com DRM). Licença MPL-2.0, repositório `CaioGobbi/kitty-browser` no GitHub. O código é aberto: não coloque segredos, tokens, e-mails nem caminhos pessoais em arquivos versionados.

| Plataforma | Situação |
| --- | --- |
| macOS (Apple Silicon) | Gerado e instalado localmente em `/Applications/Kitty.app`. DMG sem assinatura da Apple em cada release (desde a 0.2.4); sem atualização automática (falta Developer ID da Apple) |
| Windows 10/11 x64 | Instalador NSIS publicado no GitHub Releases, com atualização automática |
| Linux | Não suportado ainda; ver "O que falta" |

**Versão atual: 0.2.4** (publicada no Windows em 15/10/2026). Histórico: 0.2.0 primeira pública · 0.2.1 teste da atualização automática · 0.2.2 assinatura VMP (Crunchyroll) · 0.2.3 abas fixadas, gestos do trackpad e correções do YouTube · 0.2.4 importação de outros navegadores e ícones no acesso rápido.

## Mapa do código

- `src/main/` — processo principal.
  - `main.js`: inicialização, IPC, favoritos, sugestões, configurações, navegador padrão, ícones do acesso rápido.
  - `window.js`: janelas (`BaseWindow`), abas (uma `WebContentsView` cada), layout, tela cheia, busca na página, histórico, permissões.
  - `privacy.js`: escudos, bloqueio (Ghostery), scriptlets, HTTPS automático, cookies, sites perigosos, tratamento do YouTube.
  - `importer.js`: importação de favoritos (com pastas) e histórico de Chrome, Brave, Edge, Vivaldi, Opera, Arc, Chromium e Firefox, lendo os arquivos locais, sem rede.
  - `lists.js` (listas atualizadas sozinhas), `downloads.js`, `menus.js` (menus e atalhos), `updater.js` (atualização no Windows), `gestures.js` (gestos), `data.js`, `store.js`, `registry.js`.
  - Preloads: `preload-ui.js` (interface), `preload-page.js` (páginas `kitty://` e gestos), `preload-fingerprint.js`, `preload-scriptlets.js` (inclui o pulador de anúncios do YouTube).
- `src/ui/` — barra de abas, endereço e painéis (a vista de cima de cada janela).
- `src/pages/` — páginas internas `kitty://newtab`, `history`, `bookmarks`, `settings`, `blocked`, `error`.
- `native/swipe-phase/` — módulo nativo (Objective-C, N-API) que lê as fases do trackpad no Mac; compilado para `src/main/native/` (fora do git).
- `scripts/` — build do ícone, do módulo nativo, assinatura VMP no Mac e no Windows, release do Windows e do Mac.
- `assets/` — ícones, `Info.extra.plist` do Mac, `installer.nsh` (registro do navegador no Windows).

Dados do usuário no Mac: `~/Library/Application Support/Kitty` (`settings.json`, `history.json`, `bookmarks.json`, `session.json`, `downloads.json`, listas `*-engine*.bin`).

## Recursos de destaque recentes

- **Importar de outro navegador** (0.2.4): em `kitty://settings` e no menu Favoritos. Favoritos não duplicam (por URL) e guardam a pasta de origem; a barra de favoritos mostra pastas de 1º nível como menus, e `kitty://bookmarks` agrupa por pasta. No macOS, quando o sistema bloqueia a leitura da pasta de outro navegador, o Kitty precisa de **Acesso Total ao Disco**; a tela de configurações detecta isso, avisa e explica o caminho em Ajustes do Sistema.
- **Ícones no acesso rápido** (0.2.4): a nova aba mostra o favicon mais recente de cada site (até 300 guardados); limpar o histórico apaga os ícones.
- **Abas fixadas, gestos e YouTube** (0.2.3): abas fixadas com animação, voltar/avançar com dois dedos usando as fases nativas do trackpad, e o YouTube sem scriptlets das listas, com um pulador próprio que esconde o anúncio.

## Rodar, testar e gerar

| Comando | O que faz |
| --- | --- |
| `npm start` | Roda em desenvolvimento. `KITTY_PROFILE=<pasta> npm start` usa um perfil separado |
| `npm run build:native` | Compila o módulo nativo (precisa do Xcode completo) |
| `npm run dist` | Gera `out/Kitty-darwin-arm64/Kitty.app` com VMP e assinatura ad-hoc |
| `npm run install-app` | `dist` e copia para `/Applications` |
| `npm run dist:win` | Gera `out/windows/Kitty-Setup-<versão>.exe` |
| `npm run release:win` | Build do Windows, push e release no GitHub (ver abaixo) |
| `npm run release:mac` | DMG do Mac anexado ao release da versão atual (rodar depois do `release:win`) |
| `npm run icon` | Regera os ícones a partir de `assets/icon.svg` |

Para testar sem mexer no perfil real: `KITTY_PROFILE=<pasta> npx electron . --inspect=9229 --remote-debugging-port=9333` (processo principal na 9229, páginas via CDP na 9333).

## Como publicar uma versão

1. Cada release chega a todos os Kitty instalados no Windows, então só publique o que já foi testado.
2. Subir `version` no `package.json` e commitar ("Versão X.Y.Z: …").
3. `npm run release:win` (precisa de `gh auth login`). O script gera o instalador, dá push, cria o release `vX.Y.Z` e envia `.exe`, `.blockmap` e por último `latest.yml`, para ninguém ver a versão antes do instalador estar lá.
4. `npm run release:mac`: gera o `Kitty.app`, empacota em `out/Kitty-X.Y.Z-mac-arm64.dmg` e anexa ao mesmo release. Recusa rodar com alterações sem commit, porque o DMG sai da pasta atual.
5. No Mac, `npm run install-app` atualiza o app local.
6. Atualizar este arquivo (versão atual e histórico).

Cuidados de build: no packager, `--asar-integrity-digest=false` é obrigatório (senão a Castlabs recusa a assinatura VMP); no Mac a VMP vem antes da assinatura da Apple, no Windows depois; sem conta Castlabs EVS configurada os scripts só avisam e o app sai sem VMP.

## O que falta

- [ ] Investigar a demora de uns 5 s na primeira abertura de vídeo no YouTube (não isolada).
- [ ] Gerenciador de senhas (Keychain no Mac, cuidado com criptografia).
- [ ] Extensões do Chrome (o Electron só suporta parte).
- [ ] Importar do Safari (favoritos em `Bookmarks.plist`, histórico em `History.db`; exige Acesso Total ao Disco).
- [ ] Suporte a Linux, como próximo passo futuro. Sem máquina Linux para testar, a validação precisa ser feita de outra forma (por exemplo, numa máquina virtual).
- [ ] Mac: assinatura da Apple e atualização automática exigem Developer ID (pago). Enquanto isso, cada versão leva um DMG sem assinatura da Apple (`npm run release:mac`, depois do `release:win`, com o código sem alterações pendentes); o README ensina a liberar em Privacidade e Segurança. Primeiro DMG publicado: 0.2.4.
- [ ] Divulgar o projeto. O README é voltado para quem chega (prints em `docs/screenshots/`, tirados com perfil limpo via `KITTY_PROFILE`). Doações pelo GitHub Sponsors e pelo Buy Me a Coffee, configuradas em `.github/FUNDING.yml` (botão "Sponsor" do repositório) e na seção "Apoiar" do README.
- [ ] Windows: assinatura de código para tirar o aviso do SmartScreen (certificado pago).
- [ ] Lacunas de privacidade conhecidas: fingerprinting em workers carregados de URL e fontes no DOM; phishing só por listas abertas.
