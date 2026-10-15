# CLAUDE.md

Memória do projeto para quem chega agora (pessoa ou Claude). Leia antes de começar e atualize no mesmo commit (ou logo depois) sempre que um trabalho mudar o app, o processo ou os planos. Detalhes mais longos, histórico de bugs e diagnóstico estão em [docs/resumo-do-projeto.md](docs/resumo-do-projeto.md).

## O que é

O Kitty é um navegador focado em privacidade, no estilo do Brave, feito em Electron (Electron da Castlabs 44.1.0+wvcus, Chromium 152, com Widevine para vídeo com DRM). Licença MPL-2.0, repositório `CaioGobbi/kitty-browser` no GitHub. O projeto vai virar open source: não coloque segredos, tokens, e-mails nem caminhos pessoais em arquivos versionados.

| Plataforma | Situação |
| --- | --- |
| macOS (Apple Silicon) | Gerado e instalado localmente em `/Applications/Kitty.app`. Sem distribuição pública nem atualização automática (falta Developer ID da Apple) |
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
- `scripts/` — build do ícone, do módulo nativo, assinatura VMP no Mac e no Windows, release do Windows.
- `assets/` — ícones, `Info.extra.plist` do Mac, `installer.nsh` (registro do navegador no Windows).

Dados do usuário no Mac: `~/Library/Application Support/Kitty` (`settings.json`, `history.json`, `bookmarks.json`, `session.json`, `downloads.json`, listas `*-engine*.bin`).

## Recursos de destaque recentes

- **Importar de outro navegador** (0.2.4): em `kitty://settings` e no menu Favoritos. Favoritos não duplicam (por URL) e guardam a pasta de origem; a barra de favoritos mostra pastas de 1º nível como menus, e `kitty://bookmarks` agrupa por pasta. No macOS, quando o sistema bloqueia a leitura da pasta de outro navegador, o Kitty precisa de **Acesso Total ao Disco**; a tela de configurações detecta isso, avisa e explica o caminho em Ajustes do Sistema.
- **Ícones no acesso rápido** (0.2.4): a nova aba mostra o favicon mais recente de cada site (até 300 guardados); limpar o histórico apaga os ícones.
- **Abas fixadas, gestos e YouTube** (0.2.3): abas fixadas com animação, voltar/avançar com dois dedos usando as fases nativas do trackpad, e o YouTube sem scriptlets das listas, com um pulador próprio que esconde o anúncio. Ver o resumo para o porquê.

## Rodar, testar e gerar

| Comando | O que faz |
| --- | --- |
| `npm start` | Roda em desenvolvimento. `KITTY_PROFILE=<pasta> npm start` usa um perfil separado |
| `npm run build:native` | Compila o módulo nativo (precisa do Xcode completo) |
| `npm run dist` | Gera `out/Kitty-darwin-arm64/Kitty.app` com VMP e assinatura ad-hoc |
| `npm run install-app` | `dist` e copia para `/Applications` |
| `npm run dist:win` | Gera `out/windows/Kitty-Setup-<versão>.exe` |
| `npm run release:win` | Build do Windows, push e release no GitHub (ver abaixo) |
| `npm run icon` | Regera os ícones a partir de `assets/icon.svg` |

Para testar sem mexer no perfil real: `KITTY_PROFILE=<pasta> npx electron . --inspect=9229 --remote-debugging-port=9333` (processo principal na 9229, páginas via CDP na 9333). Mais truques de diagnóstico no resumo.

## Como publicar uma versão

1. Só com OK explícito do dono do projeto: cada release chega a todos os Kitty instalados no Windows.
2. Subir `version` no `package.json` e commitar ("Versão X.Y.Z: …").
3. `npm run release:win` (precisa de `gh auth login`). O script gera o instalador, dá push, cria o release `vX.Y.Z` e envia `.exe`, `.blockmap` e por último `latest.yml`, para ninguém ver a versão antes do instalador estar lá.
4. No Mac, `npm run install-app` atualiza o app local (não há distribuição pública).
5. Atualizar este arquivo (versão atual e histórico) e o resumo.

Cuidados de build: no packager, `--asar-integrity-digest=false` é obrigatório (senão a Castlabs recusa a assinatura VMP); no Mac a VMP vem antes da assinatura da Apple, no Windows depois; sem conta Castlabs EVS configurada os scripts só avisam e o app sai sem VMP.

## Combinados de trabalho

- Responder sempre em português e explicar mudanças em termos de uso, não de código.
- As threads do Claude trabalham sozinhas no Mac: rodam os comandos, abrem o Kitty, testam a mudança dentro do app e conferem o resultado, sem pedir que o dono rode nada.
- Pode fechar e reabrir o Kitty instalado quando precisar (`osascript -e 'tell application id "app.kitty.browser" to quit'`), mas reabrir normalmente no fim, sem deixar porta de depuração aberta.
- No perfil real, mexer só no mínimo e limpar depois (por exemplo, apagar do `history.json` as visitas feitas em teste).
- Várias threads podem mexer nesta pasta ao mesmo tempo: faça commit só dos seus arquivos e, antes de dar push, veja se há commits de outra thread ainda não enviados e se aquele trabalho já está pronto.
- Mudanças específicas do Windows só valem como certas depois do teste do dono num PC real.

## O que falta

- [ ] Testar no Windows as novidades da 0.2.3 e 0.2.4: YouTube, Crunchyroll com VMP, gesto de dois dedos (no Windows ainda sem fases nativas) e a importação.
- [ ] Investigar a demora de uns 5 s na primeira abertura de vídeo no YouTube (não isolada).
- [ ] Gerenciador de senhas (Keychain no Mac, cuidado com criptografia).
- [ ] Extensões do Chrome (o Electron só suporta parte).
- [ ] Importar do Safari (favoritos em `Bookmarks.plist`, histórico em `History.db`; exige Acesso Total ao Disco).
- [ ] Suporte a Linux, como próximo passo futuro. Não há máquina Linux para testar, então qualquer trabalho aqui precisa de outra forma de validação.
- [ ] Mac: atualização automática e distribuição exigem Developer ID da Apple (pago). Alternativa em aberto (esperando o OK do Jailson): publicar um `.zip` sem assinatura nas versões, com aviso no README para liberar em Privacidade e Segurança.
- [ ] Lançamento open source: o repositório já é público, com README voltado para quem chega (prints em `docs/screenshots/`, tirados com perfil limpo via `KITTY_PROFILE`). Falta divulgar.
- [ ] Windows: assinatura de código para tirar o aviso do SmartScreen (certificado pago).
- [ ] Lacunas de privacidade conhecidas: fingerprinting em workers carregados de URL e fontes no DOM; phishing só por listas abertas.
