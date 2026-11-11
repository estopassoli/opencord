# OpenCord em Tauri

App desktop em Tauri 2, ao lado do Electron (ADR-0062). **Ainda não é o app oficial**: não se atualiza sozinho e não
substitui o `apps/desktop` até ter tudo o que ele tem (inclusive o Go Live nativo em Rust, fora do WebView). A
interface é exatamente a do `apps/desktop/src` (mesmo código React), carregada no WebView2 do Windows.
O lugar do processo principal do Electron é ocupado por um processo em Rust (`src-tauri`). A ponte `window.opencord`
(`src/bridge.ts`) implementa o mesmo contrato (`apps/desktop/electron/shared/ipc.ts`) com os mesmos schemas.

## Compilar (do WSL, compila no Windows)

Precisa no Windows: Rust (`rustup`, alvo `x86_64-pc-windows-msvc`) e Visual Studio Build Tools com o SDK do Windows.
Antes, o `oc-audio.exe`/`oc-input.exe` do `apps/desktop` (`node apps/desktop/scripts/build-win-audio.mjs`).

```sh
pnpm --filter @opencord/desktop-tauri build:win            # só o .exe
pnpm --filter @opencord/desktop-tauri build:win -- --bundle # + instalador NSIS
```

O código é copiado para `%LOCALAPPDATA%\OpenCordTauri\src` e compilado lá. Para depurar ou medir pelo DevTools, abra
o app com `OPENCORD_TAURI_DEBUG_PORT=9333` (DevTools remoto só em 127.0.0.1).

## Comparar o consumo

`scripts/compare.ps1` (PowerShell no Windows) soma a árvore de processos de cada app aberto e mede memória e CPU. No
Tauri, a árvore inclui os processos do WebView2. Deixe os dois na mesma situação: mesma tela, mesma chamada, mesma live.

Primeira medição (07/11/2026, tela de login, mesmo PC, 30 s):

| | Electron 0.2.348 | Tauri |
|---|---|---|
| Instalador | 121 MB | 3,6 MB |
| Instalado | 372 MB | 7,3 MB (.exe) + WebView2 do Windows |
| Processos | 4 | 8 |
| Memória em uso | 643 MB | 460 MB |
| Memória privada | 198 MB | 230 MB |
| CPU parado | ~0 % | ~0 % |

O WebView2 também é um Chromium, então a memória privada (a que é só do app) fica praticamente igual. A economia
aparece no download e no disco, e numa parte da memória compartilhada.

## O que funciona igual

Login e sessão salva (DPAPI), barra de título própria (arrastar, maximizar), bandeja com mudo, surdo e sair da
chamada, fechar esconde na bandeja, instância única, atalhos globais, notificações, piscar na barra de tarefas, ponto de
não lidas, links externos no navegador, detecção de jogos e do OBS, clipes (salvar, listar, abrir, apagar, copiar,
exportar, trocar a pasta), som de cada saída e "tudo menos o OpenCord" na live (`oc-audio.exe`), controle remoto
(`oc-input.exe`, faixa com "Parar" e Ctrl+Alt+Shift+S), overlay no jogo, transmissão desanexada, memória por processo
(Configurações → Sobre), aceleração de hardware ligada/desligada e a mesma impressão digital do aparelho (ADR-0036).

## Diferenças conhecidas

- **Go Live e clipes:** o WebView2 não deixa o app escolher a fonte da captura. O seletor do OpenCord mostra
  "Escolher aplicativo" e "Escolher tela"; a escolha de verdade é feita no seletor do próprio WebView2. Os clipes só
  começam a gravar depois de um clique (o Chromium exige um gesto para capturar a tela).
- **Controle remoto:** vale o monitor principal (a live não informa qual monitor foi escolhido).
- **Notificação:** clicar nela não abre a conversa.
- **Sem atualização automática e sem ícone do jogo detectado.**
- A API aceita a origem `http://tauri.localhost` e o cabeçalho `x-hardware-id` (CORS em `apps/api/src/bootstrap.ts`).
