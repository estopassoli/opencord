# ADR-0025: Áudio do Go Live sem o som do OpenCord (process loopback pelo oc-audio.exe)
Status: Accepted (relato real do mantenedor, 2026-10-31)

## Contexto
O ADR-0003 capturava o áudio do sistema do Go Live com o loopback do Chromium e `restrictOwnAudio: true`, para tirar as
vozes da chamada (tocadas pelo próprio OpenCord) do som da live. No spike F0.4 isso suprimiu o som do próprio app, mas
uma execução com processo externo ficou sem explicação. Em uso real, amigos relataram que quem assiste a live de
alguém da chamada **ouve a voz de todo mundo pela transmissão**. O ADR-0003 previa reabrir a decisão nesse caso
("eco das vozes da chamada no espectador").

## Decisão
- `oc-audio.exe except <pid>` (ADR-0024): WASAPI **process loopback** em modo
  `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE` (`ActivateAudioInterfaceAsync("VAD\Process_Loopback")`), com o pid
  do **processo principal** do Electron. A árvore inclui renderers e o serviço de áudio, onde as vozes, os efeitos
  sonoros e a música da chamada são tocados. Saída: estéreo float 48 kHz no stdout, igual ao `capture`; o processo
  avisa `ready` no stderr quando a captura começou.
- Id especial `except-self` (`WIN_AUDIO_EXCEPT_SELF`) no IPC `win-audio:start`; o `start` agora devolve se a captura
  começou de fato.
- Renderer (`src/voice/system-audio.ts`): o PCM passa pelo worklet `oc-pcm-player` (o mesmo dos clipes) até um
  `MediaStreamAudioDestinationNode`; essa trilha é publicada como `screen_audio`. O `getDisplayMedia` passa a pedir só o
  vídeo.
- **Fallback:** sem o `oc-audio.exe`, fora do Windows ou no Windows anterior ao build 20348 (a ativação falha), a live
  volta ao loopback do Chromium com `restrictOwnAudio`, como antes.
- Clipes não mudam: a trilha da saída padrão continua no Chromium (as vozes têm trilha própria; ver ADR-0024).

## Evidências (2026-10-31, Windows 11 do mantenedor)
- Três capturas simultâneas de 4 s: sem excluir nada, RMS 0,0088; excluindo a árvore do Chrome (tocando YouTube),
  RMS 0,0009; excluindo outros processos, sem mudança. A exclusão por árvore funciona.
- E2E `golive-real`: a live inicia `oc-audio.exe except <pid principal>` e o processo termina ao parar a transmissão.
  No mesmo dia a asserção de fps da captura falhou (7 fps) com um jogo aberto na máquina; o vídeo não mudou neste ADR, e
  a execução seguinte, sem essa asserção, passou.
- **Não verificado ainda:** espectador real numa chamada sem ouvir as vozes pela live (precisa de duas pessoas e som
  audível). Fica BLOQUEADO PARA VALIDAÇÃO até o teste com os amigos.

## Consequências
- O processo de captura é separado do app; a latência do áudio da live sobe um pouco (fila de 100 a 200 ms no worklet),
  dentro da latência do vídeo.
- O process loopback pega o som dos outros programas, não de um dispositivo. Programas que tocam numa saída que não é a
  padrão (ex.: o "Voice" de um fone com duas saídas) também entram na live.
- Programas que **reproduzem** o som do OpenCord por fora (mixers virtuais, "escutar este dispositivo") continuam
  levando as vozes, porque o som sai de outro processo.
