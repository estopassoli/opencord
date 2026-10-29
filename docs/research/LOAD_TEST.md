# F6.2 — Teste de carga da SFU (local)

Data: 2026-10-29 · Script: `apps/api/load/voice-load.mjs` · LiveKit 1.13.10 (WSL2, Ryzen 9 9950X3D2).

Cenário: 10 participantes, cada um publicando áudio Opus sintético (tom contínuo) e assinando tudo; 3 deles também publicam vídeo 1280×720@30 com simulcast; janela de medição de 30 s após 5 s de aquecimento.

| Métrica | Valor |
|---|---|
| CPU do `livekit-server` | 36% de um núcleo |
| RSS do `livekit-server` | 166 MiB |
| Frames recebidos por participante | ≥ 930/s (9 áudios × 100/s + vídeo), sem participante faltando |

Resultado bruto: `apps/api/load/result-10x3.json`.

## Limitações (não extrapolar)
- Mesma máquina, sem rede real: não mede perda, jitter, NAT nem banda de saída do servidor.
- Vídeo sintético (quadros uniformes) comprime muito melhor que tela ou jogo real, então a banda está subestimada.
- Clientes `rtc-node`, não o Chromium/Electron: o custo de codificação no cliente não está representado.
- Antes de dimensionar uma VPS, medir em produção com streams reais (DEPLOYMENT.md).
