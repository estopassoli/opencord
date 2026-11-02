/* eslint-disable no-console -- exemplo: imprimir os resultados é o objetivo */
// Tour do SDK: exercita cada método contra uma API de desenvolvimento (precisa de entrada por apelido liberada) e
// imprime os resultados; é a fonte dos blocos "Resultado" de docs/BOTS.md. Rode com OPENCORD_URL apontando para a API.
import { inspect } from 'node:util';
import { Client, Events, SlashCommandBuilder, EmbedBuilder, REST, Routes, OpenCordAPIError } from '@opencord-chat/bot';

const BASE = process.env.OPENCORD_URL ?? 'http://localhost:3000';
const tag = Date.now().toString(36).slice(-4);
const show = (label, v) =>
  console.log(
    `\n### ${label}\n${typeof v === 'string' ? v : inspect(v, { depth: 4, colors: false, breakLength: 100 })}`,
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const once = (emitter, ev, pred = () => true, ms = 6000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (...a) => {
      if (!pred(...a)) return;
      clearTimeout(t);
      emitter.off(ev, h);
      res(a);
    };
    emitter.on(ev, h);
  });

// --- cenário: Ana (dona) cria o servidor e o bot; Bruno entra depois ---
const ana = await req('POST', '/auth/guest', null, { nickname: `Ana-${tag}`, deviceId: `ana-${tag}` });
const A = ana.tokens.accessToken;
const server = await req('POST', '/servers', A, { name: `Clube do Livro` });
const geral = server.channels.find((c) => c.kind === 'text');
const bot = await req('POST', '/me/bots', A, {
  name: `Bibliotecário`,
  description: 'Organiza as leituras',
  public: false,
});
await req('POST', `/servers/${server.id}/bots`, A, { botId: bot.id });

const client = new Client({ baseUrl: BASE });
client.on(Events.Debug, (m) => console.log(`[debug] ${m}`));
client.on(Events.Error, (e) => console.log(`[error] ${e.message}`));
const readyP = once(client, Events.ClientReady);
await client.login(bot.token);
await readyP;

const u = client.user;
show('client.user (ClientUser)', {
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  tag: u.tag,
  bot: u.bot,
  mention: String(u),
});
show('client.isReady() / uptime / ws.ping', {
  isReady: client.isReady(),
  uptime: client.uptime,
  ping: client.ws.ping,
  readyAt: client.readyAt,
});
show('client.application.fetch()', await client.application.fetch());
show(
  'client.guilds.cache',
  [...client.guilds.cache.values()].map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberCount,
    myPermissions: g.myPermissions,
  })),
);
const guild = client.guilds.cache.get(server.id);
show(
  'guild.channels.cache',
  [...guild.channels.cache.values()].map((c) => ({ id: c.id, name: c.name, type: c.type, str: String(c) })),
);
show(
  'guild.roles.cache',
  [...guild.roles.cache.values()].map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    permissions: r.permissions,
    isEveryone: r.isEveryone,
  })),
);
const anaMember = await guild.members.fetch(ana.user.id);
show('guild.members.fetch(id) (GuildMember)', {
  id: anaMember.id,
  displayName: anaMember.displayName,
  nickname: anaMember.nickname,
  joinedAt: anaMember.joinedAt,
  roleIds: anaMember.roleIds,
  permissions: anaMember.permissions,
  mention: String(anaMember),
});

// comandos
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
      o
        .setName('tema')
        .setDescription('Tema')
        .addChoices({ name: 'Ficção', value: 'ficcao' }, { name: 'Técnico', value: 'tecnico' }),
    ),
  new SlashCommandBuilder().setName('demorado').setDescription('Leva alguns segundos'),
]);
show('client.application.commands.set([...]) → BotCommand[]', cmds);
show(
  'client.application.commands.fetch()',
  (await client.application.commands.fetch()).map((c) => c.name),
);
show(
  'GET /servers/:id/commands (o que o app lista ao digitar /)',
  await req('GET', `/servers/${server.id}/commands`, A),
);

