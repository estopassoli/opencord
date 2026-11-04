# ADR-0045: Recusar ideia do quadro e conta de avisos do OpenCord
Status: Accepted (pedido do mantenedor, 2026-11-04)

## Contexto
O mantenedor pediu: "dar negativa no card do kanban e o usuario receber uma mensagem no PV do Servidor Oficial com no-reply, sem ter o input de texto pra ele responder".

## Decisão
- **Conta de avisos:** um usuário de sistema `_opencord` ("OpenCord", verificado, `isBot`, suspenso), criado no boot pelo `SystemUserService`.
  - **Nome reservado:** o cadastro deriva o nome de usuário do apelido e tira `_` do começo, então ninguém chega a esse nome sozinho.
  - **Proteção extra:** uma conta com esse nome que tenha senha, e-mail ou não seja bot nunca é aproveitada.
  - **Suspensa:** não entra, e pedido de amizade para ela dá 404.
  - **Sinalização:** `UserPublic.system: true` (índice em memória, como as insígnias).
- **DM sem resposta:** a DM com essa conta é só leitura.
  - A API recusa mensagens de quem não é a conta (403) e chamadas na DM (403).
  - Abrir DM com ela já era impossível (não é amiga de ninguém nem divide servidor).
  - O app troca o campo de mensagem por "Avisos automáticos do OpenCord. Esta conversa não recebe respostas." e esconde os botões de ligar e de adicionar pessoas.
- **Recusar:** `POST /cards/:id/reject { reason?, notify = true }`, com a mesma permissão de mexer no card (MANAGE_MESSAGES no quadro).
  - Com `notify` e quem relatou existindo, ativo e diferente de quem recusa: a conta de avisos manda na DM com a pessoa o título citado, o servidor, o quadro e o motivo. A mensagem pula a moderação por IA e a DM é criada na primeira vez (`conversation:upserted`).
  - O card é apagado (`board:card:deleted`) e a recusa vai para a auditoria do servidor (`board.card.reject`).
  - No app: "Recusar ideia…" no menu do card e no diálogo, com o motivo e a opção "Avisar por mensagem".
- **Sem migração:** a conta é uma linha comum de `User`.

- **Conferência pelo super admin** (adendo, mesmo dia): `GET /admin/system-messages` (paginado, mais novas primeiro, 404 para quem não é super admin). Lista tudo o que a conta mandou, com quem recebeu e quando. No painel admin, fica na aba "Avisos enviados".

## Alternativas descartadas
- Coluna "Recusado" no quadro: muda o enum `BoardColumn` (migração) e o pedido era tirar a ideia e avisar.
- Mandar como o próprio moderador: a pessoa responderia e a conversa viraria discussão; o pedido era no-reply.
- Flag de "só leitura" na conversa: exigiria migração; a regra "DM com a conta de avisos" basta.

## Consequências
- A mesma conta pode mandar outros avisos no futuro (ex.: ideia aprovada) pelo `MessagesService.create` com `skipModeration`.
- **Apps antigos:** mostram o campo de mensagem, mas o envio volta 403 com o motivo.
- **Reversão:** remover a rota e o serviço. A conta fica suspensa e inerte, e as DMs continuam legíveis.
