# Bots e aplicativos

Guia para quem desenvolve bots para o OpenCord (ADR-0032). Um bot é um usuário com token: entra em servidores como
membro, recebe cargos, manda mensagens, reage e responde a comandos de barra. O SDK `@opencord-chat/bot` (MIT) usa os
nomes que a comunidade de bots já conhece; quem preferir fala direto com a API REST e o gateway (seção 7).

Todos os blocos "Resultado" deste guia foram obtidos rodando o código contra uma API real (roteiro em
`packages/bot-sdk/examples/`, mesma versão do SDK). Os ids são UUIDs v7; os nomes de usuário de bots são gerados
(`bot-xxxxxx`).

## 0. Bots oficiais prontos (ADR-0037)

Em Configurações do servidor → Bots → Adicionar, qualquer servidor encontra os bots oficiais da instância: **YOU6**
(níveis e boas-vindas), **Dínamo** (automod e avisos), **Carlos** (tags, lembretes, sorteios), **Dank Mineiro**
(economia de brincadeira), **Tíquete** (tickets) e **Oráculo** (IA). Depois de adicionar, dê ao bot um cargo com
o que ele precisa: Dínamo pede "Gerenciar mensagens" e "Castigar membros"; Tíquete pede "Gerenciar canais" e
"Gerenciar cargos". O código deles está em `apps/bots` e serve de exemplo completo do SDK.

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

## 3. Instalar e primeiro bot

```sh
pnpm add @opencord-chat/bot        # npm (MIT); do repositório: pnpm add file:…/packages/bot-sdk
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

Resultado no terminal (`node bot.mjs`):

```
online como bot-0b1407
```

No app: alguém escreve `!ping` e o bot responde `pong` citando a mensagem; ao digitar `/` no composer aparece
`/ola` com a opção `nome`; `/ola nome:Bruno` mostra um cartão "Olá, Bruno!" só para quem usou o comando.

Exemplo completo: `packages/bot-sdk/examples/ping.mjs`.

## 4. Referência do SDK, com resultados

Cenário usado nos exemplos: Ana criou o servidor **Clube do Livro** (canais `#geral` e `Sala`) e o bot
**Bibliotecário**, e o adicionou ao servidor. Bruno entra mais tarde.

### 4.1 Client

```js
const client = new Client({ baseUrl: 'http://localhost:3000' }); // ou OPENCORD_URL
client.on(Events.Debug, (m) => console.log('[debug]', m));
client.once(Events.ClientReady, (c) => console.log(c.user));
await client.login('ocb_...'); // ou OPENCORD_TOKEN
```

Resultado:

```
[debug] gateway pronto (sessão bot:01a19c7d-a0a8-7f30-84ed-927fde8b6c36); heartbeat a cada 25000 ms
ClientUser {
  id: '01a19c7d-a0a8-7f30-84ed-92800e860693',
  username: 'bot-0b1407',
  displayName: 'Bibliotecário',
  bot: true,
  avatarKey: null
}
```

| Membro                                     | O que faz                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `new Client({ baseUrl?, cache?, intents?, partials? })` | `baseUrl` ou `OPENCORD_URL`; `cache: false` não carrega servidores no `ready`; `intents`/`partials` são aceitos e ignorados |
| `login(token?)`                            | token ou `OPENCORD_TOKEN`; busca `/me` e `/bots/@me`, conecta ao gateway e mantém o heartbeat. Resolve com o token                         |
| `destroy()`                                | fecha o gateway; o bot aparece offline                                                                                                      |
| `user`                                     | `ClientUser` (um `User`) depois do `login`                                                                                                  |
| `isReady()`, `readyAt`, `uptime`, `ws.ping` | estado da conexão; `ws.ping` é a latência do último heartbeat em ms                                                                        |
| `application.fetch()`                      | o registro do bot (`GET /bots/@me`)                                                                                                         |
| `application.commands.set([...])` / `fetch()` | registra (substitui) e lista os comandos de barra                                                                                        |
| `guilds.cache` / `guilds.fetch(id)`        | `Map<id, Guild>`; `fetch` recarrega canais, cargos e membros                                                                                |
| `channels.cache` / `channels.fetch(id)`    | `Map<id, TextChannel>` com todos os canais dos servidores do bot                                                                            |
| `users.cache` / `users.fetch(id)`          | `Map<id, User>`; `fetch` consulta o perfil público                                                                                          |
| `rest`                                     | `RestClient` já autenticado: `rest.get/post/put/patch/delete(caminho, corpo)` para qualquer rota da API                                     |

```js
console.log(client.isReady(), client.uptime, client.ws.ping, client.readyAt);
console.log(await client.application.fetch());
```

Resultado:

```
true 0 2 2026-11-02T13:40:41.294Z
{
  id: '01a19c7d-a0a8-7f30-84ed-927fde8b6c36',
  user: { id: '01a19c7d-a0a8-7f30-84ed-92800e860693', username: 'bot-0b1407', displayName: 'Bibliotecário', avatarKey: null, bot: true },
  ownerId: '01a19c7d-a08b-7703-aebe-c36995af23c7',
  description: 'Organiza as leituras',
  public: false,
  createdAt: '2026-11-02T13:40:41.256Z',
  lastSeenAt: '2026-11-02T13:40:41.270Z',
  commands: []
}
```

```js
for (const g of client.guilds.cache.values())
  console.log({ id: g.id, name: g.name, memberCount: g.memberCount, myPermissions: g.myPermissions });
```

Resultado:

```
{ id: '01a19c7d-a099-7563-bc8a-0300624e4c94', name: 'Clube do Livro', memberCount: 2, myPermissions: 1979 }
```

`myPermissions` são os bits de `Permission` (`packages/contracts/src/permissions.ts`) que o bot tem no servidor —
aqui, os de `@everyone`.

`ready` é emitido **uma vez**. Depois de uma queda o socket reconecta sozinho, recarrega os caches e emite `resume`.
Ao final:

```js
client.destroy();
console.log(client.isReady(), client.uptime); // false null
```

### 4.2 Comandos de barra: `SlashCommandBuilder`, `commands.set`, `REST`

