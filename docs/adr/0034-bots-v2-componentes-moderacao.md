# ADR-0034: Bots v2 — embeds, componentes, modais, autocompletar, comandos avançados, moderação e SDK completo
Status: Accepted (pedido do mantenedor, 2026-11-02)

## Contexto
Depois da ADR-0032 o mantenedor pediu que o SDK `@opencord-chat/bot` fique "o mais completo possível, até mais que o
Discord": o que existe lá e não existia aqui (componentes, autocompletar, embeds ricos, moderação, comandos
avançados, anexos enviados por bots, infraestrutura de escala) e o que já existia no OpenCord sem estar no SDK
(enquetes, digitando, presença, eventos do servidor, gestão de canais/cargos/membros, busca, webhooks, auditoria).

## Decisão

### Mensagens: embeds, componentes e anexos
- `Message.embeds` (`Json`, array de `Embed`) e `Message.components` (`Json`, array de `ActionRow`). Só **bots e
  webhooks** enviam embeds; só **bots** enviam componentes (a API recusa 403 para pessoas). Limites como os que a
  comunidade conhece: 10 embeds, 6000 caracteres por embed, 5 linhas × 5 botões ou 1 menu, 25 opções por menu.
- Embed é um cartão: barra colorida, autor, título com link, descrição em markdown, campos (inline em grade),
  imagem, miniatura, rodapé com data. Sem cor = barra neutra.
- Componentes: botões (`primary|secondary|success|danger|link`) e menus (`string|user|role|channel`). O clique vira
  interação `component` (`POST /interactions { type: 'component', messageId, customId, values }`); menus de
  usuário/cargo/canal listam os do servidor no app e enviam ids.
- Anexos: o bot usa o mesmo `POST /attachments` (multipart) e `attachmentIds`; o SDK aceita `files` em `send`/`reply`
  (Buffer, caminho, URL ou stream).
- `EditMessageRequest` passa a ser parcial (`body`, `embeds`, `components`); `POST /channels/:id/messages/bulk-delete`
  (até 100; MANAGE_MESSAGES ou só as próprias); `DELETE /messages/:id/reactions` limpa reações (MANAGE_MESSAGES);
  `GET /messages/:id` (quem vê o canal).

### Comandos v2
- `BotCommand.type`: `chat` (barra), `user` e `message` (menu de contexto "Apps" numa pessoa ou mensagem; nome
  livre, sem opções).
- Subcomandos e grupos (`options` com `type: 'subcommand' | 'subcommand_group'`; não mistura com opções soltas);
  opções novas `role` e `mentionable`; `autocomplete`, `minValue/maxValue`, `minLength/maxLength`, `channelTypes`.
- `defaultMemberPermissions` (bits que quem usa precisa ter; dono/ADMINISTRATOR passam) e `guildIds` (comandos só
  em alguns servidores; vazio = global). `GET /servers/:id/commands` já vem filtrado.
- Limites: 100 comandos por bot, 25 opções por comando.

### Interações v2
- `Interaction.type`: `command`, `user_command`, `message_command`, `component`, `modal`, `autocomplete`. Campos por
  tipo: `subcommandGroup/subcommand/options`, `focused`, `targetUser`, `targetMessage`, `customId/componentType/values`,
  `fields`, `ephemeralOf`.
- Respostas do bot: `reply` (texto, embeds, componentes, anexos, efêmera), `defer` (`update: true` para só acusar o
  clique), **`update`** (edita a mensagem de origem do componente, ou o cartão efêmero), **`modal`** (abre um
  formulário; consome a interação; o envio vira interação `modal` com `modalId`), **`autocomplete`** (sugestões).
- Autocompletar é síncrono para o app: `POST /interactions { type: 'autocomplete' }` espera o bot até 3 s (Redis
  pub/sub `interaction:autocomplete:<id>`) e devolve `{ choices }` (vazio se o bot não respondeu). O app debounça.
- Cartões efêmeros podem ter componentes: o app guarda o cartão por `interactionId`; o clique manda
  `ephemeralOf`; a API guarda `ephemeral:<interactionId>` (15 min) com bot/canal/componentes; `update` emite
  `interaction:replied` com `update: true` e o app substitui o cartão.
- Modais: `modal:<modalId>` no Redis (15 min) com bot/canal/definição; o envio valida obrigatórios e tamanhos.
- Segurança: componentes só são aceitos se a mensagem existe, o autor é bot, a pessoa vê o canal e o `customId`
  existe e não está desabilitado; valores de menu são validados contra as opções (string) ou contra o servidor
  (user/role/channel). `defaultMemberPermissions` é conferido na API, não só escondido no app.

