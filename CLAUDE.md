# CLAUDE.md

Explicação do projeto para quem chega agora, pessoa ou Claude. Atualize no mesmo commit (ou logo depois) sempre que um trabalho mudar o app, o processo de build ou os planos.

## O que é

O Kitty é um navegador focado em privacidade, no estilo do Brave, feito em Electron (Electron da Castlabs 44.1.0+wvcus, Chromium 152, com Widevine para vídeo com DRM). Licença MPL-2.0, repositório `CaioGobbi/kitty-browser` no GitHub. O código é aberto: não coloque segredos, tokens, e-mails nem caminhos pessoais em arquivos versionados.

| Plataforma | Situação |
| --- | --- |
| macOS (Apple Silicon) | Gerado e instalado localmente em `/Applications/Kitty.app`. DMG sem assinatura da Apple em cada release (desde a 0.2.4); sem atualização automática (falta Developer ID da Apple) |
| Windows 10/11 x64 | Instalador NSIS publicado no GitHub Releases, com atualização automática |
| Linux | Não suportado ainda; ver "O que falta" |

**Versão atual: 0.3.0** (publicada no Windows e no Mac em 16/10/2026). Histórico: 0.2.0 primeira pública · 0.2.1 teste da atualização automática · 0.2.2 assinatura VMP (Crunchyroll) · 0.2.3 abas fixadas, gestos do trackpad e correções do YouTube · 0.2.4 importação de outros navegadores e ícones no acesso rápido · 0.3.0 favoritos editáveis, gerenciador de senhas e assinatura "Kitty Local" no Mac.

## Mapa do código

- `src/main/` — processo principal.
  - `main.js`: inicialização, IPC, favoritos, sugestões, configurações, navegador padrão, ícones do acesso rápido.
  - `window.js`: janelas (`BaseWindow`), abas (uma `WebContentsView` cada), layout, tela cheia, busca na página, histórico, permissões. Cada aba guarda a janela dona em `tab.owner` e pode trocar de janela (`releaseTab`/`adoptTab`): os eventos da aba usam `tab.owner`, nunca a janela capturada na criação.
  - `tabdrag.js`: arrastar uma aba para fora da barra, no modelo do `TabDragController` do Chromium: vira uma janela que segue o cursor (sem recarregar a página) e entra na barra de qualquer janela por onde passar.
  - `privacy.js`: escudos, bloqueio (Ghostery), scriptlets, HTTPS automático, cookies, sites perigosos, tratamento do YouTube.
  - `bookmarks.js`: edição dos favoritos (adicionar, editar, mover, excluir), usada pela barra e por `kitty://bookmarks`. Favoritos e pastas ficam numa lista só, em ordem; pastas são itens `type: 'folder'` (podem ficar vazias) e cada item guarda o caminho da pasta em `folder`.
  - `importer.js`: importação de favoritos (com pastas) e histórico de Chrome, Brave, Edge, Vivaldi, Opera, Arc, Chromium e Firefox, lendo os arquivos locais, sem rede.
  - `passwords.js`: senhas salvas (`passwords.json`, cada senha criptografada pelo sistema via `safeStorage`), a barra "Salvar a senha?" e a página de senhas. A detecção do login e o preenchimento ficam em `preload-page.js`.
  - `siteinfo.js`: painel de informações do site (botão à esquerda do endereço) e a página `kitty://site`: guarda o certificado de cada host (`setCertificateVerifyProc`, sem mudar a verificação do Chromium), conta e apaga cookies e dados do site, e liga/desliga o fingerprinting por site (`fingerprintOff` nas configurações).
  - `lists.js` (listas de bloqueio: a cópia que vem no app em `src/lists/`, gerada no build e fora do git, e as atualizações, só com permissão), `downloads.js`, `menus.js` (menus e atalhos), `updater.js` (atualização no Windows), `gestures.js` (gestos), `data.js`, `store.js`, `registry.js`.
  - Preloads: `preload-ui.js` (interface), `preload-page.js` (páginas `kitty://` e gestos), `preload-fingerprint.js`, `preload-scriptlets.js` (inclui o pulador de anúncios do YouTube).