// erro de builder
try {
  new SlashCommandBuilder().setName('Ola!').setDescription('x').toJSON();
} catch (e) {
  show('SlashCommandBuilder com nome inválido → Error', e.message);
}
try {
  new SlashCommandBuilder()
    .setName('x')
    .setDescription('x')
    .addStringOption((o) => o.setName('a').setDescription('a'))
    .addStringOption((o) => o.setName('b').setDescription('b').setRequired(true))
    .toJSON();
} catch (e) {
  show('opção obrigatória depois de opcional → Error', e.message);
}

// REST + Routes
const rest = new REST({ baseUrl: BASE }).setToken(bot.token);
const viaRest = await rest.put(Routes.applicationCommands(bot.id), { body: cmds });
show('new REST().setToken(t).put(Routes.applicationCommands(id), { body }) → Bot', {
  id: viaRest.id,
  commands: viaRest.commands.map((c) => c.name),
});
show('Routes', {
  applicationCommands: Routes.applicationCommands('x'),
  channelMessages: Routes.channelMessages('<canal>'),
  interactionReply: Routes.interactionReply('<id>'),
  user: Routes.user(),
});

// envio em canal
const channel = guild.channels.cache.get(geral.id);
const m1 = await channel.send('Bem-vindos ao Clube do Livro!');
show('channel.send(texto) → Message', {
  id: m1.id,
  content: m1.content,
  author: m1.author.tag,
  authorBot: m1.author.bot,
  channel: String(m1.channel),
  guild: m1.guild?.name,
  createdAt: m1.createdAt,
  url: m1.url,
  inGuild: m1.inGuild(),
});
const embed = new EmbedBuilder()
  .setTitle('Leitura do mês')
  .setURL('https://exemplo.dev/livro')
  .setDescription('Vamos ler juntos até dia 30.')
  .addFields({ name: 'Livro', value: 'Dom Casmurro' }, { name: 'Páginas', value: '256', inline: true })
  .setFooter({ text: 'Clube do Livro' })
  .setTimestamp(new Date('2026-11-02T10:00:00-03:00'));
show('EmbedBuilder.toMarkdown()', embed.toMarkdown());
const m2 = await channel.send({ content: 'Anúncio:', embeds: [embed] });
show('channel.send({ content, embeds }) → Message.content', m2.content);

// evento messageCreate com menção
const created = once(client, Events.MessageCreate, (m) => !m.author.bot);
await req('POST', `/channels/${geral.id}/messages`, A, { requestId: crypto.randomUUID(), body: `<@${u.id}> !ping` });
const [msg] = await created;
show('evento messageCreate (Message)', {
  id: msg.id,
  content: msg.content,
  author: msg.author.tag,
  member: msg.member?.displayName,
  guild: msg.guild?.name,
  channel: String(msg.channel),
  mentionsMe: msg.mentions.has(client.user),
  mentionUsers: [...msg.mentions.users.keys()],
  everyone: msg.mentions.everyone,
});

const pong = await msg.reply('pong');
show('message.reply(texto) → Message', { id: pong.id, content: pong.content, reference: pong.reference });

const reactP = once(client, Events.MessageReactionAdd);
await msg.react('👍');
const [reaction, reactor] = await reactP;
show('message.react(emoji) → evento messageReactionAdd (reaction, user)', {
  emoji: reaction.emoji.name,
  count: reaction.count,
  messageId: reaction.message.id,
  partial: reaction.message.partial,
  user: reactor.tag,
});
const unreactP = once(client, Events.MessageReactionRemove);
await msg.unreact('👍');
const [r2] = await unreactP;
show('message.unreact(emoji) → evento messageReactionRemove', { emoji: r2.emoji.name, count: r2.count });

const updP = once(client, Events.MessageUpdate);
const edited = await pong.edit('pong (editado)');
const [oldM, newM] = await updP;
show('message.edit(texto) → Message', { content: edited.content, editedAt: edited.editedAt });
show('evento messageUpdate (old, new)', { old: oldM, new: newM.content });

