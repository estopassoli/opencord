# Bots e aplicativos

Guia para quem desenvolve bots para o OpenCord (ADR-0032). Um bot é um usuário com token: entra em servidores como
membro, recebe cargos, manda mensagens, reage e responde a comandos de barra. O SDK `@opencord-chat/bot` usa os nomes que a
comunidade de bots já conhece; quem preferir fala direto com a API REST e o gateway (seção 5).

## 1. Criar um bot no app

1. Configurações → **Aplicativos** → **Novo bot**: nome, descrição e se é público (aparece na lista "Adicionar bot"
   de qualquer servidor) ou privado (só pelo id).
2. O **token** (`ocb_…`) aparece **uma única vez**. Guarde num lugar seguro (variável de ambiente, cofre). Se perder,
   **Gerar novo token** invalida o anterior na hora.
3. Limite: 10 bots por pessoa.

## 2. Adicionar ao servidor

Configurações do servidor → **Bots** → adicionar da lista pública ou colando o id do bot. Precisa de
`MANAGE_SERVER`. O bot entra como membro comum: dê cargos a ele como daria a uma pessoa — as permissões que valem são
as dos cargos (ver canal, enviar mensagens, gerenciar mensagens…). Remover o bot é na mesma tela.

## 3. Primeiro bot em 20 linhas

```sh
pnpm add @opencord-chat/bot        # npm: @opencord-chat/bot (MIT); do repositório: pnpm add file:…/packages/bot-sdk
export OPENCORD_URL=https://api.seu-opencord.dev
export OPENCORD_TOKEN=ocb_...
```

```js
import { Client, Events, SlashCommandBuilder } from '@opencord-chat/bot';

const client = new Client();

client.once(Events.ClientReady, async (c) => {
  console.log(`online como ${c.user.tag}`);
  await c.application.commands.set([
    new SlashCommandBuilder()
      .setName('ola')
      .setDescription('Cumprimenta alguém')
      .addStringOption((o) => o.setName('nome').setDescription('Quem').setRequired(true)),
  ]);
});
client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot) return; // o bot também recebe as próprias mensagens
  if (m.content === '!ping') await m.reply('pong');
});
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  await i.reply({ content: `Olá, ${i.options.getString('nome', true)}!`, ephemeral: true });
});
await client.login();
```

Exemplo completo: `packages/bot-sdk/examples/ping.mjs`.

O que o `Client` expõe:

| Membro                                                                                              | O que faz                                                                        |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `new Client({ baseUrl?, intents?, partials?, cache? })`                                             | `baseUrl` ou `OPENCORD_URL`; `intents`/`partials` são aceitos e ignorados        |
| `login(token?)`, `destroy()`                                                                        | token ou `OPENCORD_TOKEN`; conecta ao gateway e mantém o heartbeat               |
| `user` (`ClientUser`), `guilds.cache`/`fetch(id)`, `channels.cache`/`fetch(id)`, `users.fetch(id)`  | caches carregados no `ready` (servidores, canais, membros, cargos)               |
| `application.commands.set([...])`                                                                   | `PUT /bots/@me/commands`; aceita `SlashCommandBuilder` ou objetos do contrato    |
| Eventos `ready`, `messageCreate/Update/Delete`, `messageReactionAdd/Remove`, `interactionCreate`    | também `guildMemberAdd/Remove`, `guildCreate/Delete`, `channelCreate/Update/Delete`, `error`, `disconnect`, `debug`, `resume` |
| `Message`                                                                                           | `content`, `author`, `channel`, `guild`, `mentions`, `reference`; `reply`, `react`, `edit`, `delete`, `pin` |
| `ChatInputCommandInteraction`                                                                       | `commandName`, `user`, `member`, `options.getString/Integer/Number/Boolean/User/Channel`; `reply`, `deferReply`, `editReply`, `followUp` |
| `EmbedBuilder`                                                                                      | vira markdown (`toMarkdown()`); `embeds: [...]` em `send`/`reply` concatena ao texto |
| `REST` + `Routes`                                                                                   | `new REST().setToken(t).put(Routes.applicationCommands(id), { body })`           |