```js
const cmds = await client.application.commands.set([
  new SlashCommandBuilder()
    .setName('ola')
    .setDescription('Cumprimenta alguém')
    .addStringOption((o) => o.setName('nome').setDescription('Quem cumprimentar').setRequired(true)),
  new SlashCommandBuilder()
    .setName('sorteio')
    .setDescription('Sorteia um número')
    .addIntegerOption((o) => o.setName('maximo').setDescription('Até quanto').setRequired(true))
    .addBooleanOption((o) => o.setName('publico').setDescription('Mostrar para todos'))
    .addUserOption((o) => o.setName('para').setDescription('Quem ganha'))
    .addChannelOption((o) => o.setName('canal').setDescription('Onde anunciar'))
    .addStringOption((o) =>
      o.setName('tema').setDescription('Tema').addChoices({ name: 'Ficção', value: 'ficcao' }, { name: 'Técnico', value: 'tecnico' }),
    ),
  new SlashCommandBuilder().setName('demorado').setDescription('Leva alguns segundos'),
]);
console.log(cmds);
```

Resultado (`BotCommand[]`, o que ficou salvo):

```
[
  {
    name: 'ola',
    description: 'Cumprimenta alguém',
    options: [ { name: 'nome', description: 'Quem cumprimentar', type: 'string', required: true, choices: [] } ]
  },
  {
    name: 'sorteio',
    description: 'Sorteia um número',
    options: [
      { name: 'maximo',  description: 'Até quanto',          type: 'integer', required: true,  choices: [] },
      { name: 'publico', description: 'Mostrar para todos',  type: 'boolean', required: false, choices: [] },
      { name: 'para',    description: 'Quem ganha',          type: 'user',    required: false, choices: [] },
      { name: 'canal',   description: 'Onde anunciar',       type: 'channel', required: false, choices: [] },
      { name: 'tema',    description: 'Tema',                type: 'string',  required: false,
        choices: [ { name: 'Ficção', value: 'ficcao' }, { name: 'Técnico', value: 'tecnico' } ] }
    ]
  },
  { name: 'demorado', description: 'Leva alguns segundos', options: [] }
]
```

```js
console.log((await client.application.commands.fetch()).map((c) => c.name));
```

Resultado: `[ 'ola', 'sorteio', 'demorado' ]`. É isso que o app lista ao digitar `/` em qualquer servidor em que
o bot é membro (`GET /servers/:id/commands` devolve `[{ botId, bot, commands }]`).

Métodos do builder: `setName`, `setDescription`, `addStringOption`, `addIntegerOption`, `addNumberOption`,
`addBooleanOption`, `addUserOption`, `addChannelOption`, `toJSON()`. Na opção: `setName`, `setDescription`,
`setRequired`, `addChoices(...{ name, value })` (só string/integer/number). Aceitos e ignorados, para o código portado
compilar: `setDefaultMemberPermissions`, `setDMPermission`, `setNSFW`, `setAutocomplete`, `setMinValue`,
`setMaxValue`, `setMinLength`, `setMaxLength`.

O builder valida antes de chamar a API:

```js
new SlashCommandBuilder().setName('Ola!').setDescription('x').toJSON();
// Error: comando: nome "Ola!" inválido (minúsculas, dígitos, _ ou -, até 32 caracteres)

new SlashCommandBuilder().setName('x').setDescription('x')
  .addStringOption((o) => o.setName('a').setDescription('a'))
  .addStringOption((o) => o.setName('b').setDescription('b').setRequired(true))
  .toJSON();
// Error: comando "x": a opção obrigatória "b" precisa vir antes das opcionais
```

Quem registra comandos "à moda antiga" usa `REST` + `Routes`:

```js
import { REST, Routes } from '@opencord-chat/bot';

const rest = new REST({ baseUrl: process.env.OPENCORD_URL }).setToken(process.env.OPENCORD_TOKEN);
const bot = await rest.put(Routes.applicationCommands(botId), { body: cmds });
console.log(bot.commands.map((c) => c.name));
```

Resultado: `[ 'ola', 'sorteio', 'demorado' ]`. `Routes.applicationGuildCommands()` leva ao mesmo lugar: comandos
são **globais** (valem em todo servidor em que o bot é membro). Outros caminhos: `Routes.channelMessages(canalId)`
→ `/channels/<id>/messages`, `Routes.interactionReply(id)` → `/interactions/<id>/reply`, `Routes.user()` → `/me`.

### 4.3 Interações (`interactionCreate`, `ChatInputCommandInteraction`)

Ana usa `/sorteio maximo:10 publico:true para:@Bruno canal:#geral tema:Ficção`:

```js
client.on(Events.InteractionCreate, async (i) => {
  console.log({
    id: i.id, commandName: i.commandName, user: i.user.tag, member: i.member?.displayName,
    guild: i.guild?.name, channel: String(i.channel), createdAt: i.createdAt,
    isChatInputCommand: i.isChatInputCommand(), isButton: i.isButton(),
  });
});
```

Resultado:

```
{
  id: '9619c73c-d903-4577-9e33-5a31d3576d97',
  commandName: 'sorteio',
  user: 'ana_403g',
  member: 'Ana-403g',
  guild: 'Clube do Livro',
  channel: '#geral',
  createdAt: 2026-11-02T13:40:41.543Z,
  isChatInputCommand: true,
  isButton: false
}
```

Lendo as opções:

```js
console.log({
  getInteger: i.options.getInteger('maximo', true),
  getBoolean: i.options.getBoolean('publico'),
  getUser: i.options.getUser('para')?.tag,
  getMember: i.options.getMember('para')?.displayName,
  getChannel: String(i.options.getChannel('canal')),
  getString: i.options.getString('tema'),
  ausente: i.options.getString('inexistente'),
  data: i.options.data,
});
i.options.getString('inexistente', true);
```

Resultado:

```
{
  getInteger: 10,
  getBoolean: true,
  getUser: 'bruno_403g',
  getMember: 'Bruno-403g',
  getChannel: '#geral',
  getString: 'ficcao',
  ausente: null,
  data: [
    { name: 'maximo', value: 10 },
    { name: 'publico', value: true },
    { name: 'para', value: '01a19c7d-a1a2-7c60-ba56-db13dca4146e' },
    { name: 'canal', value: '01a19c7d-a09c-7493-a68b-2684ddf4abb1' },
    { name: 'tema', value: 'ficcao' }
  ]
}
Error: opção obrigatória "inexistente" não informada
```

`getNumber` funciona como `getInteger`. `getSubcommand()` devolve `null` (não há subcomandos); `getUser`/`getChannel`
devolvem um objeto só com o id quando a pessoa ou o canal não estão no cache.

Respondendo:

```js
const r1 = await i.reply({ content: 'Sorteado: **7** (de 10)', ephemeral: true });
console.log(r1, i.replied);
await i.reply('de novo');
```

Resultado:

```
{ messageId: null } true
Error: interação já respondida: use editReply ou followUp
```

Efêmera (`messageId: null`): só quem usou o comando vê, como um cartão no chat; não vira mensagem do canal. Resposta
normal vira uma mensagem comum do bot e devolve o id dela:

