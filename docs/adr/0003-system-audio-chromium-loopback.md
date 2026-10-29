# ADR-0003 — Áudio do sistema via loopback do Chromium (sem módulo nativo na V1)
Status: Proposed (aguardando validação em duas máquinas)
Data: 2026-10-29

## Contexto
O Go Live precisa publicar `screen_audio` no Windows 11. O ADR-0002 previa um possível módulo nativo (WGC + WASAPI). O spike F0.4 (`docs/research/F0_FEASIBILITY.md`) mediu em Electron 44.7.1 / Chromium 152:
- `setDisplayMediaRequestHandler` com `audio: 'loopback'` entrega uma trilha com o mix do sistema, incluindo áudio de outros processos.
- `restrictOwnAudio: true` exclui o áudio do próprio app (vozes da chamada) do loopback.

## Decisão
Na V1, capturar o áudio do sistema com o loopback do Chromium e `restrictOwnAudio: true`, atrás da interface `CaptureProvider` do `packages/media`. Não criar módulo nativo agora.

## Alternativas
- WASAPI process loopback em módulo nativo: permite áudio só de um aplicativo (o jogo) e exclusão robusta da árvore de processos do OpenCord. Exige toolchain C++, assinatura e manutenção por versão do Electron. Fica adiado e é reavaliado se os critérios abaixo falharem.
- Loopback sem `restrictOwnAudio`: rejeitado, porque reinjeta as vozes da chamada na stream.

## Consequências
- Captura o mix inteiro (notificações, música, outros apps). A UI deve deixar isso claro ao usuário.
- Depende do comportamento do Chromium, então cada upgrade do Electron precisa reexecutar o selftest de `spikes/f0.3-electron-capture`.
- Critérios para reabrir este ADR: falha de captura de processo externo com `restrictOwnAudio` reproduzida, eco das vozes da chamada no espectador, ou demanda por áudio por aplicativo.
