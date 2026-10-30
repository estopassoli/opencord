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

## Perfil exato (2026-10-30)
- Relato: com 1080p60 escolhido, a live saía a 42 fps e 8,1 Mb/s, exatamente o teto da época; com 720p30, saía a 24 fps.
- O WebRTC, em `maintain-resolution`, descartava quadros para caber no teto.
- **Agora:**
  - `maintain-framerate-and-resolution`, aplicado com `setParameters` depois de publicar (se não for suportado, fica `maintain-resolution`);
  - tetos de 6, 20 e 30 Mbps.
- **E2E golive-real:** o Chromium do Electron 44 aceita o modo (o selo mostra "fps e resolução fixos") e o fps enviado acompanha o capturado.
- **Limite físico:** se a banda de subida de quem transmite não comporta o perfil, a imagem perde nitidez (QP maior), mas fps e resolução ficam.

## Bitrate escolhido por quem transmite (2026-10-30)
- Relato: lives engasgando com o teto de 20 Mbps. O LiveKit estimou 16,8 Mbps de subida para um dos streamers (congestionamento no transporte de publicação). Acima da subida real há perda de pacotes, e a live trava para todos que assistem.
- O Go Live (engrenagem) e Configurações → Voz e vídeo têm o **bitrate**: leve, equilibrada (padrão) ou máxima. Os valores dependem do perfil: 720p30 com 3, 4,5 ou 6 Mbps; 1080p60 com 8, 12 ou 20 Mbps; 1440p60 com 12, 18 ou 30 Mbps. A máxima é o teto do perfil.
- A configuração fica salva por usuário (`settings.video.streamBitrate`). fps e resolução continuam fixos (perfil exato).

## Uso da placa de vídeo (2026-10-30)
- Relato: com um jogo ocupando a GPU, as transições do app engasgavam e ficaram lisas com a aceleração desligada. O custo de desligar é a live ser codificada e decodificada pelo processador.
- ~~Modo intermediário `ui-software` (`disable-gpu-compositing`)~~ **removido em 2026-10-30.** O status da GPU (`getGPUFeatureStatus`) dizia `video_encode`/`video_decode=enabled`, mas no E2E `golive-fps` a live real foi outra:
  - quem transmite codificou em **OpenH264** (software), a 2,5 fps com a textura pesada a 12 Mb/s (20 ms por quadro);
  - quem assiste decodificou em **FFmpeg** (software).
  Relato que bate com isso: o selo de quem assiste mostrava "decoder FFmpeg", 39 fps e 7 travadas.
- Quem tinha o modo salvo volta a "Placa de vídeo para tudo" (`readAppPrefs`). O selo da live agora avisa quando a codificação ou a decodificação estiver no processador.
- O relato original (transições engasgando com um jogo na GPU) segue sem solução que preserve as lives.

## Fluidez da live 1080p60, etapa por etapa (2026-10-30)
Relato: live 1080p60 chegando a ~31 fps a 11,2 Mb/s (bitrate "equilibrada", 12 Mb/s), com o jogo a ~65 fps.

**Método** (E2E `golive-fps.spec.ts`; Windows 11, NVIDIA, H.264 MediaFoundation por hardware, mesma máquina):
- Um terceiro processo (no papel do jogo) mostra um padrão determinístico com 60 quadros distintos por segundo. O número do quadro aparece em 16 blocos, e o padrão fica **no monitor que a live captura de fato**. Esse monitor é identificado pelo `deviceId` da trilha. A ordem do seletor não é a do Windows: com 3 monitores, a primeira medição pegou o monitor errado e mostrou falsos "15 fps distintos".
- Quem assiste fica em outro monitor, descoberto, e lê o número em cada quadro apresentado (`requestVideoFrameCallback`). Assim contamos quadros **distintos** exibidos, não só decodificados.
- Taxas por diferença de contadores em janelas de 10 s:
  - captura: `media-source.frames`;
  - cena: `written`;
  - envio: `framesEncoded`/`framesSent`;
  - recepção: `framesReceived`/`framesDecoded`/`framesDropped`;
  - apresentação: rVFC.

**Resultados** (quadros por segundo):