```js
// Bruno usou /ola nome:Bruno
const r2 = await i.reply(`Olá, ${i.options.getString('nome', true)}!`);
const msg = await i.fetchReply();
const edited = await i.editReply('Olá, Bruno! (editado)');
const extra = await i.followUp({ embeds: [new EmbedBuilder().setTitle('Dica').setDescription('Use /sorteio para sortear.')] });
await i.deleteReply();
```

Resultado, passo a passo:

```
reply      → { messageId: '01a19c7d-a1d6-7963-a784-b3b224aed6c1' }
fetchReply → Message { id: '01a19c7d-a1d6-…', content: 'Olá, Bruno!', author: 'bot-0b1407' }
editReply  → Message { id: '01a19c7d-a1d6-…', content: 'Olá, Bruno! (editado)', editedAt: 2026-11-02T13:40:41.579Z }
followUp   → Message { id: '01a19c7d-a1f3-7f82-a443-7111ed7f3ccd', content: '**Dica**\nUse /sorteio para sortear.' }
deleteReply → (sem retorno; a mensagem da resposta some do canal)
```

Trabalho demorado: `deferReply()` mostra "pensando…" e ganha até 15 min para responder.

```js
await i.deferReply();
console.log(i.deferred, i.replied); // true false
await fazerAlgoDemorado();
console.log(await i.editReply('Pronto! Levou 1,5 s.'), i.replied);
```

Resultado:

```
true false
{ messageId: '01a19c7d-a7ee-7fb0-9400-f440b07dc48b' } true
```

Responder tarde demais (interação expirada, 180 s sem resposta) ou a um id inexistente:

```js
await client.rest.post('/interactions/00000000-0000-4000-8000-000000000000/reply', { content: 'tarde', ephemeral: false });
```

Resultado:

```
OpenCordAPIError { status: 404, message: 'interação não encontrado', method: 'POST', path: '/interactions/…/reply' }
```

Campos e métodos: `id`, `commandName`, `user`, `member`, `guild`, `guildId`, `channel`, `channelId`, `createdAt`,
`createdTimestamp`, `options`, `replied`, `deferred`; `reply`, `deferReply({ ephemeral? })`, `editReply`,
`followUp`, `fetchReply`, `deleteReply`; `isChatInputCommand()`/`isCommand()`/`isRepliable()`/`inGuild()` → `true`;
`isButton()`/`isStringSelectMenu()`/`isModalSubmit()`/`isAutocomplete()` → `false`.

### 4.4 Mensagens: `TextChannel.send`, `Message`, `EmbedBuilder`

```js
const guild = client.guilds.cache.get(serverId);
const channel = [...guild.channels.cache.values()].find((c) => c.name === 'geral');
const m = await channel.send('Bem-vindos ao Clube do Livro!');
console.log({ id: m.id, content: m.content, author: m.author.tag, bot: m.author.bot, channel: String(m.channel),
  guild: m.guild?.name, createdAt: m.createdAt, url: m.url, inGuild: m.inGuild() });
```

Resultado:

```
{
  id: '01a19c7d-a0eb-7bf0-8696-667581ff01e9',
  content: 'Bem-vindos ao Clube do Livro!',
  author: 'bot-0b1407',
  bot: true,
  channel: '#geral',
  guild: 'Clube do Livro',
  createdAt: 2026-11-02T13:40:41.324Z,
  url: 'http://localhost:3000/messages/01a19c7d-a0eb-7bf0-8696-667581ff01e9',
  inGuild: true
}
```

Na 0.1 `EmbedBuilder` virava markdown; desde a 0.2.0 é um cartão de verdade (seção 5.2). O markdown abaixo continua
disponível por `toMarkdown()`.

```js
const embed = new EmbedBuilder()
  .setTitle('Leitura do mês')
  .setURL('https://exemplo.dev/livro')
  .setDescription('Vamos ler juntos até dia 30.')
  .addFields({ name: 'Livro', value: 'Dom Casmurro' }, { name: 'Páginas', value: '256', inline: true })
  .setFooter({ text: 'Clube do Livro' })
  .setTimestamp(new Date('2026-11-02T10:00:00-03:00'));
console.log(embed.toMarkdown());
const m2 = await channel.send({ content: 'Anúncio:', embeds: [embed] });
console.log(m2.content);
```

Resultado:

```
**[Leitura do mês](https://exemplo.dev/livro)**
Vamos ler juntos até dia 30.
**Livro**: Dom Casmurro
**Páginas**: 256
_Clube do Livro • 02/11/2026, 10:00:00_
```

e `m2.content` é `'Anúncio:'`, uma linha em branco e o mesmo bloco. `setColor` é aceito e ignorado; `setImage`/
`setThumbnail` viram o link; `setAuthor` vira a primeira linha.

Recebendo uma mensagem (Ana escreve `@Bibliotecário !ping`):

```js
client.on(Events.MessageCreate, (m) => {
  if (m.author.bot) return;
  console.log({ id: m.id, content: m.content, author: m.author.tag, member: m.member?.displayName, guild: m.guild?.name,
    channel: String(m.channel), mentionsMe: m.mentions.has(client.user), users: [...m.mentions.users.keys()],
    everyone: m.mentions.everyone });
});
```

Resultado:

```
{
  id: '01a19c7d-a10d-7010-a5a8-8c9ff0d3c2f3',
  content: '<@01a19c7d-a0a8-7f30-84ed-92800e860693> !ping',
  author: 'ana_403g',
  member: 'Ana-403g',
  guild: 'Clube do Livro',
  channel: '#geral',
  mentionsMe: true,
  users: [ '01a19c7d-a0a8-7f30-84ed-92800e860693' ],
  everyone: false
}
```

Menções chegam como `<@id>` no texto. Respondendo, reagindo, editando, fixando e apagando:

```js
const pong = await m.reply('pong');
console.log(pong.reference);
```

Resultado:

```
{ messageId: '01a19c7d-a10d-7010-a5a8-8c9ff0d3c2f3', channelId: '01a19c7d-a09c-7493-a68b-2684ddf4abb1', guildId: '01a19c7d-a099-7563-bc8a-0300624e4c94' }
```

```js
client.on(Events.MessageReactionAdd, (reaction, user) =>
  console.log('+', reaction.emoji.name, reaction.count, reaction.message.id, reaction.message.partial, user.tag));
client.on(Events.MessageReactionRemove, (reaction) => console.log('-', reaction.emoji.name, reaction.count));
await m.react('👍');
await m.unreact('👍');
```

Resultado (o bot recebe as próprias reações):

```
+ 👍 1 01a19c7d-a10d-7010-a5a8-8c9ff0d3c2f3 true bot-0b1407
- 👍 0
```

