# ADR-0014: Música na chamada (YouTube e YouTube Music)
Status: Accepted (pedido do mantenedor, 2026-10-30)

## Contexto
- Pedido do mantenedor: "colocar música na call, com um player próprio, … em Atividades". Fontes: "Youtube, youtube music, spotify". Controle: "Todos da call".
- O áudio desses serviços tem DRM, e os termos proíbem retransmiti-lo. Por isso o OpenCord não toca e não repassa o áudio.

## Decisão
- **Fase 1:** YouTube e YouTube Music, que usam os mesmos IDs de vídeo (`parseYouTubeId` já aceita `music.youtube.com`).
  - Cada pessoa toca no **player oficial embutido, visível** (≥ 200 px de altura, como exigem os termos), dentro de um cartão do OpenCord com título, progresso, anterior/tocar/próxima, fila e volume próprio.
  - O servidor guarda só o estado: fila, índice, tocando, posição e revisão. Fica no Redis em `music:<canal>`, com TTL de 6 h, e é apagado quando a chamada esvazia.
  - Comandos Socket.IO `music:get|add|control|stop`; eventos `music:state` e `music:ended`. Mídia não passa pelo Socket.IO.
  - ~~Qualquer pessoa na chamada adiciona e controla~~ → revisado em 2026-10-30: há um **DJ** (ver "Atualização" abaixo).
  - Fim da faixa: cada player avisa `ended` com o id da faixa, e o servidor só avança no aviso da faixa atual (idempotente).
  - Fila de até 100 faixas. Título e canal vêm do oEmbed público do YouTube.
  - É independente do "Assistir juntos" (ADR-0009): os dois podem rodar ao mesmo tempo.
- **Spotify (fase 2, pendente do mantenedor):**
  - Tocar dentro do Electron exige Widevine, que o Electron padrão não tem.
  - O caminho viável é o "ouvir junto": cada pessoa conecta a conta Premium dela (OAuth/PKCE), e a Web API manda o Spotify dela tocar a mesma faixa e posição.
  - Requer um app em developer.spotify.com (Client ID) e é limitado a 25 usuários em modo de desenvolvimento.

## Consequências
- Sem custo de banda de mídia no servidor; anúncios do YouTube podem aparecer para quem não tem Premium.
- **Evidência:**
  - integração `music.int.test.ts`: fila, controle por todos, `ended` idempotente, quem está fora da chamada é recusado, encerrar avisa todos;
  - E2E `voice.spec.ts`, "Música na chamada": link do YouTube Music, segunda pessoa ouve, fila e pausa sincronizam, encerrar some para os dois.

## Revisão: player minimizado (2026-10-30)
- O mantenedor pediu um modo minimizado com "somente a thumb, nome e tempo da música".
- Foi informado de que os termos do YouTube exigem o player embutido visível (≥ 200×200 px) e de que escondê-lo pode levar ao bloqueio do player. Mesmo assim escolheu a opção "só capa, nome e tempo" (resposta: "2").
- **Implementação:** minimizado, o iframe oficial continua na página e tocando, com 1×1 px, invisível e sem foco. O cartão mostra a miniatura, o título e "posição / duração".
- **Risco aceito pelo mantenedor:** violação dos termos do YouTube nesse modo. O modo expandido continua dentro das regras.
- **Evidência:** E2E `voice.spec.ts` ("Música na chamada"): ao minimizar e expandir, o iframe é o mesmo elemento (a música não reinicia), e o mini mostra a capa e o tempo.

## Atualização (2026-10-30): DJ e playlists
Pedido do mantenedor: "quando EU coloco a musica EU sou o DJ, entao o correto é apenas eu ter o controle geral da playlist, se eu saio, a pessoa que está mais tempo na call passa a ser o DJ, se todo mundo sai a musica para", e o link de uma playlist importava só a primeira música.
- **DJ** (`MusicState.djId`):
  - Quem começa a música (fila vazia ou terminada) vira o DJ.
  - Só o DJ adiciona, tira, pula, toca/pausa, muda a posição e encerra; os outros recebem 403.
  - O aviso de fim da faixa (`ended`) continua aceito de qualquer player, porque só avança se a faixa ainda for a atual.
- **Quem ouve** controla só o próprio player: volume, "Pausar só para mim" e "Voltar ao vivo" (volta para onde o DJ está) e "Parar de ouvir".
- **DJ sai da chamada:** quem está nela há mais tempo (menor `joinedAt`) assume, em `VoiceService.handOffMusic`. Se a chamada esvazia, a música acaba, como antes.
- **Música tocando no deploy:** um estado sem `djId` considera DJ quem mexeu por último (`updatedBy`).
- **Playlists:** `music:add` aceita `playlistId` (o `list=` do link). As faixas vêm da Data API v3 (`playlistItems`, 1 unidade de cota por página de 50), com título e artista, até o limite da fila (100).
  - Num link de vídeo dentro de playlist, a fila começa por aquele vídeo.
  - Mixes automáticos ("RD…", "Rádio" do YouTube Music) e playlists privadas não existem na API. Sem a chave do YouTube, também não dá para importar. Nesses casos entra só o vídeo do link; um link só de playlist é recusado com a explicação.
- Sem migração: o estado da música vive no Redis.