| Caso | Conteúdo | Captura | Codificados = enviados | Decodificados | Exibidos | Distintos no espectador | Enviado (Mb/s) |
|---|---|---|---|---|---|---|---|
| Barras, sem cena, 12 Mb/s | 60 | 57,7 | 57,7 | 57,7 | 56,6 | 54,5 | 2,9 |
| Barras, sem cena, 20 Mb/s | 60 | 57,7 | 57,7 | 57,7 | 57,0 | 55,0 | 2,9 |
| Barras, cena "Só a tela", 12 Mb/s | 60 | 57,7 | 57,7 | 57,7 | 55,4 | 53,3 | 3,0 |
| Textura pesada, sem cena, 12 Mb/s | 60 | 57,8 | 57,7 | 57,9 | 56,2 | 54,5 | 8,3 |
| Textura pesada, sem cena, 20 Mb/s | 60 | 57,8 | 57,8 | 57,8 | 56,6 | 54,6 | 19,4 |
| Textura pesada, cena, 12 Mb/s | 60 | 57,7 | 57,7 | 57,7 | 55,8 | 53,8 | 11,8 |

Observações gerais:
- 0 quadros descartados no espectador em todos os casos.
- `qualityLimitationReason: none` em todos os casos.
- Codificação de 4–5,7 ms por quadro.
- Os itens 1–6 do plano do maintainer foram seguidos. A flag `WebRTC-FrameDropper/Disabled/` foi testada contra um padrão de ruído puro, que é um teste extremo e não representativo. Ela não mudou nada e foi revertida.

**Conclusão:**
- Nesta máquina, o caminho inteiro sustenta ~55 quadros distintos/s em 1080p, com e sem cena. Isso vale mesmo usando todo o bitrate (11,8 de 12 Mb/s; 19,4 de 20 Mb/s).
- O teto de bitrate não derrubou o fps. `maintain-framerate-and-resolution` está aplicado.
- A queda do relato acontece em algo que este teste não reproduz: jogo em foco na máquina de quem transmite, CPU/GPU dela, rede (estimativa de banda) ou a máquina de quem assiste.

**Próximo passo:**
- Clicar no selo da live (de quem transmite e de quem assiste) mede 5 s e copia as taxas por etapa: captura, cena, codificação, envio, banda, recepção, decodificação, descarte e apresentação.
- O teste real exigido no gate F4 continua pendente: dois Windows, jogo em foco, 5 min, com e sem cena.
- 16 Mb/s não é um nível do app (os níveis de 1080p60 são 8/12/20); foram medidos 12 e 20.

**Atualização (mesmo dia):**
- O diagnóstico copiado agora inclui um histórico da live a cada 2 s (últimos 10 min). Ele mostra se a live demora a subir no começo, como no relato de "fps baixo nos primeiros ~5 min".
- A cópia passou a ser iniciada no próprio clique. Antes, esperar os 5 s da medição para só então copiar fazia o Chromium recusar a área de transferência.

## Captura no dobro do fps da live (2026-10-30)
- **Relato:** o diagnóstico mostrava a captura ("srcFps") em ~57,5 numa live de 60.
- **Causa:** a captura pedida a `max: 60` verifica a tela a cada 1/60 s. Com a variação de tempo, ela perde quadros novos.
- **Medição** (E2E `golive-fps`, quadros distintos/s no espectador):

| Captura pedida | Conteúdo 60 fps | Conteúdo 120 fps, sem cena | Conteúdo 120 fps, com cena |
|---|---|---|---|
| 60 | 57,7 | 57,6 | 57,7 |
| 65 | 58,7 | – | – |
| 60 sem teto, ou teto 90 | 57,7–57,9 | – | – |
| 120 | 59,5 | 58,9–59,2 | 59,1–59,4 |

- **Decisão:** a captura passa a ser pedida no **dobro** do fps do perfil. O limite continua no envio (`maxFramerate`), que nunca passa do fps do perfil.
- **Bateria completa depois da mudança** (textura pesada): 59,0–59,6 quadros distintos/s, sem e com cena, a 12 e a 20 Mb/s. Antes era 53,3–55,0.
- **Carga:** a captura não passou de ~60 quadros por segundo, então não houve carga extra visível.