```js
client.on(Events.MessageUpdate, (oldM, newM) => console.log('update', oldM, newM.content));
const edited = await pong.edit('pong (editado)');
console.log(edited.content, edited.editedAt);
```

Resultado:

```
update null pong (editado)
pong (editado) 2026-11-02T13:40:41.400Z
```

`messageUpdate` traz `old` como `null`: a API não guarda a versão anterior.

```js
await pong.pin();
```

Resultado, com o bot só com `@everyone`:

```
OpenCordAPIError { status: 403, message: 'permissão insuficiente', method: 'PUT', path: '/messages/01a19c7d-a11a-…/pin' }
```

Fixar exige `MANAGE_MESSAGES`. Ana cria o cargo "Moderação" com essa permissão e dá ao bot; depois de
`guild.fetch()`:

```js
const me = guild.members.cache.get(client.user.id);
console.log([...me.roles.cache.values()].map((r) => r.name), me.permissions, guild.myPermissions);
await pong.pin();   // agora fixa: pinnedAt '2026-11-02T13:40:41.440Z'
await pong.unpin(); // pinnedAt volta a null
```

Resultado:

```
[ 'Moderação' ] 4 1983
```

```js
client.on(Events.MessageDelete, (p) => console.log({ id: p.id, partial: p.partial, channelId: p.channelId, inGuild: p.inGuild() }));
await pong.delete();
```

Resultado (`PartialMessage`: só o id é conhecido; `p.fetch()` tenta recuperar entre as 100 mais recentes):

```
{ id: '01a19c7d-a11a-7e83-860b-c1c594596ad1', partial: true, channelId: '01a19c7d-a09c-7493-a68b-2684ddf4abb1', inGuild: true }
```

Histórico:

```js
const page = await channel.messages.fetch({ limit: 3 });
console.log([...page.values()].map((x) => `${x.author.tag}: ${x.content.split('\n')[0]}`));
```

Resultado (mais recente primeiro; mensagem apagada vem como lápide com `deleted: true` e texto vazio):

```
[ 'bot-0b1407: ', 'ana_403g: <@01a19c7d-a0a8-7f30-84ed-92800e860693> !ping', 'bot-0b1407: Anúncio:' ]
```

Campos de `Message`: `id`, `content`, `author` (`User`), `member`, `channel`, `channelId`, `conversationId` (DM),
`guild`, `guildId`, `createdAt`, `createdTimestamp`, `editedAt`, `deleted`, `mentions` (`users`, `everyone`,
`has()`), `reference`, `reactions` (na 0.2.0 um `ReactionManager`: `.cache`, `.removeAll()`), `attachments`
(na 0.2.0 uma `Collection` de `Attachment`), `embeds`, `components`, `pinnedAt`, `url`, `partial: false`. Métodos: `reply`, `react`,
`unreact`, `edit`, `delete`, `pin`, `unpin`, `inGuild()`, `toString()` (o conteúdo).

### 4.5 Usuários e conversas diretas

```js
const ana = await client.users.fetch(anaId);
console.log({ username: ana.username, displayName: ana.displayName, tag: ana.tag, globalName: ana.globalName, bot: ana.bot, mention: String(ana) });
const dm = await ana.createDM();
console.log({ id: dm.id, type: dm.type, guild: dm.guild, isDMBased: dm.isDMBased() });
const sent = await ana.send('Oi, Ana! Mensagem direta do bot.');
console.log({ id: sent.id, content: sent.content, conversationId: sent.conversationId, guild: sent.guild, inGuild: sent.inGuild() });
```

Resultado:

```
{ username: 'ana_403g', displayName: 'Ana-403g', tag: 'ana_403g', globalName: 'Ana-403g', bot: false, mention: '<@01a19c7d-a08b-7703-aebe-c36995af23c7>' }
{ id: '01a19c7d-a18a-7e91-ac38-41ec5a3ac79c', type: 'dm', guild: null, isDMBased: true }
{ id: '01a19c7d-a198-7863-98f2-9d13c962ce60', content: 'Oi, Ana! Mensagem direta do bot.', conversationId: '01a19c7d-a18a-…', guild: null, inGuild: false }
```

Não há discriminador: `tag` é o próprio `username`. `User.toString()` gera a menção. `DMChannel` tem `send` e
`messages.fetch` como um canal de texto; mensagens de DM chegam em `messageCreate` com `conversationId` preenchido
e `guild` `null`.

### 4.6 Servidores, cargos, canais e membros

```js
const guild = client.guilds.cache.get(serverId);
console.log([...guild.channels.cache.values()].map((c) => ({ id: c.id, name: c.name, type: c.type, str: String(c) })));
console.log([...guild.roles.cache.values()].map((r) => ({ name: r.name, position: r.position, permissions: r.permissions, isEveryone: r.isEveryone })));
const ana = await guild.members.fetch(anaId);
console.log({ id: ana.id, displayName: ana.displayName, nickname: ana.nickname, joinedAt: ana.joinedAt, roleIds: ana.roleIds, permissions: ana.permissions, mention: String(ana) });
```

Resultado:

```
[
  { id: '01a19c7d-a09c-7493-a68b-2684ddf4abb1', name: 'geral', type: 'text', str: '#geral' },
  { id: '01a19c7d-a09d-73f0-bc4e-1f256976fe20', name: 'Sala', type: 'voice', str: '#Sala' }
]
[ { name: '@everyone', position: 0, permissions: 1979, isEveryone: true } ]
{
  id: '01a19c7d-a08b-7703-aebe-c36995af23c7',
  displayName: 'Ana-403g',
  nickname: null,
  joinedAt: 2026-11-02T13:40:41.243Z,
  roleIds: [],
  permissions: 0,
  mention: '<@01a19c7d-a08b-7703-aebe-c36995af23c7>'
}
```

Na 0.2.0 `GuildMember.permissions` virou um `PermissionsBitField` (inclui `@everyone`; dona/ADMINISTRATOR = tudo):
`member.permissions.has('BanMembers')`, `.toArray()`, `.bitfield`. Para "o que o bot pode fazer" use
`guild.myPermissions` e `channel.myPermissions`.
`guild.members.fetch()` sem id recarrega e devolve o `Map` inteiro.

Eventos de membros e canais (Bruno entra por convite, Ana cria `#resenhas`, expulsa Bruno e remove o bot):

```js
client.on(Events.GuildMemberAdd, (m) => console.log('entrou', m.displayName, m.guild.name, m.joinedAt));
client.on(Events.ChannelCreate, (c) => console.log('canal', c.name, c.type, c.guild?.name, c.isTextBased(), c.myPermissions));
client.on(Events.GuildMemberRemove, (m) => console.log('saiu', m.displayName));
client.on(Events.GuildDelete, (g) => console.log('fora de', g.name, client.guilds.cache.size));
```

