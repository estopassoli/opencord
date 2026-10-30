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
  - **Qualquer pessoa na chamada** adiciona e controla: tocar, pausar, posição, próxima, anterior, pular para uma faixa e tirar da fila.
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