`ready` é emitido uma vez; depois de uma queda o socket reconecta sozinho, recarrega os caches e emite `resume`.

## 4. Comandos de barra e interações

- **Registro:** `PUT /bots/@me/commands` substitui a lista inteira (até 50 comandos, 10 opções cada, 25 escolhas por
  opção). Nomes: `[a-z0-9_-]{1,32}`; descrições de 1 a 100 caracteres; **opções obrigatórias antes das opcionais**.
  Tipos: `string`, `integer`, `number`, `boolean`, `user`, `channel`. Comandos são **globais**: valem em todo servidor
  em que o bot é membro; o app os mostra ao digitar `/` no composer.
- **Ciclo:** a pessoa usa `/ola nome:Ana` → a API valida (permissão `SEND_MESSAGES` no canal, opções contra a
  definição, bot conectado — senão **409 bot offline**) → o bot recebe `interaction:created` → responde.
- **TTL:** a interação espera **180 s** por `reply`; `defer` ("pensando…") estende para **15 min**. Depois disso o
  `reply` devolve 404/410.
- **`reply({ content, ephemeral })`:** efêmera → só quem usou o comando vê (evento `interaction:replied`, não vira
  mensagem); normal → mensagem comum do bot no canal, e a resposta traz `messageId` (o SDK usa em `editReply` via
  `PATCH /messages/:id`).
- **`deferReply()` + `editReply()`:** para trabalho demorado. `followUp()` manda outra mensagem no canal.
- Não há botões, menus, modais, autocompletar nem subcomandos nesta fase.

## 5. Referência para quem não usa o SDK

**Autenticação.** `Authorization: Bearer ocb_…` em toda rota; o mesmo token no handshake do Socket.IO
(`auth: { token }`). O token é de bot (`sessionId = bot:<id>`): qualquer rota de usuário vale (mensagens, reações,
membros, canais, presença), com as permissões de membro.

**Rotas de bot.**

