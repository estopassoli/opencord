# ADR-0019: Cargos por reação
Status: Accepted (pedido do mantenedor, 2026-10-30)

## Contexto
Parte do pedido de "bastante coisa interativa" no servidor oficial: cada pessoa escolhe cargos de interesse sozinha.

## Decisão
- **Tabela `ReactionRole`** (migração `20261030200000_reaction_roles`): `(messageId, emoji) → roleId`, com até 20 pares por mensagem e só em mensagens de canal de servidor.
- **Configurar:** `PUT /messages/:id/reaction-roles` substitui o conjunto de pares. Exige:
  - MANAGE_ROLES;
  - cada cargo abaixo do cargo mais alto de quem configura;
  - nenhum cargo com bits de moderação (`REACTION_ROLE_FORBIDDEN`: administrador, gerenciar servidor/cargos/canais/mensagens, expulsar, silenciar, mover, auditoria, @everyone). Qualquer um que vê a mensagem ganha o cargo só de reagir, então ele não pode dar poder.
  - Cargos que só mudam a cor do nome ou liberam canais são permitidos.
- **Aplicar:** ao reagir com o emoji (`chat:reaction:set` ou REST), o servidor dá o cargo; ao tirar a reação, tira. A aplicação é idempotente.
  - Fica na auditoria como `member.roles` (`via: reaction`).
  - Avisa `server:member:updated` e recalcula salas e permissões, como uma mudança de cargo normal.
- **Mensagem:** traz `reactionRoles`.
  - O app mostra botões "emoji + cargo" com a cor do cargo, que reagem ou tiram a reação, e "Cargos por reação…" no menu da mensagem para quem gerencia cargos.
- **Servidor oficial:**
  - O seed cria os cargos de interesse Gamer, Música, Filmes e séries, Dev, Arte e Estudos: só cor, sem permissões, abaixo dos demais.
  - O canal #escolha-seus-cargos (Informações, só leitura) traz a mensagem com os seis botões.

## Consequências
- Quem sai de um cargo pela tela de cargos continua com a reação na mensagem; reagir de novo devolve o cargo.
- **Reversão:** `DROP TABLE "ReactionRole";` e voltar à versão anterior da API. Os cargos já dados continuam com as pessoas.