Resultado:

```
entrou Bruno-403g Clube do Livro 2026-11-02T13:40:41.527Z
canal resenhas text Clube do Livro true 1983
saiu Bruno-403g
fora de Clube do Livro 0
```

`guildCreate` dispara quando alguém adiciona o bot a um servidor; `guildDelete` quando o bot é removido ou o
servidor é excluído. `channelUpdate(old, new)` e `channelDelete(channel)` seguem o mesmo padrão.

### 4.7 Todos os eventos

| Evento (`Events.*`)                                  | Argumentos                                   | Quando                                                     |
| ---------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `ClientReady` (`'ready'`)                            | `(client)`                                   | uma vez, com os caches carregados                          |
| `'resume'`                                           | —                                            | reconectou depois de uma queda (caches recarregados)       |
| `MessageCreate`                                      | `(message)`                                  | mensagem em canal ou DM que o bot vê (inclusive as dele)   |
| `MessageUpdate`                                      | `(null, message)`                            | edição                                                     |
| `MessageDelete`                                      | `(partialMessage)`                           | exclusão                                                   |
| `MessageReactionAdd` / `MessageReactionRemove`       | `(reaction, user)`                           | reação colocada/tirada                                     |
| `InteractionCreate`                                  | `(interaction)`                              | alguém usou um comando do bot                              |
| `GuildMemberAdd` / `GuildMemberRemove`               | `(member)`                                   | entrou/saiu (ou expulso) de um servidor do bot             |
| `GuildCreate` / `GuildDelete`                        | `(guild)`                                    | bot adicionado / removido (ou servidor excluído)           |
| `ChannelCreate` / `ChannelUpdate` / `ChannelDelete`  | `(channel)` / `(old, new)` / `(channel)`     | canais do servidor                                         |
| `Error`                                              | `(error)`                                    | token recusado, sessão revogada, erro num handler          |
| `Disconnect`                                         | `(reason)`                                   | gateway caiu (reconecta sozinho)                           |
| `Debug`                                              | `(text)`                                     | diagnóstico (conexão, heartbeat, falhas de cache)          |

### 4.8 Erros

- `OpenCordAPIError` (de `@opencord-chat/bot`): qualquer resposta não-2xx da API. Campos `status`, `message`,
  `details` (nos 400 de validação, `[{ path, message }]`), `method`, `path`. Exemplos reais acima: 403 "permissão
  insuficiente", 404 "interação não encontrado".
- `Error` comum: validação local (builders, `reply()` repetido, mensagem vazia: `mensagem vazia: informe content ou ao
  menos um embed`, URL/token ausentes).
- Erros dentro de um handler de evento vão para `Events.Error` se houver ouvinte; senão para `Events.Debug` (o
  processo não cai).

## 5. Novidades da 0.2.0, com resultados

Tudo abaixo foi obtido rodando `packages/bot-sdk/examples/tour-v2.mjs` contra uma API real. Cenário: Ana criou o
**Clube do Livro** e o bot **Bibliotecário**; Bruno entrou por convite. Os "cliques" e envios das pessoas são as
mesmas requisições que o app faz.

### 5.1 Comandos: subcomandos, grupos, autocompletar, permissões e menus de contexto

```js
await client.application.commands.set([
  new SlashCommandBuilder()
    .setName('livro').setDescription('Gerencia a leitura do mês')
    .addSubcommand((s) => s.setName('sugerir').setDescription('Sugere um livro')
      .addStringOption((o) => o.setName('titulo').setDescription('Título').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('paginas').setDescription('Páginas').setMinValue(1).setMaxValue(2000)))
    .addSubcommandGroup((g) => g.setName('votacao').setDescription('Votação do mês')
      .addSubcommand((s) => s.setName('abrir').setDescription('Abre a votação'))
      .addSubcommand((s) => s.setName('fechar').setDescription('Fecha a votação')
        .addRoleOption((o) => o.setName('cargo').setDescription('Cargo que decide')))),
  new SlashCommandBuilder().setName('limpar').setDescription('Apaga mensagens recentes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('quantas').setDescription('Até 100').setRequired(true).setMinValue(1).setMaxValue(100)),
  new ContextMenuCommandBuilder().setName('Reportar mensagem').setType(ApplicationCommandType.Message),
  new ContextMenuCommandBuilder().setName('Ver leituras').setType(ApplicationCommandType.User),
]);
```

Resultado (resumido; `type` chat/message/user, `defaultMemberPermissions: 4` = MANAGE_MESSAGES):

```
[
  { type: 'chat', name: 'livro', options: [
      { type: 'subcommand', name: 'sugerir', options: [
          { name: 'titulo', type: 'string', required: true, autocomplete: true },
          { name: 'paginas', type: 'integer', minValue: 1, maxValue: 2000 } ] },
      { type: 'subcommand_group', name: 'votacao', options: [
          { type: 'subcommand', name: 'abrir' }, { type: 'subcommand', name: 'fechar', options: [ … cargo: role ] } ] } ],
    defaultMemberPermissions: null, guildIds: [] },
  { type: 'chat', name: 'limpar', options: [ { name: 'quantas', type: 'integer', required: true, minValue: 1, maxValue: 100 } ],
    defaultMemberPermissions: 4, guildIds: [] },
  { type: 'message', name: 'Reportar mensagem', description: '', options: [] },
  { type: 'user', name: 'Ver leituras', description: '', options: [] }
]
```

No app: `/livro` abre o popover com `sugerir` e `votacao`; `votacao` abre `abrir`/`fechar`; comandos de contexto
aparecem em **Apps** no botão direito de uma pessoa ou mensagem. `setGuildIds([...])` deixa o comando só em alguns
servidores. Bruno usa `/livro votacao fechar cargo:@Moderação`:

```js
client.on(Events.InteractionCreate, (i) => {
  if (!i.isChatInputCommand()) return;
  console.log(i.commandName, i.options.getSubcommandGroup(), i.options.getSubcommand(), i.options.getRole('cargo')?.name);
});
```

Resultado: `livro votacao fechar Moderação`. `/limpar` sem MANAGE_MESSAGES:

```
POST /interactions → 403 {"message":"sem permissão para este comando"}
```

**Autocompletar:** enquanto a pessoa digita `titulo:se`, o app pergunta ao bot (espera até 3 s):

