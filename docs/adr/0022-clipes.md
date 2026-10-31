# ADR-0022: Clipes dos últimos 60 s do jogo
Status: Accepted (pedido do mantenedor, 2026-10-31)

## Contexto
O mantenedor pediu o atalho "SHIFT F10 para clipar". Ao escolher entre as opções, ficou com **60 s, só jogando**: com um jogo aberto, o app guarda os últimos 60 s e o atalho salva um vídeo.

## Decisão
- **Quando:** só com um jogo detectado (ADR-0021) e a opção "Clipes" ligada (Configurações → Jogos, ligada por padrão).
  - Ao fechar o jogo, a captura segue por 30 s (troca de partida, reabrir) e depois para e libera a memória.
  - Desligar a opção para na hora.
- **O que é capturado:** a tela principal (`screen.getPrimaryDisplay()`), com o som do computador (`loopback`), que inclui a chamada.
  - O processo principal autoriza a captura (`clips:prepare`, a mesma concessão de uso único do Go Live).
  - A janela captura com `getDisplayMedia`, até 1920×1080 e 60 fps.
- **Codificação na janela (WebCodecs):**
  - Vídeo em `VideoEncoder` H.264, preferindo a placa de vídeo, a 12 Mb/s, com quadro-chave a cada 2 s.
  - Som em `AudioEncoder` AAC (ou Opus, se o AAC não existir) a 160 kb/s.
  - Se o codificador atrasa, o quadro é descartado, em vez de acumular memória.
- **Memória:** `ChunkRing` guarda os pedaços codificados em grupos que começam num quadro-chave e descarta o que sai da janela de 60 s. Cerca de 90 MB.
- **Salvar:**
  - O atalho global `keybinds.saveClip` (padrão `Shift+F10`, configurável em Atalhos) monta um MP4 com `mp4-muxer` (MIT, sem rede).
  - O processo principal grava em `Vídeos\OpenCord\<jogo> <data hora>.mp4` (`clips:save`, até 1 GB).
  - Um aviso oferece "Mostrar na pasta" (`clips:reveal`, só dentro dessa pasta).
- **Nada vai ao servidor.**

## Atualização (2026-10-31): biblioteca, visualizador e opções
- **Opções** (Configurações → Jogos, sincronizadas):
  - duração 15/30/60/120 s, 30 ou 60 fps e resolução (a da tela, 1080p ou 720p);
  - qualidade de 10 a 100%: bitrate ≈ 0,12 bit/pixel/quadro × qualidade, em que 1080p60 a 100% dá cerca de 15 Mb/s;
  - mudar uma opção recomeça a captura.
- **Pasta dos clipes:** só deste computador (`clips-dir.json` nos dados do app), escolhida pelo seletor nativo; a padrão é Vídeos\OpenCord.
- **Ao salvar:**
  - toca o som `clip` (respeita a opção de efeitos sonoros);
  - grava ao lado do MP4 um `.json` (jogo, ícone, id da Steam, data, duração) e um `.jpg` (miniatura do quadro-chave do meio, decodificado com `VideoDecoder`).
- **Biblioteca:** o processo principal lista, lê, apaga, copia o arquivo (lista de arquivos no clipboard via `Set-Clipboard -LiteralPath`) e exporta com "Salvar como". Tudo validado para ficar dentro da pasta de clipes. As últimas 4 miniaturas aparecem no painel do usuário, só quando existe algum clipe.
- **Visualizador:**
  - toca só o trecho cortado, com linha do tempo de 10 miniaturas e bordas arrastáveis (mouse ou setas);
  - exporta o trecho como MP4 ou M4A com a **mediabunny 1.61.5** (MPL-2.0, compatível com a AGPL; copia o que dá e recodifica as bordas);
  - "Adicionar aos efeitos sonoros" abre o envio de som com o áudio do trecho, convertido para WAV.
- **Fica para depois:** texto e imagem sobre o vídeo, áudio separado por fonte (jogo, voz, efeitos) e compartilhar numa conversa.

## Consequências
- **Evidência:**
  - unidade `clips-ring.test.ts`: a janela, o começo num quadro-chave e o áudio no mesmo trecho;
  - E2E `clips.spec.ts` no Windows 11 real (RTX, Path of Exile 2 aberto pela Steam, detectado pela ADR-0021):
    - o painel mostra o jogo e "SHIFT F10 para clipar";
    - o atalho grava um MP4 (`ftyp`/`moov`) com H.264 e AAC, 1920×1080, de 6 s;
    - o próprio Chromium decodifica o arquivo;
    - a miniatura aparece no painel, o visualizador abre com a linha do tempo, um corte de 2 s exporta um MP4 de 5,4 s (de 7,4 s) e apagar remove os arquivos.
- **Relógios:** a trilha da tela usa o relógio do sistema e a do som começa em zero (medido no E2E: 3798 s × 7,5 s). Cada trilha é levada a `performance.now()` no primeiro quadro ou amostra; sem isso o som ficava de fora do clipe.
- **Custos:** enquanto um jogo está aberto, uma sessão de codificação na placa de vídeo, cerca de 90 MB de RAM e a captura da tela.
- **Limitações:**
  - Só a tela principal; o jogo em outro monitor não entra.
  - Jogos em tela cheia exclusiva podem sair pretos, como no Go Live.
  - O microfone da própria pessoa não entra no clipe; só o som do computador.
