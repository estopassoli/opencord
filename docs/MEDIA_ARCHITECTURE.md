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