```js
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isAutocomplete()) return;
  const typed = i.options.getFocused(true); // { name: 'titulo', value: 'se' }
  await i.respond(livros.filter((l) => l.toLowerCase().includes(typed.value.toLowerCase())).map((l) => ({ name: l, value: l })));
});
```

Resultado (o que o app recebe de `POST /interactions { type: 'autocomplete' }`):

```
{ id: '82369d12-…', choices: [ { name: 'Grande Sertão: Veredas', value: 'Grande Sertão: Veredas' }, { name: 'Vidas Secas', value: 'Vidas Secas' } ] }
```

### 5.2 Embeds de verdade

`EmbedBuilder` agora vira um cartão no app (barra colorida, autor, título com link, descrição em markdown, campos
em grade, miniatura, imagem, rodapé com data), não mais markdown.

```js
const embed = new EmbedBuilder()
  .setColor('#7c5cff').setAuthor({ name: 'Clube do Livro' })
  .setTitle('Leitura do mês: Dom Casmurro').setURL('https://exemplo.dev/dom-casmurro')
  .setDescription('Machado de Assis, 1899. Capítulos 1–20 até sexta.')
  .addFields({ name: 'Páginas', value: '256', inline: true }, { name: 'Meta', value: '20 cap.', inline: true })
  .setFooter({ text: 'Votação aberta até domingo' }).setTimestamp(new Date('2026-11-02T10:00:00-03:00'));
console.log(embed.toJSON());
```

Resultado:

```
{
  fields: [ { name: 'Páginas', value: '256', inline: true }, { name: 'Meta', value: '20 cap.', inline: true } ],
  title: 'Leitura do mês: Dom Casmurro',
  description: 'Machado de Assis, 1899. Capítulos 1–20 até sexta.',
  url: 'https://exemplo.dev/dom-casmurro',
  color: '#7c5cff',
  footer: { text: 'Votação aberta até domingo' },
  author: { name: 'Clube do Livro' },
  timestamp: '2026-11-02T13:00:00.000Z'
}
```

`setColor` aceita `0x7c5cff`, `'#7c5cff'`, `'Red'`, `[r, g, b]`. Limites: 10 embeds por mensagem, 6000 caracteres
por embed, 25 campos. Só bots e webhooks enviam embeds.

### 5.3 Botões e menus (componentes)

```js
const row1 = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('vou-ler').setLabel('Vou ler').setStyle(ButtonStyle.Primary).setEmoji('📚'),
  new ButtonBuilder().setCustomId('passo').setLabel('Passo').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setLabel('Comprar').setStyle(ButtonStyle.Link).setURL('https://exemplo.dev/comprar'),
);
const row2 = new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('ritmo').setPlaceholder('Seu ritmo de leitura').addOptions(
    new StringSelectMenuOptionBuilder().setLabel('Devagar').setValue('lento').setDescription('1 capítulo por dia'),
    new StringSelectMenuOptionBuilder().setLabel('Normal').setValue('normal').setDefault(true),
    new StringSelectMenuOptionBuilder().setLabel('Maratona').setValue('rapido').setEmoji('🔥'),
  ),
);
const m = await channel.send({ content: 'Chegou a leitura do mês!', embeds: [embed], components: [row1, row2] });
console.log({ id: m.id, embeds: m.embeds.map((e) => e.title), components: m.components.map((r) => r.components.map((c) => c.customId ?? c.url)) });
```

Resultado:

```
{ id: '01a19cdc-9fda-7172-b337-d42dd1d85e4f', embeds: [ 'Leitura do mês: Dom Casmurro' ],
  components: [ [ 'vou-ler', 'passo', 'https://exemplo.dev/comprar' ], [ 'ritmo' ] ] }
```

Até 5 linhas, cada uma com até 5 botões ou 1 menu. Menus `UserSelectMenuBuilder`, `RoleSelectMenuBuilder` e
`ChannelSelectMenuBuilder` listam pessoas, cargos e canais do servidor no app e entregam ids. Bruno clica em
"Vou ler" e depois escolhe "Maratona":

```js
client.on(Events.InteractionCreate, async (i) => {
  if (i.isButton()) {
    console.log({ customId: i.customId, user: i.user.tag, message: i.message?.id, componentType: i.componentType });
    await i.update({ content: 'Chegou a leitura do mês! **1 pessoa** vai ler.', embeds: [embed], components: [row1, row2] });
  }
  if (i.isStringSelectMenu()) {
    console.log({ customId: i.customId, values: i.values });
    const r = await i.reply({ content: `Anotado: ritmo **${i.values[0]}**.`, ephemeral: true });
    console.log({ messageId: r.messageId, ephemeral: i.ephemeral });
  }
});
```

Resultado:

```
{ customId: 'vou-ler', user: 'bruno_tfs5', message: '01a19cdc-9fda-…', componentType: 'button' }
→ update: chat:message:updated { content: 'Chegou a leitura do mês! **1 pessoa** vai ler.', editedAt: '2026-11-02T15:24:27.000Z' }
{ customId: 'ritmo', values: [ 'rapido' ] }
{ messageId: null, ephemeral: true }
```

`update()` edita a mensagem de origem; `deferUpdate()` só acusa o clique; `reply()` responde como um comando
(efêmero vira cartão "Só você vê", que também pode ter botões: o clique chega com `i.ephemeralOf`).

### 5.4 Modais (formulários)

Comando de contexto "Reportar mensagem" numa mensagem abre um formulário:

```js
client.on(Events.InteractionCreate, async (i) => {
  if (i.isMessageContextMenuCommand()) {
    console.log({ commandName: i.commandName, target: i.targetMessage.content.slice(0, 40), user: i.user.tag });
    await i.showModal(new ModalBuilder().setCustomId('reporte').setTitle('Reportar mensagem').addComponents(
      new TextInputBuilder().setCustomId('motivo').setLabel('Motivo').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
      new TextInputBuilder().setCustomId('contato').setLabel('Contato (opcional)').setStyle(TextInputStyle.Short).setRequired(false),
    ));
  }
  if (i.isModalSubmit()) {
    console.log({ customId: i.customId, motivo: i.fields.getTextInputValue('motivo'), contato: i.fields.getTextInputValue('contato') });
    await i.reply({ content: 'Reporte recebido. Obrigado!', ephemeral: true });
  }
});
```

Resultado:

```
{ commandName: 'Reportar mensagem', target: 'Chegou a leitura do mês! **1 pessoa** va', user: 'bruno_tfs5' }
→ a pessoa recebe interaction:modal { modalId: 'da952ec1-…', title: 'Reportar mensagem', fields: [ 'motivo (paragraph, obrigatório)', 'contato (short)' ] }
{ customId: 'reporte', motivo: 'Spoiler no título!', contato: '' }
```

