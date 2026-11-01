# ADR-0026: Controle remoto do PC de quem transmite (mouse e teclado pela sala do LiveKit)
Status: Accepted (pedido do mantenedor, 2026-10-31; validado com duas pessoas reais em 2026-10-31)

## Contexto
O mantenedor quer que alguém da chamada possa controlar o PC de outra pessoa, no estilo AnyDesk/TeamViewer, com o
dono aceitando e escolhendo o que libera. A tela já chega pela live (Go Live, ADR-0003/0025); falta levar o mouse e o
teclado de quem assiste até o Windows de quem transmite, com consentimento explícito e um jeito de cortar na hora.

## Decisão
- **Sem API nova.** Pedido, resposta e os eventos de entrada viajam como **pacotes de dados do LiveKit** (tópico
  `remote-control`, `destinationIdentities` = só a outra pessoa; movimentos do mouse em modo *lossy*, o resto confiável).
  A SFU carimba a identidade de quem manda (token assinado pelo servidor, ADR-0004), então o PC controlado só obedece a
  quem ele mesmo autorizou. Estar na mesma sala já implica estar no mesmo canal de voz. O Socket.IO continua sem mídia
  nem entrada (regra do CLAUDE.md), e a API não precisa de deploy para o recurso existir.
- **Consentimento:** quem assiste clica "Controlar o computador" na live. Do lado do dono abre uma janela do app
  (`askChoice`) com "Só o mouse" / "Mouse e teclado" / Cancelar; o app pisca na barra e manda uma notificação para quem
  está num jogo em tela cheia. Pedido sem resposta cai em 60 s; recusa impõe 15 s antes de pedir de novo; já controlado
  ou respondendo outro pedido responde "ocupado".
- **Só tela inteira, sem cena:** a posição do mouse vai relativa ao quadro (0–1) e o processo principal converte para os
  pixels físicos do monitor transmitido (`screen.dipToScreenRect` do display da fonte `screen:`). Live de janela ou com
  cena (ADR-0015) é recusada com o motivo.
- **`oc-input.exe`** (`native/win-input/OcInput.cs`, mesmo esquema do `oc-audio.exe`: C# compilado pelo `csc` do .NET
  Framework 4 que vem no Windows, `scripts/build-win-audio.mjs`): lê comandos de texto no stdin e chama `SendInput`.
  Mouse absoluto na área de trabalho virtual; teclas pelo **scancode físico** (`KeyboardEvent.code`), para teclado
  ABNT2 de um lado e americano do outro digitarem o que o layout do PC controlado manda. Fechar o stdin solta tudo que
  estiver apertado e encerra: nunca fica tecla presa.
- **Sempre dá para parar, dos dois lados:**
  - faixa sempre visível no topo do monitor controlado ("Fulano está controlando seu PC", botão **Parar**), uma
    `BrowserWindow` sem foco, acima de tudo, sem preload nem IPC (o botão troca o título da página);
  - atalho global de emergência **Ctrl+Alt+Shift+S** no PC controlado (rearmado quando os atalhos do usuário mudam) e o
    mesmo atalho, local, em quem controla;
  - acaba sozinho quando a live para, qualquer um sai da chamada, a janela recarrega, o app fecha ou passa 10 minutos
    sem nenhum evento;
  - do lado de quem controla: botão "Parar de controlar" e perder o foco solta todas as teclas (`r`).
- **Validação dupla:** o renderer valida cada pacote (zod, 256 bytes no máximo, teclas só da tabela) e o processo
  principal valida de novo antes de escrever no `oc-input` (`RemoteInputEvent`). Teclado só passa se o dono liberou.

## Alternativas descartadas
- Sinalizar o pedido pela API/Socket.IO: exigiria deploy e endpoints novos sem ganhar segurança, já que a identidade do
  LiveKit é a mesma do servidor.
- Módulo nativo Node (robotjs/nut.js): dependência binária por versão do Electron; o `csc` já está em todo Windows.
- Serviço do Windows para controlar janelas elevadas e a tela do UAC (como o TeamViewer): fora da primeira versão.

## Limitações reais
- Só quem **recebe** o controle precisa estar no Windows (e com o `oc-input.exe` do instalador); quem controla pode usar
  qualquer plataforma.
- UIPI: sem elevação, janelas de administrador, instaladores pedindo admin e Ctrl+Alt+Del ignoram a entrada injetada.
- Esc em tela cheia continua saindo da tela cheia do próprio Chromium antes de chegar ao PC controlado.
- Sem área de transferência compartilhada e sem transferência de arquivos. O áudio já vai pela chamada.
- A latência é a da live mais a dos pacotes (mesmo caminho pela SFU/TURN).

## Evidências (2026-10-31)
- Unitários: `apps/desktop/test/remote-input.test.ts` (conversão de posição → pixel, linhas do oc-input, validação das
  mensagens e das teclas).
- `oc-input.exe` compilado e executado no Windows 11 do mantenedor (área de trabalho virtual −1080,−1080 3640×2802, dois
  monitores): imprime `ready`, aceita `m X Y` e o cursor foi para o pixel pedido (diferença de 5 px na primeira
  leitura, 20 ms depois, com o mantenedor mexendo o mouse ao mesmo tempo: sem injetar nada o cursor andava até 728 px
  por 20 ms), e o processo encerra com código 0 ao fechar o stdin.
- **Validado em uso real (2026-10-31, relato do mantenedor):** pedido, aceite e controle entre duas pessoas da chamada,
  em máquinas Windows diferentes, com o instalador gerado do commit 9dd45c7 ("deu certinho").

## Complemento (2026-11-01): área de transferência e arquivo
- **Ctrl+V de quem controla**: o texto da área de transferência dele vai num pacote `clip` (até 12 000 caracteres),
  o PC controlado o põe na própria área de transferência (`clipboard.writeText`, só durante a sessão) e o V é apertado
  em seguida. Exige controle com teclado.
- **Soltar um arquivo na live**: `file` (id, nome, tamanho, total) seguido de pedaços **binários** com cabeçalho fixo
  (`src/voice/remote-file.ts`: byte mágico, id de 16 bytes, índice; 14 000 bytes de dados por pacote, dentro do
  limite dos pacotes de dados do LiveKit), na ordem e confiáveis. O processo principal grava em
  `Downloads/OpenCord/<nome limpo>` sem sobrescrever (sufixo " (n)"), recusa fora de ordem ou acima do tamanho
  anunciado, e apaga o parcial ao parar a sessão. Até 25 MB. Resposta `file-done` para quem enviou; aviso com
  "Mostrar na pasta" (restrito a essa pasta) para quem recebeu.
- Evidências: unitários `test/remote-file.test.ts` (cabeçalho, rejeição de JSON/pacote curto, contagem de pedaços,
  nomes seguros); typecheck e lint. **Pendente** uso real entre duas pessoas.