try {
  await pong.pin();
} catch (e) {
  show('message.pin() sem o cargo certo → OpenCordAPIError', {
    status: e.status,
    message: e.message,
    method: e.method,
    path: e.path,
  });
}
// Ana dá ao bot um cargo com MANAGE_MESSAGES (bit 1 << 2) e o cache do servidor é recarregado
const role = await req('POST', `/servers/${server.id}/roles`, A, { name: 'Moderação', permissions: 1 << 2 });
await req('PUT', `/servers/${server.id}/members/${u.id}/roles`, A, { roleIds: [role.id] });
await guild.fetch();
show('depois de ganhar o cargo: guild.members.cache.get(bot).roles / permissions', {
  roles: [...guild.members.cache.get(u.id).roles.cache.values()].map((r) => r.name),
  permissions: guild.members.cache.get(u.id).permissions,
  myPermissions: guild.myPermissions,
});
await pong.pin();
const pinnedDto = (await req('GET', `/channels/${geral.id}/messages?limit=5`, A)).messages.find(
  (x) => x.id === pong.id,
);
show('message.pin() → mensagem fixada', { pinnedAt: pinnedDto.pinnedAt });
await pong.unpin();
show('message.unpin()', {
  pinnedAt: (await req('GET', `/channels/${geral.id}/messages?limit=5`, A)).messages.find((x) => x.id === pong.id)
    .pinnedAt,
});

const delP = once(client, Events.MessageDelete);
await pong.delete();
const [partial] = await delP;
show('message.delete() → evento messageDelete (PartialMessage)', {
  id: partial.id,
  partial: partial.partial,
  channelId: partial.channelId,
  inGuild: partial.inGuild(),
});

const page = await channel.messages.fetch({ limit: 3 });
show(
  'channel.messages.fetch({ limit: 3 }) → Map<id, Message>',
  [...page.values()].map((m) => `${m.author.tag}: ${m.content.split('\n')[0]}`),
);

// usuários e DM
const anaUser = await client.users.fetch(ana.user.id);
show('client.users.fetch(id) → User', {
  id: anaUser.id,
  username: anaUser.username,
  displayName: anaUser.displayName,
  tag: anaUser.tag,
  globalName: anaUser.globalName,
  bot: anaUser.bot,
  mention: String(anaUser),
});
const dm = await anaUser.createDM();
show('user.createDM() → DMChannel', { id: dm.id, type: dm.type, guild: dm.guild, isDMBased: dm.isDMBased() });
const dmMsg = await anaUser.send('Oi, Ana! Mensagem direta do bot.');
show('user.send(texto) → Message (DM)', {
  id: dmMsg.id,
  content: dmMsg.content,
  conversationId: dmMsg.conversationId,
  guild: dmMsg.guild,
  inGuild: dmMsg.inGuild(),
});

// interações
const bruno = await req('POST', '/auth/guest', null, { nickname: `Bruno-${tag}`, deviceId: `bruno-${tag}` });
const B = bruno.tokens.accessToken;
const memberAddP = once(client, Events.GuildMemberAdd);
const invite = await req('POST', `/servers/${server.id}/invites`, A);
await req('POST', `/invites/${invite.code}`, B);
const [newMember] = await memberAddP;
show('evento guildMemberAdd (GuildMember)', {
  id: newMember.id,
  displayName: newMember.displayName,
  guild: newMember.guild.name,
  joinedAt: newMember.joinedAt,
});

const interP = once(client, Events.InteractionCreate);
await req('POST', '/interactions', A, {
  channelId: geral.id,
  botId: bot.id,
  command: 'sorteio',
  options: { maximo: 10, publico: true, para: bruno.user.id, canal: geral.id, tema: 'ficcao' },
});
const [i1] = await interP;
show('evento interactionCreate (ChatInputCommandInteraction)', {
  id: i1.id,
  commandName: i1.commandName,
  user: i1.user.tag,
  member: i1.member?.displayName,
  guild: i1.guild?.name,
  channel: String(i1.channel),
  createdAt: i1.createdAt,
  isChatInputCommand: i1.isChatInputCommand(),
  isButton: i1.isButton(),
});
show('interaction.options.get*', {
  getInteger: i1.options.getInteger('maximo', true),
  getBoolean: i1.options.getBoolean('publico'),
  getUser: i1.options.getUser('para')?.tag,
  getMember: i1.options.getMember('para')?.displayName,
  getChannel: String(i1.options.getChannel('canal')),
  getString: i1.options.getString('tema'),
  getStringAusente: i1.options.getString('inexistente'),
  data: i1.options.data,
});
try {
  i1.options.getString('inexistente', true);
} catch (e) {
  show("options.getString('inexistente', true) → Error", e.message);
}
const rep1 = await i1.reply({ content: `Sorteado: **7** (de ${i1.options.getInteger('maximo')})`, ephemeral: true });
show('interaction.reply({ ephemeral: true }) → InteractionReplyResponse', { ...rep1, replied: i1.replied });
try {
  await i1.reply('de novo');
} catch (e) {
  show('reply() duas vezes → Error', e.message);
}