Campo opcional em branco não vem no envio: `getTextInputValue` devolve `''` (`getField(id)` lança). Até 5 campos;
o modal vale 15 min. `interaction.awaitModalSubmit({ time })` espera o envio no mesmo lugar do código.

### 5.5 Moderação

```js
const member = await guild.members.fetch(brunoId);
console.log({ bitfield: member.permissions.bitfield, has: member.permissions.has('SendMessages'), some: member.permissions.toArray().slice(0, 4) });
await member.timeout(60_000, 'spoiler');
const after = await guild.members.fetch(brunoId);
console.log({ until: after.communicationDisabledUntil, disabled: after.isCommunicationDisabled() });
```

Resultado:

```
{ bitfield: 1979, has: true, some: [ 'ViewChannel', 'SendMessages', 'AttachFiles', 'AddReactions' ] }
{ until: 2026-11-02T15:25:27.104Z, disabled: true }
```

Em castigo, Bruno tenta escrever: `403 {"message":"em castigo até 2026-11-02T15:25:27.104Z"}` (vale para
mensagens, reações, comandos e entrar em voz; o app desabilita o composer). `member.timeout(null)` tira.

```js
const deleted = await channel.bulkDelete(mensagens);          // até 100; MANAGE_MESSAGES ou só as próprias
client.on(Events.GuildBanAdd, (ban) => console.log({ user: ban.user.tag, reason: ban.reason, executor: ban.executor?.tag }));
await guild.members.ban(brunoId, { reason: 'spoilers repetidos', deleteMessageSeconds: 3600 });
await guild.bans.remove(brunoId);
console.log((await guild.bans.fetch()).size);
```

Resultado:

```
{ apagadas: 3 }
{ user: 'bruno_tfs5', reason: 'spoilers repetidos', executor: 'bot-6bb276' }
banido tenta voltar pelo convite → 403 {"message":"banido deste servidor"}
0
```

O bot precisa de um cargo com `BanMembers`/`ModerateMembers`/`ManageMessages`; a hierarquia de cargos vale como
para pessoas (dono e super admin são intocáveis). Também: `member.kick(reason)`, `message.reactions.removeAll()`,
`guild.bans.fetch()`, eventos `guildBanAdd/guildBanRemove`, `guildMemberUpdate`.

### 5.6 Enquetes, digitando, presença, eventos, gestão, busca, webhooks

```js
const pollMsg = await channel.send({ poll: { question: 'Próximo gênero?', answers: [{ text: 'Ficção' }, { text: 'Técnico' }], allowMultiselect: false, duration: 24 } });
console.log({ question: pollMsg.poll.question, answers: pollMsg.poll.answers.map((a) => a.text) });
await channel.sendTyping();                                   // quem está no canal recebe chat:typing
await client.user.setPresence({ status: 'dnd', activities: [{ name: 'organizando a estante' }] });
```

Resultado:

```
{ question: { text: 'Próximo gênero?' }, answers: [ 'Ficção', 'Técnico' ] }
chat:typing { channelId: '01a19cdc-…', userId: '<bot>', active: true }
```

Também disponíveis: `poll.vote(ids)`, `poll.end()`, evento `pollUpdate`; `typingStart`, `presenceUpdate`,
`guild.presences.cache`; `client.user.setStatus('idle')`, `setActivity('nome')`, `setStatusText('texto')`;
`guild.scheduledEvents.create({ name, scheduledStartTime, channel })` + `event.rsvp('going')`;
`guild.channels.create({ name, type: ChannelType.GuildText, parent })`, `guild.roles.create({ name, permissions, color })`,
`member.roles.add(role)`, `guild.invites.create()`, `guild.fetchAuditLogs()`, `guild.edit({ name })`;
`channel.messages.search({ q, authorId, has })`, `guild.messages.search(...)`, `channel.messages.fetchPinned()`,
`message.fetchReplies()`, `message.fetch()` (GET /messages/:id); `channel.createWebhook({ name })` e `webhook.send()`;
anexos: `channel.send({ files: [new AttachmentBuilder('./capa.png')] })` ou `files: ['./capa.png']`.

### 5.7 Coletores

```js
const collector = m.createMessageComponentCollector({ time: 3000, filter: (i) => i.customId === 'passo' });
collector.on('collect', (i) => void i.deferUpdate());
collector.on('end', (collected, reason) => console.log({ coletados: collected.size, motivo: reason }));
```

Resultado: `{ coletados: 1, motivo: 'time' }`. Também `channel.createMessageCollector`, `awaitMessages`,
`awaitMessageComponent`, `awaitModalSubmit`; razões `time`, `idle`, `limit`, `user`.

### 5.8 Escala

- **REST com fila:** 4 requisições em paralelo por padrão, 429 espera o `Retry-After` e emite
  `client.on(Events.RateLimited, ({ route, retryAfterMs }) => …)`; 5xx e falhas de rede tentam de novo (500 → 1000 →
  2000 ms). `client.rest.queued` mostra a fila. Resultado no tour: `{ queued: 0, ping: 2, status: 'ready' }`.
- **Retomada do gateway:** ao reconectar o bot pede `sync:resume` com a última mensagem vista por canal e emite
  `messageCreate` do que perdeu (sem repetir), depois `resume`.
- **Shards:** `new ShardingManager('./bot.mjs', { totalShards: 2 }).spawn()` roda o bot em N processos; cada um
  trata só os servidores cujo `hash(guildId) % total === shardId` (`client.shard.id`, `client.inShard(guildId)`).
  Honestidade: a API e o gateway continuam uma instância só; o shard serve para dividir CPU/memória do bot, não a
  conexão. Sem sharding, `client.shard` é `null`.

### 5.9 Utilidades e mudanças em relação à 0.1

- `Collection` (todos os caches): `first()`, `find()`, `filter()`, `map()`, `some()`, `sort()`, `random()`, `at()`.
- `PermissionsBitField` + `PermissionFlagsBits` (`ViewChannel`, `SendMessages`, …, `BanMembers`, `ModerateMembers`).
- Constantes: `ApplicationCommandType`, `ButtonStyle`, `ComponentType`, `TextInputStyle`, `ChannelType`,
  `MessageFlags.Ephemeral`, `InteractionType`, `Colors`, `Limits`.
- Eventos novos: `typingStart`, `presenceUpdate`, `pollUpdate`, `channelPinsUpdate`, `guildMemberUpdate`,
  `guildBanAdd/Remove`, `guildUpdate`, `roleCreate/Update/Delete`, `guildScheduledEventCreate/Update/Delete`,
  `categoryCreate/Update/Delete`, `userUpdate`, `messageDeleteBulk`, `messageReactionRemoveAll`, `warn`, `rateLimited`.
