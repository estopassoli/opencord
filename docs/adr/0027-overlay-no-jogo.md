# ADR-0027: Overlay dentro do jogo (janela transparente que deixa o clique passar)
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
Quem joga em tela cheia não vê quem está falando, se está mudo, nem avisos como "clipe salvo" ou "Fulano quer
controlar seu PC" (ADR-0026) — este último ficava só na barra piscando. O mantenedor pediu um overlay no estilo dos
apps de voz para jogos.

## Decisão
- **Uma segunda `BrowserWindow`** (`electron/main/overlay.ts`): sem moldura, transparente, `alwaysOnTop('screen-saver')`,
  sem foco, fora da barra de tarefas e com `setIgnoreMouseEvents(true)`: o clique passa para o jogo. 340×420 no canto
  escolhido da área de trabalho do monitor principal.
- **Só informação, sem IPC de volta.** A janela principal junta o estado (participantes e quem fala da store de voz,
  mudo/surdo, jogo detectado, avisos do app e pedido de controle remoto) em `src/lib/overlay.ts` e manda pelo canal
  `overlay:update` (validado com zod, `electron/shared/overlay.ts`); o processo principal repassa à janelinha por um
  preload próprio (`electron/preload/overlay.ts`, `overlay-preload.cjs`) que só expõe `onState`. A página é HTML
  inline (data URL) com escape de todo texto.
- **Quando aparece:** overlay ligado nas preferências **e** jogo detectado (ADR-0021) **e** (em chamada conectada ou
  aviso recente). Fora disso a janela fica escondida (não é destruída, para reaparecer sem piscar).
- **Preferências locais** (`localStorage`, `oc:overlay`): ligado por padrão, canto superior esquerdo. Ficam no
  computador, sem mexer no schema de configurações da API (que exigiria deploy).

## Alternativas descartadas
- Injetar no processo do jogo (hook de DirectX/Vulkan, como o overlay da Steam): anti-cheat, assinatura de código e
  manutenção por API gráfica. Fora de questão para uma instância de amigos.
- Reaproveitar a janela principal "sempre no topo": roubaria clique e espaço do jogo.

## Limitações reais
- Jogos em **tela cheia exclusiva** ficam por cima de qualquer janela: o overlay só aparece em janela sem borda ou
  janela comum (a maioria dos jogos modernos usa borderless por padrão).
- Só no monitor principal; o jogo em outro monitor não ganha overlay (fácil de evoluir se pedirem).
- Avatares são iniciais, não fotos: a página do overlay não carrega nada da rede.

## Evidências (2026-10-31)
- Captura real no Windows 11 do mantenedor (`overlay-check`: janela criada com o mesmo módulo, estado de exemplo):
  cartão da chamada "Geral" com três pessoas, anel verde em quem fala, "mudo", badge M, e dois avisos (clipe salvo,
  pedido de controle). Fundo transparente.
- Typecheck, lint e unitários do desktop; `build-electron` gera `overlay-preload.cjs`.
- **Não verificado ainda:** em cima de um jogo de verdade, com a chamada ao vivo (depende do instalador chegar).