### Moderação
- Permissões novas: `BAN_MEMBERS` (1<<19) e `MODERATE_MEMBERS` (1<<20); entram em `REACTION_ROLE_FORBIDDEN`.
- `ServerBan` (`serverId,userId,reason,createdById,createdAt`): `PUT /servers/:id/bans/:userId { reason,
  deleteMessageSeconds }` expulsa e bane (hierarquia via `memberTop`; super admin e dono intocáveis);
  `DELETE /servers/:id/bans/:userId`; `GET /servers/:id/bans`. Banido não entra por convite, diretório, admin-join nem
  como bot. Eventos `server:ban:added/removed`. Auditoria `member.ban`/`member.unban`.
- `ServerMember.timeoutUntil` (castigo, até 28 dias): `PATCH /servers/:id/members/:userId { timeoutUntil }` com
  MODERATE_MEMBERS e hierarquia. Em castigo: 403 ao enviar mensagem, reagir, usar comando, entrar em voz (e a voz
  atual é encerrada). `Member.timeoutUntil` no contrato; `server:member:updated`. Auditoria `member.timeout`.
- App: menu da pessoa → "Banir…" (motivo + apagar mensagens recentes) e "Castigo" (1 min, 5 min, 1 h, 1 dia,
  1 semana, tirar); Configurações do servidor → aba "Banidos"; composer avisa "em castigo até …".

### SDK (`@opencord-chat/bot` 0.2.0)
- Builders: `EmbedBuilder` (vira embed de verdade, não mais markdown), `ActionRowBuilder`, `ButtonBuilder`,
  `StringSelectMenuBuilder`/`UserSelectMenuBuilder`/`RoleSelectMenuBuilder`/`ChannelSelectMenuBuilder`,
  `ModalBuilder`, `TextInputBuilder`, `SlashCommandBuilder` com `addSubcommand`/`addSubcommandGroup`,
  `ContextMenuCommandBuilder`, `AttachmentBuilder`.
- Interações: `ChatInputCommandInteraction`, `UserContextMenuCommandInteraction`,
  `MessageContextMenuCommandInteraction`, `ButtonInteraction`, `StringSelectMenuInteraction` (e user/role/channel),
  `ModalSubmitInteraction`, `AutocompleteInteraction` (`respond`), com `reply/deferReply/editReply/followUp/
  deleteReply/fetchReply`, `update/deferUpdate`, `showModal`, `awaitModalSubmit`; coletores
  (`message.createMessageComponentCollector`, `channel.createMessageCollector`, `awaitMessageComponent`).
- Moderação: `member.ban/kick/timeout`, `guild.bans.fetch/create/remove`, `channel.bulkDelete`,
  `message.reactions.removeAll`, eventos `guildBanAdd/Remove`, `guildMemberUpdate`.
- Já existia e agora tem classe: enquetes (`send({ poll })`, `Poll.vote/end`, `pollUpdate`), `channel.sendTyping`
  + `typingStart`, `client.user.setPresence/setStatus/setActivity` + `presenceUpdate`, eventos do servidor
  (`guild.scheduledEvents` + `rsvp`), gestão (`guild.channels/roles/members/invites/webhooks`, `fetchAuditLogs`,
  `guild.edit`), busca (`channel.messages.search`, `guild.messages.search`, `fetchPinned`, `fetchReplies`),
  `Collection`, `PermissionsBitField`/`PermissionFlagsBits`, `messageReactionRemoveAll`, `messageDeleteBulk`.
- Escala: fila REST com concorrência, retentativa em 429 (`Retry-After`) e 5xx com backoff, evento `rateLimited`;
  gateway com retomada (`sync:resume` por canal → `messageCreate` do que perdeu) e `resume`; `ShardingManager`
  que divide os **servidores** entre processos (cada processo recebe tudo do gateway e filtra por
  `hash(guildId) % shardCount`; a API continua uma só). Sem sharding de gateway de verdade: instância única.

### Rejeitado
- Compatibilidade de fio com a API do Discord (mesma ADR-0032). Threads como canal, canais de fórum/palco,
  automod, OAuth2, stickers: fora desta fase.
- Opção `attachment` em comandos (exigiria upload no popover do app): fica para depois.

## Consequências
- Migração `20261102010000_bots_v2` (aditiva: `Message.embeds/components`, `ServerMember.timeoutUntil`, `ServerBan`).
  **Precisa rodar em produção antes do deploy da API** (a API seleciona as colunas novas); o push vai em dois
  passos: migração primeiro, código depois. Reversão: `DROP TABLE "ServerBan"; ALTER TABLE "ServerMember" DROP
  COLUMN "timeoutUntil"; ALTER TABLE "Message" DROP COLUMN "embeds", DROP COLUMN "components";`.
- Contrato v1 continua aceito: `POST /interactions` sem `type` é `command`; `Interaction` ganhou `type` e campos
  opcionais; `BotCommand` ganhou defaults. SDK 0.1.x continua funcionando contra a API nova.
- Evidências: testes de integração (`messages`, `bots`, `moderation`), unit do desktop e do SDK, tour real
  (`packages/bot-sdk/examples/tour.mjs`) regenerando os resultados de `docs/BOTS.md`.