const interP2 = once(client, Events.InteractionCreate);
await req('POST', '/interactions', B, {
  channelId: geral.id,
  botId: bot.id,
  command: 'ola',
  options: { nome: 'Bruno' },
});
const [i2] = await interP2;
const rep2 = await i2.reply(`Olá, ${i2.options.getString('nome', true)}!`);
show('interaction.reply(texto) (no canal) → InteractionReplyResponse', rep2);
const fetched = await i2.fetchReply();
show('interaction.fetchReply() → Message', { id: fetched.id, content: fetched.content, author: fetched.author.tag });
const ed = await i2.editReply('Olá, Bruno! (editado)');
show('interaction.editReply(texto) → Message', { id: ed.id, content: ed.content, editedAt: ed.editedAt });
const fu = await i2.followUp({
  embeds: [new EmbedBuilder().setTitle('Dica').setDescription('Use /sorteio para sortear.')],
});
show('interaction.followUp({ embeds }) → Message', { id: fu.id, content: fu.content });
await i2.deleteReply();
show('interaction.deleteReply()', 'mensagem da resposta apagada (sem retorno)');

const interP3 = once(client, Events.InteractionCreate);
await req('POST', '/interactions', A, { channelId: geral.id, botId: bot.id, command: 'demorado', options: {} });
const [i3] = await interP3;
await i3.deferReply();
show('interaction.deferReply()', { deferred: i3.deferred, replied: i3.replied });
await sleep(1500);
const ed3 = await i3.editReply('Pronto! Levou 1,5 s.');
show('interaction.editReply() depois de deferReply() → InteractionReplyResponse', { ...ed3, replied: i3.replied });

// erros da API
try {
  await client.rest.post(`/interactions/00000000-0000-4000-8000-000000000000/reply`, {
    content: 'tarde demais',
    ephemeral: false,
  });
} catch (e) {
  show('resposta a interação inexistente/expirada → OpenCordAPIError', {
    name: e.name,
    status: e.status,
    message: e.message,
    instanceOf: e instanceof OpenCordAPIError,
  });
}
try {
  await channel.send('');
} catch (e) {
  show("channel.send('') → Error", e.message);
}

// canais e membros
const chCreateP = once(client, Events.ChannelCreate);
await req('POST', `/servers/${server.id}/channels`, A, { name: 'resenhas', kind: 'text' });
const [newCh] = await chCreateP;
show('evento channelCreate (TextChannel)', {
  id: newCh.id,
  name: newCh.name,
  type: newCh.type,
  guild: newCh.guild?.name,
  isTextBased: newCh.isTextBased(),
  myPermissions: newCh.myPermissions,
});
show(
  'client.channels.cache (nomes)',
  [...client.channels.cache.values()].map((c) => c.name),
);
const memberRemoveP = once(client, Events.GuildMemberRemove);
await req('DELETE', `/servers/${server.id}/members/${bruno.user.id}`, A);
const [gone] = await memberRemoveP;
show('evento guildMemberRemove (GuildMember)', { id: gone.id, displayName: gone.displayName });

const guildDeleteP = once(client, Events.GuildDelete);
await req('DELETE', `/servers/${server.id}/bots/${bot.id}`, A);
const [g] = await guildDeleteP;
show('bot removido do servidor → evento guildDelete (Guild)', {
  id: g.id,
  name: g.name,
  cacheAgora: client.guilds.cache.size,
});

client.destroy();
show('client.destroy()', { isReady: client.isReady(), uptime: client.uptime });
process.exit(0);
