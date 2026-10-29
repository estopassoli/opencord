# F3/F4 — Voz, vídeo e Go Live dentro do app (evidências)

Data: 2026-10-29 · Máquina: a mesma do F0 (Windows 11 26200, RTX 5090). **Uma única máquina**: o gate de dois PCs em redes distintas continua BLOQUEADO PARA VALIDAÇÃO.

## E2E com duas instâncias reais do app (`apps/desktop/e2e/voice.spec.ts`)
Duas instâncias do Electron com dois usuários reais da API e a SFU LiveKit de dev. Silencioso: dispositivos falsos do Chromium (tom via `--use-file-for-fake-audio-capture`) e `--mute-audio`.

| Caso | Resultado |
|---|---|
| Entrar na mesma sala, ver os 2 participantes e acender o indicador de fala | PASS |
| Áudio de B chega em A (bytes recebidos crescendo) | PASS |
| Mute de B refletido em A | PASS |
| Câmera de B recebida em A (`videoWidth > 0`) | PASS |
| Go Live (captura **falsa** do Chromium): publicar, AO VIVO via webhook, assistir sob demanda, parar encerra para o espectador | PASS |
| Kick revoga a voz ativamente na SFU | PASS |

## Go Live com captura REAL (`apps/desktop/e2e/golive-real.spec.ts`)
Publisher sem dispositivos falsos (monitor real e loopback do sistema com `restrictOwnAudio`), microfone mutado e `--mute-audio`. Sem screenshots, por privacidade.

- Publisher: 1920×1080 capturado; o espectador recebeu a camada 960×540 (adaptive stream do tamanho do player). Áudio do sistema publicado (sem aviso de "sem áudio").
- **Encoder: H.264 em software com simulcast.** O Chromium 152 usa `SimulcastEncoderAdapter` (OpenH264) para simulcast. O NVENC só apareceu com camada única no spike F0.5.
- Camada única (sem simulcast) foi testada no app e ficou presa em 480×270 a ~1 fps, "limitada por banda", tanto via ICE/TCP quanto via UDP. Causa ainda não isolada. Decisão: manter simulcast (configuração validada). Investigar camada única com hardware fica como pendência.
- fps reportado baixo em tela estática (a captura só entrega quadros quando há mudança). O fps sob jogo real é teste manual.

## Ambiente de dev (achado)
O encaminhamento de localhost do WSL2 (NAT) cobre só TCP. O `scripts/dev-livekit.sh` anuncia o IP da VM do WSL como candidato ICE UDP. O log da SFU confirma `connectionType: udp` com o cliente Windows.

## Pendente (manual, hardware real)
Dois PCs Windows em redes distintas; jogo em borderless e fullscreen; fps e bitrate sob jogo; alt-tab, minimizar, troca de Wi-Fi; PTT com jogo em foco; espectador ouvindo o áudio do jogo. Nada disso foi executado.