- `src/ui/` — barra de abas, endereço e painéis (a vista de cima de cada janela). O painel do site fica em `siteinfo.js`/`siteinfo.css`; os layouts das abas, em `layouts.css` (as mesmas peças mudam de lugar em `applyLayout`, no `ui.js`).
- `src/pages/` — páginas internas `kitty://setup`, `newtab`, `history`, `bookmarks`, `settings`, `passwords`, `site` (configurações de um site, `kitty://site?origin=…`), `blocked`, `error`.
- `native/swipe-phase/` — módulo nativo (Objective-C, N-API) que lê as fases do trackpad no Mac; compilado para `src/main/native/` (fora do git).
- `scripts/` — build do ícone, do módulo nativo, assinatura VMP no Mac e no Windows, release do Windows e do Mac.
- `assets/` — ícones, `Info.extra.plist` do Mac, `installer.nsh` (registro do navegador no Windows).

Dados do usuário no Mac: `~/Library/Application Support/Kitty` (`settings.json`, `history.json`, `bookmarks.json`, `session.json`, `downloads.json`, `passwords.json`, listas `*-engine*.bin`).

## Recursos de destaque recentes

- **Nova aba sem caixa de pesquisa** (ainda não publicado): `kitty://newtab` mostra só o logo e o acesso rápido (sem caixa de pesquisa nem os números do bloqueio); para pesquisar usa-se a barra de endereço, que já recebe o cursor ao abrir a aba, em qualquer layout. A página nova toma o foco quando o Chromium a monta, então `window.js` devolve o foco à barra até a página terminar de carregar (`keepAddressFocus`).
- **Layouts das abas** (ainda não publicado): em Configurações, no menu Visualizar e no botão direito da aba, escolhe-se Clássico (padrão, abas em cima da barra de endereço), Compacto (navegação, endereço, abas e botões numa linha só, como no Helium) ou Abas verticais (coluna à esquerda, que recolhe para só os ícones). Vale na hora, em todas as janelas. Com abas verticais a vista da interface cobre a janela toda e a página fica por cima dela (`window.js`, `layout`); um menu aberto traz a interface de volta para cima. A interface informa onde ficam as abas (`setChrome`, campo `strip`) para o arrastar entre janelas (`tabdrag.js`) funcionar de lado também. Testado no Mac; falta o dono testar, e o Windows (botões da janela no canto da linha de cima).