- Mudanças: `message.reactions` é um `ReactionManager` (antes array); `member.permissions` é `PermissionsBitField`
  (antes número; `Number(member.permissions)` dá o valor); `message.attachments` é `Collection`;
  `options.getSubcommand()` lança se não houver subcomando (use `getSubcommand(false)`); limite de 25 opções por
  comando (antes 10); `interactionCreate` recebe a união de interações (em TypeScript, estreite com
  `isChatInputCommand()` etc.).

## 6. Regras das interações

- **Registro:** `PUT /bots/@me/commands` substitui a lista inteira (até 50 comandos, 10 opções cada, 25 escolhas por
  opção). Nomes: `[a-z0-9_-]{1,32}`; descrições de 1 a 100 caracteres; **opções obrigatórias antes das opcionais**.
  Tipos: `string`, `integer`, `number`, `boolean`, `user`, `channel`. Comandos são **globais**.
- **Ciclo:** a pessoa usa `/ola nome:Ana` → a API valida (permissão `SEND_MESSAGES` no canal, opções contra a
  definição, bot conectado — senão **409 bot offline**) → o bot recebe `interaction:created` → responde.
- **TTL:** a interação espera **180 s** por `reply`; `defer` ("pensando…") estende para **15 min**. Depois disso o
  `reply` devolve 404/410.
- **Efêmera** (`ephemeral: true`): só quem usou o comando vê; não vira mensagem (`messageId: null`). **Normal:**
  mensagem comum do bot no canal, e `messageId` permite `editReply`/`fetchReply`/`deleteReply`.
- **Componentes:** clique vira interação `component` (`messageId` ou `ephemeralOf`, `customId`, `values`); só são
  aceitos se a mensagem é de um bot, a pessoa vê o canal e o `customId` existe; o bot responde com `update`, `defer`
  (`update: true`), `reply` ou `modal`. **Modais:** `POST /interactions/:id/modal` abre; o envio vira interação
  `modal` com `modalId` (15 min). **Autocompletar:** síncrono para o app (`{ choices }`, até 3 s).

## 7. Referência para quem não usa o SDK

**Autenticação.** `Authorization: Bearer ocb_…` em toda rota; o mesmo token no handshake do Socket.IO
(`auth: { token }`). O token é de bot (`sessionId = bot:<id>`): qualquer rota de usuário vale (mensagens, reações,
membros, canais, presença), com as permissões de membro. `GET /me` devolve o usuário do bot com `bot: true`.

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
| `POST /conversations` `{ userIds }`            | abre (ou reaproveita) uma conversa direta → `{ id, … }`                              |
| `POST /conversations/:id/messages`             | mesmo corpo da mensagem de canal, em conversa direta                                 |
| `PATCH /messages/:id` `{ body }`               | editar                                                                               |
| `DELETE /messages/:id`                         | apagar                                                                               |
| `PUT`/`DELETE /messages/:id/reactions/:emoji`  | reagir / tirar reação (emoji URL-encoded)                                            |
| `PUT`/`DELETE /messages/:id/pin`               | fixar / desafixar (`MANAGE_MESSAGES`)                                                |
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

## 8. Portando do discord.js

A compatibilidade é de **forma de uso**, não de protocolo: o SDK foi escrito do zero sobre a API do OpenCord. Para
um bot de mensagens e comandos, trocar o import e o token costuma bastar.

| No discord.js                                           | No OpenCord                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `import { … } from 'discord.js'`                        | `import { … } from '@opencord-chat/bot'`                                                             |
| `client.login(DISCORD_TOKEN)`                           | `client.login(OPENCORD_TOKEN)` + `baseUrl`/`OPENCORD_URL` (cada instância tem a própria API)         |
| `intents: [GatewayIntentBits.…]`, `partials`            | aceitos e ignorados: o bot recebe os eventos dos servidores em que é membro, conforme os cargos      |
| ids snowflake (`'1234…'`)                               | UUIDs; nada de `SnowflakeUtil`/timestamps extraídos do id                                            |
| `guild`                                                 | servidor (`Guild` continua sendo o nome no SDK; `guildId` = id do servidor)                          |
| `message.guild`/`guildId`                               | iguais; `null` em conversa direta; precisam do cache de canais (carregado no `ready`)                |
| `user.tag`, `user#1234`                                 | `tag` = `username` (não há discriminador); `user.toString()` → `<@uuid>`                             |
| `EmbedBuilder` + `embeds: [...]`                        | iguais: cartão rico no app (cor, campos, imagem, rodapé) — seção 5.2                                |
| Botões, menus, modais, autocompletar, subcomandos       | iguais (`ButtonBuilder`, `StringSelectMenuBuilder`, `ModalBuilder`, `setAutocomplete`, `addSubcommand`) — seção 5 |
| Voz (`@discordjs/voice`)                                | não há; o bot não entra em chamadas                                                                  |
| `PermissionFlagsBits`, `setDefaultMemberPermissions`    | iguais; `member.permissions` é `PermissionsBitField`; a API confere `defaultMemberPermissions`       |
| `REST` + `Routes.applicationCommands(appId)`            | iguais; o corpo vai para `PUT /bots/@me/commands`; comandos por servidor via `guildIds` no comando     |
| `interaction.reply({ ephemeral: true })`                | igual; `flags: MessageFlags.Ephemeral` também funciona                                               |
| `messageUpdate(old, new)`                               | `old` vem `null` (a API não guarda a versão anterior)                                                |
| `client.on('ready')` a cada reconexão                   | `ready` uma vez; reconexão emite `resume`                                                            |
| OAuth2 / link de convite do bot                         | adicionar pela tela Configurações do servidor → Bots                                                 |

## 9. Limites e segurança

- O servidor guarda só o **SHA-256** do token; vazou → **Gerar novo token** (o antigo morre na hora) e troque no
  ambiente do bot. Nunca commite o token; use `OPENCORD_TOKEN`.
- O bot só faz o que os cargos dele permitem; não dê `ADMINISTRATOR` a um bot que não precisa.
- O token de bot não passa pela renovação de sessão (não expira sozinho); apagar o bot invalida tudo.
- Limite global de **300 requisições/min por IP** — se o bot e a API rodam na mesma rede atrás de um proxy, confira
  `CLIENT_IP_HEADER` para o limite não contar todo mundo como um IP só.
- Interações expiram (180 s / 15 min adiada); respostas atrasadas falham com 404/410 — trate o erro.
- Sem loja nem verificação de bots: só adicione bots de quem você confia (o código roda na máquina de quem o criou).
