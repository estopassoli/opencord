# ADR-0054: "Visualizada" na DM
Status: Accepted (pedido do mantenedor, 2026-11-07)

## Contexto
O mantenedor pediu para saber, numa DM, quando a outra pessoa viu a mensagem enviada.

## Decisão
- Sem migração: reaproveita o `ReadState` (marcador de leitura por pessoa e conversa) que já existia para os não lidos.
- `Conversation` ganha `reads: { userId, messageId, at }[]` (até onde cada membro leu e quando o marcador andou), preenchido em `GET /conversations`.
- `markRead` emite `conversation:read` `{ conversationId, userId, messageId, at }` na sala da conversa quando o marcador avança (nunca volta; marcar a mesma mensagem de novo não emite).
- No app, só em DM 1:1 (não em grupo nem na conversa de avisos do OpenCord): embaixo da minha mensagem, quando ela é a última da conversa, aparece "Enviada" ou "Visualizada às HH:MM".
- "Lido" = o app marcou como lido, o que só acontece com a janela em foco e a conversa rolada até o fim. Agora isso também é feito ao voltar o foco para a janela e ao rolar até o fim (antes, quem já estava com a conversa aberta e a janela sem foco não marcava como lido ao voltar).

## Consequências
- A outra pessoa da DM fica sabendo até onde você leu e a hora aproximada. Não há opção para desligar; se for pedida, vira um ajuste de privacidade recíproco (quem desliga também não vê).
- Grupos já recebem o evento e os marcadores (o dado é o mesmo); só a interface ficou para depois.