- **Boas-vindas com consentimento** (ainda não publicado; ideia tirada do Helium, sem código dele): na primeira abertura o Kitty não faz nenhuma conexão por conta própria e abre `kitty://setup`, em 4 passos: boas-vindas, buscador (e sugestões), conexões automáticas (atualizar listas, atualizar o Kitty no Windows, Widevine) e importar de outro navegador. Até a pessoa clicar em "Começar a navegar" (`setupDone`), ficam desligados: download das listas, procura de atualização, sugestões de pesquisa, Widevine (o Chromium pinga o Google mesmo com atualizações desligadas, então sai com `disable-component-update`; ligar o Widevine vale ao reabrir) e o DNS seguro (o Chromium testa o provedor ao abrir). As listas vêm dentro do app (`npm run lists`, chamado no `predist`, no `predist:win` e no `release-win.sh`), então o bloqueio funciona offline desde o início. Quem atualiza de uma versão anterior vê a tela uma vez, com as escolhas atuais marcadas; enquanto não termina, ela volta a cada abertura. Tudo fica editável em Configurações, que também tem o botão para reabrir a tela. Testado no Mac com o net-log do Chromium: zero conexões antes de terminar. Falta testar no Windows (lá o Electron pode baixar dicionários de ortografia, não verificado).
- **Menu de informações do site** (ainda não publicado): no lugar do cadeado, um botão de ajustes (ou o aviso "Não seguro") abre um painel com o domínio e quatro linhas, no estilo do Chrome e do Helium: segurança da conexão (com os dados do certificado), proteção contra fingerprinting (desligável só naquele site; a página recarrega), cookies e dados do site (quantos, de quais endereços, e apagar) e Configurações do site, que abre `kitty://site` com câmera, microfone, localização, notificações e as outras permissões que o site já pediu (Perguntar/Permitir/Bloquear), escudos, fingerprinting, "oferecer salvar senhas" e apagar dados. Em janela privativa as permissões mudadas ali valem só para aquela janela. Funciona nos layouts clássico, compacto e de abas verticais. Os dados do certificado aparecem a partir da primeira conexão do Kitty com o host em cada execução.
- **Aba para outra janela** (ainda não publicado): igual ao Chromium (de onde Chrome, Brave e Helium herdam; o Helium não muda nada nisso). Puxar a aba 15 px para fora da barra cria uma janela com ela, que acompanha o cursor; a página segue rodando (vídeo não recarrega). Passar por cima da barra de qualquer janela do Kitty, inclusive a de origem, já põe a aba ali, onde dá para deslizar ou puxar de novo; Esc desfaz. Janela de uma aba só é arrastada inteira (e some, sem fechar, enquanto a aba está em outra barra). Fixadas continuam fixadas; aba privativa só vai para janela privativa e compartilha a sessão (apagada só quando a última dessas janelas fecha). Aprovado pelo dono no Mac; falta testar no Windows.
- **Barra de favoritos editável** (0.3.0): arrastar para reordenar, soltar sobre uma pasta para pôr dentro e arrastar de dentro da pasta para a barra; botão direito com Editar, Excluir, Renomear/Excluir pasta, Adicionar página e Nova pasta (janelinha própria na interface). Em `kitty://bookmarks`: grupos por pasta, arrastar, "Mover para…" e Nova pasta.
- **Gerenciador de senhas** (0.3.0): tudo local, sem sincronização. Ao enviar um formulário de login, a aba mostra "Salvar a senha?" (ou "Atualizar"), com "Nunca neste site". Na próxima visita, uma conta só é preenchida sozinha em páginas seguras (HTTPS ou localhost); com várias, aparece uma lista ao clicar no campo. `kitty://passwords` mostra, copia, edita e apaga; em Macs com Touch ID, mostrar ou copiar pede a digital (vale 5 min). Nada é salvo em janela privativa. Limitações: só o quadro principal da página (não iframes), e um login que falha e recarrega a página também oferece salvar. A chave das senhas é a mesma "Kitty Safe Storage" dos cookies, no Keychain; com a assinatura "Kitty Local" uma versão nova continua lendo as senhas sem pedir nada (testado com cdhash diferente e o mesmo certificado).
- **Importar de outro navegador** (0.2.4): em `kitty://settings` e no menu Favoritos. Favoritos não duplicam (por URL) e guardam a pasta de origem; a barra de favoritos mostra pastas de 1º nível como menus, e `kitty://bookmarks` agrupa por pasta. No macOS, quando o sistema bloqueia a leitura da pasta de outro navegador, o Kitty precisa de **Acesso Total ao Disco**; a tela de configurações mostra esses navegadores com um cadeado e o botão "Dar permissão" abre Ajustes do Sistema. Com assinatura ad-hoc o requisito do app é o cdhash, que muda a cada build, e o macOS esquece a permissão a cada atualização (o Kitty segue aparecendo ligado, mas é preciso removê-lo com − e adicionar de novo com +). Por isso o Mac é assinado com o certificado "Kitty Local" (ver "Cuidados de build").
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
| `npm run lists` | Baixa as listas de bloqueio para `src/lists/` (vão dentro do app; roda sozinho antes de cada build) |

