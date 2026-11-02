# @opencord-chat/bot

SDK para criar bots do OpenCord em Node 20+. A forma de uso (`Client`, `Events`, `SlashCommandBuilder`,
`interaction.reply`…) é a que a comunidade de bots de chat já conhece, implementada do zero sobre a API REST e o
gateway Socket.IO do OpenCord. Guia completo (criar o bot no app, comandos, referência da API, portabilidade):
[`docs/BOTS.md`](https://github.com/estopassoli/opencord/blob/main/docs/BOTS.md).

Licença MIT (o restante do OpenCord é AGPL-3.0): seu bot não herda nenhuma obrigação de licença por usar o SDK.

## Instalar

```sh
pnpm add @opencord-chat/bot      # ou npm i @opencord-chat/bot
```

Página no npm: https://www.npmjs.com/package/@opencord-chat/bot. Para usar a versão do repositório antes de uma
publicação: `pnpm --filter @opencord-chat/bot build` dentro do monorepo e, no seu projeto,
`pnpm add file:../opencord/packages/bot-sdk`.

## Usar

```sh
export OPENCORD_URL=https://api.seu-opencord.dev   # URL da API da instância
export OPENCORD_TOKEN=ocb_...                      # token do bot (Configurações → Aplicativos → Novo bot)
node bot.mjs
```

```js
import { Client, Events } from '@opencord-chat/bot';

const client = new Client();
client.once(Events.ClientReady, (c) => console.log(`online como ${c.user.tag}`));
client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot) return;
  if (m.content === '!ping') await m.reply('pong');
});
await client.login();
```

Exemplo completo (comando de barra com autocompletar, botões, menu, modal e comando de contexto):
[`examples/ping.mjs`](./examples/ping.mjs).

## O que há de novo na 0.2.0

- **Embeds de verdade**: `EmbedBuilder.toJSON()` vira um cartão (cor, autor, campos, imagem, rodapé); `setColor`
  aceita `0xRRGGBB`, `'#rrggbb'` ou nomes (`Colors`). `toMarkdown()` continua existindo.
- **Componentes e modais**: `ActionRowBuilder`, `ButtonBuilder`, `StringSelectMenuBuilder` (+ `User`/`Role`/
  `ChannelSelectMenuBuilder`), `ModalBuilder`, `TextInputBuilder`; em `send`/`reply`/`edit` via `components`.
- **Interações por tipo**: `ChatInputCommandInteraction` (subcomandos, `getRole`, `getMentionable`),
  `UserContextMenuCommandInteraction`, `MessageContextMenuCommandInteraction`, `ButtonInteraction`,
  `*SelectMenuInteraction` (`update`, `deferUpdate`), `ModalSubmitInteraction` (`fields.getTextInputValue`),
  `AutocompleteInteraction` (`respond`); `showModal`, `awaitModalSubmit`, `files` com upload, `flags`.
- **Coletores**: `message.createMessageComponentCollector`, `awaitMessageComponent`, `channel.createMessageCollector`,
  `awaitMessages` — também em cartões efêmeros (`response.createMessageComponentCollector()`).
- **Comandos v2**: `addSubcommand`, `addSubcommandGroup`, `addRoleOption`, `addMentionableOption`, `setAutocomplete`,
  `setMinValue`/`setMaxValue`/`setMinLength`/`setMaxLength`, `addChannelTypes`, `setDefaultMemberPermissions`,
  `setGuildIds`; `ContextMenuCommandBuilder`; `AttachmentBuilder`.
- **Moderação e gestão**: `member.kick/ban/timeout`, `member.roles.add/remove/set`, `guild.bans`, `guild.channels.create/
  edit/delete` (categorias com `ChannelType.GuildCategory`), `guild.roles.create/edit/delete`, `guild.edit/leave`,
  `guild.invites.create`, `guild.fetchAuditLogs`, `guild.fetchWebhooks`/`channel.createWebhook`/`webhook.send`,
  `guild.scheduledEvents` (+ `event.rsvp`), `channel.bulkDelete`, `message.reactions.removeAll`, `message.fetch`,
  `PermissionsBitField`/`PermissionFlagsBits` (`member.permissions` agora inclui `@everyone` e dono), `Collection`.
- **Já existia na API, agora no SDK**: enquetes (`send({ poll })`, `message.poll.vote/end`, `pollUpdate`),
  `channel.sendTyping` + `typingStart`, presença (`client.user.setPresence/setStatus/setActivity/setStatusText`,
  `presenceUpdate`, `guild.presences`), busca (`channel.messages.search`, `guild.messages.search`), `fetchPinned`,
  `fetchReplies`, `setReactionRoles`, `users.fetch` com `profile`, `user.block`, `client.fetchInvite`.
- **Eventos novos**: `guildBanAdd/Remove`, `guildMemberUpdate`, `roleCreate/Update/Delete`, `categoryCreate/Update/
  Delete`, `guildScheduledEventCreate/Update/Delete`, `messageReactionRemoveAll`, `messageDeleteBulk`,
  `channelPinsUpdate`, `typingStart`, `presenceUpdate`, `pollUpdate`, `guildUpdate`, `userUpdate`, `warn`, `rateLimited`.
- **Escala**: fila REST com concorrência (4) e retentativa em 429 (`Retry-After`) e 5xx/rede; evento `rateLimited`;
  retomada após queda (`sync:resume` → `messageCreate` do que perdeu, depois `resume`); `client.ws.status`;
  `ShardingManager` (divide os **servidores** entre processos: `OPENCORD_SHARD_ID`/`OPENCORD_SHARD_COUNT`).
- Compatível com o código da 0.1: só o limite de opções por comando subiu de 10 para 25 (ADR-0034).

## Desenvolver o SDK

```sh
pnpm --filter @opencord-chat/bot typecheck
pnpm --filter @opencord-chat/bot lint
pnpm --filter @opencord-chat/bot test
pnpm --filter @opencord-chat/bot build   # tsc + scripts/bundle-types.mjs (embute as declarações do contracts)
```

## Publicar

A publicação é automática pelo workflow `publish-sdk.yml` quando uma tag `bot-sdk-vX.Y.Z` é criada e bate com a
versão do `package.json`. Usa o "trusted publishing" do npm (OIDC, sem token no repositório), que precisa ser
configurado uma vez na página do pacote no npm (Settings → Trusted publisher → GitHub Actions,
`estopassoli/opencord`, workflow `publish-sdk.yml`).

```sh
# subir a versão em packages/bot-sdk/package.json, commitar e:
git tag bot-sdk-v0.2.0 && git push origin bot-sdk-v0.2.0
```
