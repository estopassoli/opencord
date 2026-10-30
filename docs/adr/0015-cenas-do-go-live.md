# ADR-0015: Cenas do Go Live
Status: Accepted (pedido do mantenedor, 2026-10-30)

## Contexto
O mantenedor pediu cenas na transmissão: a tela com a câmera por cima, imagens e textos, montadas num editor e trocadas sem encerrar a live. A mídia continua indo pelo LiveKit. A composição precisa rodar no próprio app, sem OBS nem serviço no servidor.

## Decisão
- **Modelo** (`src/lib/scenes.ts`): uma cena é uma lista de camadas: tela, câmera, imagem ou texto.
  - Cada camada tem um retângulo em frações do quadro, visibilidade e ordem.
  - As cenas ficam guardadas neste computador (`localStorage` `oc-scenes`). Nada vai para a API.
  - Cenas padrão: "Só a tela" e "Tela + câmera".
- **Composição** (`src/voice/compositor.ts`):
  - `MediaStreamTrackProcessor` lê os quadros da captura e da câmera.
  - Cada composição é desenhada num `OffscreenCanvas` no fps do perfil.
  - O canvas usa `{alpha: false, willReadFrequently: true}`, ou seja, fica no processador.
  - O resultado vira um `VideoFrame`, escrito num `MediaStreamTrackGenerator`, e essa trilha é publicada no lugar da captura.
  - O áudio do sistema não passa pela composição.
  - Sem Insertable Streams, a reserva é `<video>` + `canvas.captureStream`.
- **Troca ao vivo:** `engine.setScene` troca as camadas sem republicar a trilha. "Sem cena" fica disponível no menu "Trocar de cena" da chamada.
- **Editor** (`SceneEditor.tsx`): prévia 16:9 com arrastar/redimensionar, lista de camadas, cor do texto e câmera arredondada. Abre pelo seletor de fonte ("Cena: …") ou pelo menu de cenas.

## Alternativas descartadas
- **Canvas na GPU**, ou `captureStream` do canvas da página: com a janela do app coberta por um jogo, a escrita travava e a live caía para 0–7 fps. Com o canvas no processador, a live mediu 30–35 fps coberta, sem descartes.
- **Compor no servidor** (egress/bot): custo de CPU e banda no servidor e latência extra.

## Consequências
- Custo: uma cópia do quadro para a CPU por composição. Medido no E2E com 1080p: a live acompanha o conteúdo, thread principal com atraso máximo de 14 ms, memória estável (~740 MB no processo da página ao longo da live).
- Cada `VideoFrame` escrito é fechado assim que o gerador o consome. Sem isso, a memória nativa de ~8 MB por quadro se acumularia.
- **Evidência:** E2E `golive-real.spec.ts` (Windows real, uma máquina) cobre:
  - a cena "Só a tela" com animação em todos os monitores e o app coberto;
  - fps da captura ≥ 80% do conteúdo;
  - troca ao vivo para "Sem cena" e espectador recebendo 1080p;
  - pausa sem espectador e janela separada.
- **Pendente:** validação manual em duas máquinas Windows e redes diferentes (gate F4).
