# ADR-0018: Enquetes
Status: Accepted (pedido do mantenedor, 2026-10-30)

## Contexto
O mantenedor pediu "bastante coisa interativa" no servidor oficial e escolheu enquetes, cargos por reação, eventos e níveis/XP. Este ADR trata das enquetes.

## Decisão
- **Uma enquete é presa a uma mensagem** (tabelas `Poll`, `PollOption` e `PollVote`, migração `20261030180000_polls`).
  - A pergunta também vira o texto da mensagem, para prévia, notificação e busca.
  - Vale em canais de texto e em conversas diretas.
  - Tem de 2 a 10 opções, sem repetição, e uma escolha ou várias.
  - Prazo: sem prazo, 1 h, 4 h, 8 h, 1 dia, 3 dias ou 1 semana.
- **Criar:** `POST /channels/:id/polls` e `POST /conversations/:id/polls` exigem SEND_MESSAGES, como mandar mensagem. A mensagem e a enquete nascem na mesma transação, com o mesmo `requestId` idempotente.
- **Votar:** `PUT /polls/:id/vote` com `optionIds`.
  - Substitui o voto da pessoa; uma lista vazia retira o voto.
  - Basta ver o canal: votar não é escrever, então canais só de leitura (ex.: #anúncios) aceitam voto.
  - Enquete encerrada recusa voto com 400.
- **Encerrar antes do prazo:** `POST /polls/:id/close`, pelo autor ou por quem tem MANAGE_MESSAGES no canal.
- **Edição:** mensagem com enquete não pode ser editada (400).
- **Tempo real:** o evento `poll:updated` vai para a sala do canal ou da conversa.
  - Ele traz as contagens e `mine` vazio, porque cada app guarda o próprio voto (o mesmo padrão do `me` das reações).
  - A lista de mensagens traz `mine` de quem pede.
- **App:**
  - Botão "+" do compositor → "Criar enquete".
  - O resultado em barras aparece depois de votar ou quando a enquete encerra. Antes disso, só as opções, para não influenciar o voto.
  - Opções acessíveis como radio ou checkbox.

## Consequências
- Votos são contados lendo todos os votos da enquete a cada serialização. Isso basta para o tamanho atual; se uma enquete passar de milhares de votos, a saída é contar por agregação.
- **Reversão:** `DROP TABLE "PollVote"; DROP TABLE "PollOption"; DROP TABLE "Poll";` e voltar à versão anterior da API.
