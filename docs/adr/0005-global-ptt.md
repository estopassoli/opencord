# ADR-0005 — Push-to-talk global sem hook nativo de teclado
Status: Accepted (limitação documentada) · Data: 2026-10-29

## Contexto
O PTT ideal precisa de key-down e key-up globais, com o jogo em foco. O `globalShortcut` do Electron só informa o *pressionar* (sem key-up). Hooks globais de baixo nível (ex.: `uiohook-napi`) exigem módulo nativo e capturam todas as teclas do sistema, o que é um risco de privacidade e de antivírus/anti-cheat.

## Decisão
- Com a janela do OpenCord em foco: PTT real (segurar), via `keydown`/`keyup`, com atraso de soltura configurável e fechamento imediato no `blur`.
- Fora de foco (jogo): atalho global em **modo alternância** (pressiona para abrir e de novo para fechar), mais atalhos globais de mute/deafen.
- Sem hook global de teclado na V1.

## Consequências
- PTT "segurar" com o jogo em foco não está disponível; a UI e a documentação explicam isso.
- Reavaliar um módulo nativo (Raw Input do Windows restrito à tecla configurada) se os usuários pedirem, com ADR próprio e testes com anti-cheat.