Para testar sem mexer no perfil real: `KITTY_PROFILE=<pasta> npx electron . --inspect=9229 --remote-debugging-port=9333` (processo principal na 9229, páginas via CDP na 9333).

## Como publicar uma versão

1. Cada release chega a todos os Kitty instalados no Windows, então só publique o que já foi testado.
2. Subir `version` no `package.json` e commitar ("Versão X.Y.Z: …").
3. `npm run release:win` (precisa de `gh auth login`). O script gera o instalador, dá push, cria o release `vX.Y.Z` e envia `.exe`, `.blockmap` e por último `latest.yml`, para ninguém ver a versão antes do instalador estar lá.
4. `npm run release:mac`: gera o `Kitty.app`, empacota em `out/Kitty-X.Y.Z-mac-arm64.dmg` e anexa ao mesmo release. Recusa rodar com alterações sem commit, porque o DMG sai da pasta atual.
   - Se a pasta tiver trabalho em andamento de outra pessoa, gere numa cópia limpa: `git worktree add --detach <pasta> <commit>`, copie `node_modules` (`cp -Rc`) e ligue `.venv` com um link simbólico (sem ele o Windows sai sem VMP, só com um aviso). Como o worktree fica sem branch, faça o push do `main` e os passos do `gh release` à mão, na ordem dos scripts.
5. No Mac, `npm run install-app` atualiza o app local.
6. Atualizar este arquivo (versão atual e histórico).

Cuidados de build: no packager, `--asar-integrity-digest=false` é obrigatório (senão a Castlabs recusa a assinatura VMP); no Mac a VMP vem antes da assinatura da Apple, no Windows depois; sem conta Castlabs EVS configurada os scripts só avisam e o app sai sem VMP. No Mac, `scripts/sign-mac.sh` assina com o certificado autoassinado "Kitty Local" (Keychain de login do Mac do dono, válido até 2036), para o macOS manter permissões como o Acesso Total ao Disco entre versões, inclusive para quem instala pelo DMG. Todas as builds e releases de Mac devem sair com ele: **não recrie o certificado** (um novo faz a permissão cair para todo mundo). Sem ele na máquina, o script avisa e cai para ad-hoc.

## O que falta

- [ ] Investigar a demora de uns 5 s na primeira abertura de vídeo no YouTube (não isolada).
- [ ] Senhas: importar de outros navegadores; pedir a senha do Windows antes de mostrar (hoje só o Mac com Touch ID pede); preencher em iframes.
- [ ] Extensões do Chrome (o Electron só suporta parte).
- [ ] Importar do Safari (favoritos em `Bookmarks.plist`, histórico em `History.db`; exige Acesso Total ao Disco).
- [ ] Suporte a Linux, como próximo passo futuro. Sem máquina Linux para testar, a validação precisa ser feita de outra forma (por exemplo, numa máquina virtual).
- [ ] Mac: assinatura da Apple e atualização automática exigem Developer ID (pago). Enquanto isso, cada versão leva um DMG sem assinatura da Apple (`npm run release:mac`, depois do `release:win`, com o código sem alterações pendentes); o README ensina a liberar em Privacidade e Segurança. Primeiro DMG publicado: 0.2.4.
- [ ] Divulgar o projeto. O README é voltado para quem chega (prints em `docs/screenshots/`, tirados com perfil limpo via `KITTY_PROFILE`). Doações pelo GitHub Sponsors e pelo Buy Me a Coffee, configuradas em `.github/FUNDING.yml` (botão "Sponsor" do repositório) e na seção "Apoiar" do README.
- [ ] Windows: assinatura de código para tirar o aviso do SmartScreen (certificado pago).
- [ ] Lacunas de privacidade conhecidas: fingerprinting em workers carregados de URL e fontes no DOM; phishing só por listas abertas.