| Rota                                           | Uso                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /me`                                      | o usuário do bot (`bot: true`)                                                       |
| `GET /bots/@me`                                | o registro do bot (id, dono, descrição, `commands`, `lastSeenAt`)                    |
| `PUT /bots/@me/commands` `{ commands: [...] }` | substitui os comandos                                                                |
| `GET /servers`, `GET /servers/:id`             | servidores do bot; detalhe com canais, cargos, membros e `myPermissions`             |
| `GET /servers/:id/commands`                    | comandos disponíveis no servidor (por bot membro) — é o que o app lista no composer  |
| `GET /channels/:id/messages?limit=&before=`    | histórico                                                                            |
| `POST /channels/:id/messages`                  | `{ requestId: uuid, body, replyToId? }` → `Message`                                  |
| `POST /conversations/:id/messages`             | mesmo corpo, em conversa direta (`POST /conversations { userIds }` abre uma)         |
| `PATCH /messages/:id` `{ body }`               | editar                                                                               |
| `DELETE /messages/:id`                         | apagar                                                                               |
| `PUT`/`DELETE /messages/:id/reactions/:emoji`  | reagir / tirar reação (emoji URL-encoded)                                            |
| `POST /interactions/:id/defer`                 | "pensando…" (204)                                                                    |
| `POST /interactions/:id/reply`                 | `{ content, ephemeral }` → `{ messageId \| null }`                                   |

Erros vêm como `{ statusCode, message, details? }`; 400 de validação traz `details: [{ path, message }]`.

**Gateway.** Socket.IO em `path: '/realtime'`, `transports: ['websocket']`. Todo evento chega embrulhado em
`{ eventId, schemaVersion: 1, occurredAt, payload }` — use `payload`; `eventId` pode repetir após reconexão (ignore
duplicados). Após o evento `ready` (`{ userId, sessionId, heartbeatIntervalMs }`) envie o comando
`presence:heartbeat` com `{ status: 'online' }` a cada `heartbeatIntervalMs` (25 s hoje), com ack
(`{ ok: true, data: { ttlSeconds } }`); sem heartbeat o bot aparece offline e `/interactions` responde 409. Eventos
que interessam a um bot: `chat:message:created|updated|deleted`, `chat:reaction:changed`, `interaction:created`,
`server:added|removed|deleted`, `server:member:joined|updated|left`, `channel:created|updated|deleted`,
`user:updated`, `session:revoked`. Comandos do cliente (sempre com ack): `chat:message:create`, `chat:message:edit`,
`chat:message:delete`, `chat:reaction:set`, `chat:typing:start|stop`, `presence:heartbeat` — a lista completa está em
`packages/contracts/src/realtime.ts`.

**Limites.** 300 requisições/min por IP (vale para bots); 10 bots por pessoa; 50 comandos, 10 opções, 25 escolhas;
mensagens até 4000 caracteres; payload do socket até 64 KB.

## 6. Portando do discord.js

A compatibilidade é de **forma de uso**, não de protocolo: o SDK foi escrito do zero sobre a API do OpenCord. Para
um bot de mensagens e comandos, trocar o import e o token costuma bastar.

| No discord.js                                           | No OpenCord                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `import { … } from 'discord.js'`                        | `import { … } from '@opencord-chat/bot'`                                                                  |
| `client.login(DISCORD_TOKEN)`                           | `client.login(OPENCORD_TOKEN)` + `baseUrl`/`OPENCORD_URL` (cada instância tem a própria API)         |
| `intents: [GatewayIntentBits.…]`, `partials`            | aceitos e ignorados: o bot recebe os eventos dos servidores em que é membro, conforme os cargos      |
| ids snowflake (`'1234…'`)                               | UUIDs; nada de `SnowflakeUtil`/timestamps extraídos do id                                            |
| `guild`                                                 | servidor (`Guild` continua sendo o nome no SDK; `guildId` = id do servidor)                          |
| `message.guild`/`guildId`                               | iguais; `null` em conversa direta; precisam do cache de canais (carregado no `ready`)                |
| `user.tag`, `user#1234`                                 | `tag` = `username` (não há discriminador); `user.toString()` → `<@uuid>`                             |
| `EmbedBuilder` + `embeds: [...]`                        | vira markdown concatenado ao texto (título em negrito, campos `**nome**: valor`, rodapé em itálico); `setColor` ignorado; imagens viram links |
| Botões, menus, modais, autocompletar, subcomandos       | não existem nesta fase (`isButton()` etc. devolvem `false`)                                          |
| Voz (`@discordjs/voice`)                                | não há; o bot não entra em chamadas                                                                  |
| `PermissionFlagsBits`, `setDefaultMemberPermissions`    | permissões são os cargos do OpenCord (`member.permissions` com os bits de `@opencord/contracts`); o setter é aceito e ignorado |
| `REST` + `Routes.applicationCommands(appId)`            | iguais; o corpo vai para `PUT /bots/@me/commands`. `Routes.applicationGuildCommands` leva ao mesmo lugar: **comandos são globais** |
| `interaction.reply({ ephemeral: true })`                | igual; `flags: MessageFlags.Ephemeral` não existe — use `ephemeral`                                  |
| `messageUpdate(old, new)`                               | `old` vem `null` (a API não guarda a versão anterior)                                                |
| `client.on('ready')` a cada reconexão                   | `ready` uma vez; reconexão emite `resume`                                                            |
| OAuth2 / link de convite do bot                         | adicionar pela tela Configurações do servidor → Bots                                                 |

## 7. Limites e segurança

- O servidor guarda só o **SHA-256** do token; vazou → **Gerar novo token** (o antigo morre na hora) e troque no
  ambiente do bot. Nunca commite o token; use `OPENCORD_TOKEN`.
- O bot só faz o que os cargos dele permitem; não dê `ADMINISTRATOR` a um bot que não precisa.
- O token de bot não passa pela renovação de sessão (não expira sozinho); apagar o bot invalida tudo.
- Limite global de **300 requisições/min por IP** — se o bot e a API rodam na mesma rede atrás de um proxy, confira
  `CLIENT_IP_HEADER` para o limite não contar todo mundo como um IP só.
- Interações expiram (180 s / 15 min adiada); respostas atrasadas falham com 404/410 — trate o erro.
- Sem loja nem verificação de bots: só adicione bots de quem você confia (o código roda na máquina de quem o criou).
