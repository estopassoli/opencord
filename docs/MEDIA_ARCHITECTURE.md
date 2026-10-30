# Mídia: voz, vídeo e Go Live

## Decisão
LiveKit self-hosted como SFU WebRTC; coturn para TURN/STUN. Não implementar SFU própria. API controla entrada, permissão e tokens; SFU transporta mídia.

## Trilhas
`microphone`, `camera`, `screen_video`, `screen_audio`. Publicação de tela e áudio são independentes e sincronizadas quando possível. O espectador pode assinar apenas o necessário; desativar vídeo não visível e adaptar qualidade.

## Voz
Opus; AEC, NS e AGC quando suportados; PTT global; VAD; volume individual local; mute/deafen; escolha de dispositivos; reconexão com backoff e estado visível. Não armazenar áudio.

## Go Live Windows
Fazer **spike de viabilidade antes da UI final**. Avaliar Electron `desktopCapturer`, `getDisplayMedia`, suporte do Chromium para áudio do sistema, Windows Graphics Capture e WASAPI loopback. Se necessário, criar módulo nativo separado. Diferenciar captura de monitor, janela e jogo em fullscreen; DRM e janelas protegidas não devem ser contornadas.

**Resultado do spike (2026-10-29):** loopback do Chromium com `restrictOwnAudio: true` captura áudio do sistema sem módulo nativo (ADR-0003). Detalhes e limites em `research/F0_FEASIBILITY.md`.

## Perfis aspiracionais
720p30, 1080p60, 1440p60; limitar conforme dispositivo, codec, CPU/GPU, banda e capacidade da SFU. Preferir encoder por hardware quando efetivamente disponível. Nunca garantir perfil por mera seleção no UI.

## API de captura proposta
```ts
interface CaptureSource { id: string; name: string; kind: 'screen'|'window'; thumbnail?: string }
interface CaptureOptions { sourceId: string; width: number; height: number; fps: 30|60; systemAudio: boolean }
interface CaptureSession { id: string; stop(): Promise<void> }
interface CaptureProvider {
  listSources(): Promise<CaptureSource[]>;
  start(options: CaptureOptions): Promise<CaptureSession>;
}
```
Implementar com bridge Electron validada, sem expor APIs nativas ao renderer.

## Gestão de salas
Uma sessão de voz ativa por usuário/dispositivo conforme política de instância. API gera room name opaco, token curto e grants restritos. Kick/ban exige remoção ativa do LiveKit, não apenas alteração no banco.

## Falhas e observabilidade
Monitorar ICE candidate failures, RTT, jitter, packet loss, bitrate, encode FPS, CPU/GPU quando disponível. Fonte removida e permissão revogada devem encerrar stream imediatamente. Reconexão não pode duplicar publicações.

## Matriz manual obrigatória
- Windows 11 + dois computadores em redes diferentes.
- Microfone bilateral, mute/deafen/PTT.
- Compartilhar monitor com áudio do sistema; janela com áudio quando suportado.
- Testar jogo em borderless e fullscreen (registrar limitações).
- 2 streams simultâneas e espectadores alternando.
- Alt-tab, minimizar, desconectar Wi-Fi, trocar dispositivos e sair da sala.
- Registrar codec, FPS real, perda de pacotes e limitações.

## Live com jogo pesado (2026-10-29)
- Relato: com um jogo pesado rodando liso, a live engasgava.
- Causa provável: o jogo em tela cheia cobre a janela do OpenCord, o Windows a marca como ocluída e o Chromium rebaixava a prioridade do renderer, que captura e codifica a live. Com CPU/GPU disputados, ele perdia quadros.
- Mitigação no desktop:
  - switches `disable-backgrounding-occluded-windows` e `disable-features=CalculateNativeWinOcclusion`;
  - ao iniciar uma live, os processos GPU e renderer sobem para prioridade *acima do normal* (`os.setPriority`).
- Validado: E2E `golive-real.spec.ts` passa com as mudanças.
- **Não validado:** o efeito com jogo pesado real em Windows. Status: BLOQUEADO PARA VALIDAÇÃO.
- Limite conhecido: se a GPU estiver 100% ocupada pelo jogo, a cópia de quadros da captura ainda disputa tempo de GPU. Nesse caso, limitar o FPS do jogo ajuda.

## Live a ~7 fps com jogo aberto (relato 2026-10-30, Ryzen 7 5700G + RX 6700 XT)
- Sintoma: fora do jogo a live mantém 60 fps; com o jogo aberto cai para ~7 fps, enquanto o jogo roda a mais de 100 fps.
- Hipótese: a cópia GPU→CPU de cada quadro capturado fica na fila atrás do jogo, que ocupa a GPU inteira.
- Mitigação: `enable-features=WebRtcAllowWgcUsingTexture` faz a captura WGC entregar o quadro como textura, sem essa cópia.
- Validado: E2E `golive-real.spec.ts` continua capturando o monitor real em 1920×1080, com o encoder NVIDIA H.264 MFT.
- **Não validado:** o efeito na máquina AMD do relato. Status: BLOQUEADO PARA VALIDAÇÃO.
- Diagnóstico pendente: o tooltip do selo de quem transmite ("limitado por CPU/banda", encoder). Se o encoder for software (OpenH264), a causa é outra: CPU disputada pelo jogo.
- Paliativo: limitar o FPS do jogo (ex.: Radeon Chill/FRTC), para deixar folga de GPU.
- Medição neste PC (RTX), assistindo uma live 1080p: `gpu_compositing`, `video_decode` e `video_encode` = enabled; decoder `D3D11VideoDecoder`; interface acima de 470 fps sem long tasks.

## Medição com movimento na tela (2026-10-30) — `WebRtcAllowWgcUsingTexture` revertida
- E2E `golive-real.spec.ts`: uma janela anima sobre o monitor capturado; o teste registra fps da animação, da captura (`media-source`), do envio e da recepção.
- **Com a flag:** animação a 46–48 fps → captura **12–14 fps** (duas execuções).
- **Sem a flag:** animação a 30 fps → captura 30 fps; numa execução com mais movimento → captura **42–50 fps**, recepção 35–50 fps.
- A flag (ligada em 807f116) foi **removida**: piorava a captura para todos. O teste agora exige captura ≥ 20 fps com movimento.
- No lado de quem assiste:
  - buffer de recepção das lives de 200 ms (`jitterBufferTarget`), para o reenvio de pacotes perdidos chegar antes de congelar;
  - o selo mostra o fps de captura, o transporte (UDP/TCP, host/srflx/relay) e o RTT.
- **Ainda não validado em máquinas reais com jogo:** o relato do Tiago (AMD) e as travadas do theuzin (rede). Status: BLOQUEADO PARA VALIDAÇÃO.
