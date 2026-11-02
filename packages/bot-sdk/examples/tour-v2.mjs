/* eslint-disable no-console -- exemplo: imprimir os resultados é o objetivo */
// Tour da 0.2.0 (ADR-0034): embeds, botões, menus, modais, autocompletar, comandos de contexto e subcomandos,
// moderação, enquetes, presença, coletores e escala — tudo contra uma API de desenvolvimento, imprimindo os
// resultados reais que aparecem em docs/BOTS.md. Rode com OPENCORD_URL apontando para a API (entrada por apelido
// liberada). As "pessoas" são criadas pela API e os cliques/envios são simulados pelas rotas que o app usa.
import { inspect } from 'node:util';
import { io } from 'socket.io-client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  EmbedBuilder,
  Events,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from '@opencord-chat/bot';

const BASE = process.env.OPENCORD_URL ?? 'http://localhost:3000';
const tag = Date.now().toString(36).slice(-4);
const show = (label, v) =>
  console.log(
    `\n### ${label}\n${typeof v === 'string' ? v : inspect(v, { depth: 5, colors: false, breakLength: 100 })}`,
  );
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
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const once = (emitter, ev, pred = () => true, ms = 8000) =>
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
const socketOf = (token) => {
  const s = io(BASE, { path: '/realtime', auth: { token }, transports: ['websocket'] });
  return new Promise((r) => s.once('ready', () => r(s)));
};
const envelope = (s, ev, pred = () => true, ms = 8000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout ${ev}`)), ms);
    const h = (e) => {
      if (!pred(e.payload)) return;
      clearTimeout(t);
      s.off(ev, h);
      res(e.payload);
    };
    s.on(ev, h);
  });

// --- cenário: Ana (dona) cria o servidor e o bot; Bruno entra ---
const ana = await req('POST', '/auth/guest', null, { nickname: `Ana-${tag}`, deviceId: `ana-${tag}` });
const A = ana.tokens.accessToken;
const bruno = await req('POST', '/auth/guest', null, { nickname: `Bruno-${tag}`, deviceId: `bruno-${tag}` });
const B = bruno.tokens.accessToken;
const server = await req('POST', '/servers', A, { name: 'Clube do Livro' });
const geral = server.channels.find((c) => c.kind === 'text');
const invite = await req('POST', `/servers/${server.id}/invites`, A);
await req('POST', `/invites/${invite.code}`, B);
const bot = await req('POST', '/me/bots', A, {
  name: 'Bibliotecário',
  description: 'Organiza as leituras',
  public: false,
});
await req('POST', `/servers/${server.id}/bots`, A, { botId: bot.id });
// cargo de moderação para o bot (banir, castigar, gerenciar mensagens)
const modRole = await req('POST', `/servers/${server.id}/roles`, A, {
  name: 'Moderação',
  permissions:
    PermissionFlagsBits.BanMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.ManageMessages,
});
await req('PUT', `/servers/${server.id}/members/${bot.user.id}/roles`, A, { roleIds: [modRole.id] });

const client = new Client({ baseUrl: BASE });
client.on(Events.Error, (e) => console.log('[error]', e.message));
client.on(Events.RateLimited, (i) => console.log('[rateLimited]', i));
const readyP = once(client, Events.ClientReady);
await client.login(bot.token);
await readyP;
const guild = client.guilds.cache.get(server.id);
const channel = guild.channels.cache.get(geral.id);
const sA = await socketOf(A);
const sB = await socketOf(B);

// ---------- comandos v2 ----------
const cmds = await client.application.commands.set([
  new SlashCommandBuilder()
    .setName('livro')
    .setDescription('Gerencia a leitura do mês')
    .addSubcommand((s) =>
      s
        .setName('sugerir')
        .setDescription('Sugere um livro')
        .addStringOption((o) => o.setName('titulo').setDescription('Título').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('paginas').setDescription('Páginas').setMinValue(1).setMaxValue(2000)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('votacao')
        .setDescription('Votação do mês')
        .addSubcommand((s) => s.setName('abrir').setDescription('Abre a votação'))
        .addSubcommand((s) =>
          s
            .setName('fechar')
            .setDescription('Fecha a votação')
            .addRoleOption((o) => o.setName('cargo').setDescription('Cargo que decide')),
        ),
    ),
  new SlashCommandBuilder()
    .setName('limpar')
    .setDescription('Apaga mensagens recentes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('quantas').setDescription('Até 100').setRequired(true).setMinValue(1).setMaxValue(100),
    ),
  new ContextMenuCommandBuilder().setName('Reportar mensagem').setType(ApplicationCommandType.Message),
  new ContextMenuCommandBuilder().setName('Ver leituras').setType(ApplicationCommandType.User),
]);
show('commands.set com subcomandos, grupo, autocomplete, permissões e menus de contexto → BotCommand[]', cmds);

// ---------- embeds + componentes ----------
const embed = new EmbedBuilder()
  .setColor('#7c5cff')
  .setAuthor({ name: 'Clube do Livro' })
  .setTitle('Leitura do mês: Dom Casmurro')
  .setURL('https://exemplo.dev/dom-casmurro')
  .setDescription('Machado de Assis, 1899. Capítulos 1–20 até sexta.')
  .addFields({ name: 'Páginas', value: '256', inline: true }, { name: 'Meta', value: '20 cap.', inline: true })
  .setFooter({ text: 'Votação aberta até domingo' })
  .setTimestamp(new Date('2026-11-02T10:00:00-03:00'));
const row1 = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('vou-ler').setLabel('Vou ler').setStyle(ButtonStyle.Primary).setEmoji('📚'),
  new ButtonBuilder().setCustomId('passo').setLabel('Passo').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setLabel('Comprar').setStyle(ButtonStyle.Link).setURL('https://exemplo.dev/comprar'),
);
const row2 = new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder()
    .setCustomId('ritmo')
    .setPlaceholder('Seu ritmo de leitura')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Devagar').setValue('lento').setDescription('1 capítulo por dia'),
      new StringSelectMenuOptionBuilder().setLabel('Normal').setValue('normal').setDefault(true),
      new StringSelectMenuOptionBuilder().setLabel('Maratona').setValue('rapido').setEmoji('🔥'),
    ),
);
show('EmbedBuilder.toJSON()', embed.toJSON());
const announce = await channel.send({ content: 'Chegou a leitura do mês!', embeds: [embed], components: [row1, row2] });
show('channel.send({ content, embeds, components }) → Message', {
  id: announce.id,
  content: announce.content,
  embeds: announce.embeds.map((e) => e.title),
  components: announce.components.map((r) => r.components.map((c) => c.customId ?? c.url)),
});

// Bruno clica em "Vou ler" (o app manda isto ao clicar)
const clickP = once(client, Events.InteractionCreate, (i) => i.isButton());
await req('POST', '/interactions', B, { type: 'component', messageId: announce.id, customId: 'vou-ler' });
const [btn] = await clickP;
show('evento interactionCreate (ButtonInteraction)', {
  isButton: btn.isButton(),
  customId: btn.customId,
  user: btn.user.tag,
  message: btn.message?.id,
  componentType: btn.componentType,
});
const updP = envelope(sB, 'chat:message:updated', (m) => m.id === announce.id);
await btn.update({
  content: 'Chegou a leitura do mês! **1 pessoa** vai ler.',
  embeds: [embed],
  components: [row1, row2],
});
const upd = await updP;
show('interaction.update({ content, … }) → a mensagem é editada (evento chat:message:updated)', {
  content: upd.body,
  editedAt: upd.editedAt,
});

// Bruno escolhe no menu
const selP = once(client, Events.InteractionCreate, (i) => i.isStringSelectMenu());
await req('POST', '/interactions', B, {
  type: 'component',
  messageId: announce.id,
  customId: 'ritmo',
  values: ['rapido'],
});
const [sel] = await selP;
show('evento interactionCreate (StringSelectMenuInteraction)', {
  customId: sel.customId,
  values: sel.values,
  user: sel.user.tag,
});
const eph = await sel.reply({ content: `Anotado: ritmo **${sel.values[0]}**.`, ephemeral: true });
show('interaction.reply({ ephemeral: true }) → InteractionResponse', {
  messageId: eph.messageId,
  ephemeral: sel.ephemeral,
});

// ---------- modal ----------
const ctxP = once(client, Events.InteractionCreate, (i) => i.isMessageContextMenuCommand());
await req('POST', '/interactions', B, {
  type: 'message_command',
  botId: bot.id,
  command: 'Reportar mensagem',
  messageId: announce.id,
});
const [ctx] = await ctxP;
show('evento interactionCreate (MessageContextMenuCommandInteraction)', {
  commandName: ctx.commandName,
  targetMessage: ctx.targetMessage.content.slice(0, 40),
  user: ctx.user.tag,
});
const modalP = envelope(sB, 'interaction:modal');
await ctx.showModal(
  new ModalBuilder()
    .setCustomId('reporte')
    .setTitle('Reportar mensagem')
    .addComponents(
      new TextInputBuilder()
        .setCustomId('motivo')
        .setLabel('Motivo')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500),
      new TextInputBuilder()
        .setCustomId('contato')
        .setLabel('Contato (opcional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false),
    ),
);
const modalEv = await modalP;
show('interaction.showModal(modal) → a pessoa recebe interaction:modal', {
  modalId: modalEv.modalId,
  title: modalEv.modal.title,
  fields: modalEv.modal.components.map((c) => `${c.customId} (${c.style}${c.required ? ', obrigatório' : ''})`),
});
const submitP = once(client, Events.InteractionCreate, (i) => i.isModalSubmit());
await req('POST', '/interactions', B, {
  type: 'modal',
  modalId: modalEv.modalId,
  fields: { motivo: 'Spoiler no título!' },
});
const [modal] = await submitP;
show('evento interactionCreate (ModalSubmitInteraction)', {
  customId: modal.customId,
  motivo: modal.fields.getTextInputValue('motivo'),
  contato: modal.fields.getTextInputValue('contato'),
});
show('modal.reply({ ephemeral: true })', {
  messageId: (await modal.reply({ content: 'Reporte recebido. Obrigado!', ephemeral: true })).messageId,
});

// ---------- autocompletar ----------
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isAutocomplete()) return;
  const typed = i.options.getFocused(true);
  const livros = ['Dom Casmurro', 'Grande Sertão: Veredas', 'Vidas Secas', 'O Cortiço'];
  await i.respond(
    livros
      .filter((l) => l.toLowerCase().includes(String(typed.value).toLowerCase()))
      .map((l) => ({ name: l, value: l })),
  );
});
const ac = await req('POST', '/interactions', B, {
  type: 'autocomplete',
  channelId: geral.id,
  botId: bot.id,
  command: 'livro',
  subcommand: 'sugerir',
  options: { titulo: 'se' },
  focused: 'titulo',
});
show('autocompletar: a pessoa digita "se" → POST /interactions { type: "autocomplete" } → bot responde em < 3 s', ac);

// ---------- subcomando + grupo + permissão ----------
const subP = once(client, Events.InteractionCreate, (i) => i.isChatInputCommand());
await req('POST', '/interactions', B, {
  type: 'command',
  channelId: geral.id,
  botId: bot.id,
  command: 'livro',
  subcommandGroup: 'votacao',
  subcommand: 'fechar',
  options: { cargo: modRole.id },
});
const [sub] = await subP;
show('comando com grupo e subcomando (ChatInputCommandInteraction)', {
  commandName: sub.commandName,
  group: sub.options.getSubcommandGroup(),
  sub: sub.options.getSubcommand(),
  cargo: sub.options.getRole('cargo')?.name,
});
await sub.reply('Votação fechada.');
try {
  await req('POST', '/interactions', B, {
    type: 'command',
    channelId: geral.id,
    botId: bot.id,
    command: 'limpar',
    options: { quantas: 5 },
  });
} catch (e) {
  show('/limpar exige MANAGE_MESSAGES (defaultMemberPermissions): Bruno recebe', e.message);
}

// ---------- enquete, digitando, presença ----------
const pollMsg = await channel.send({
  poll: {
    question: 'Próximo gênero?',
    answers: [{ text: 'Ficção' }, { text: 'Técnico' }],
    allowMultiselect: false,
    duration: 24,
  },
});
show('channel.send({ poll }) → Message.poll', {
  question: pollMsg.poll.question,
  answers: pollMsg.poll.answers.map((a) => a.text),
  endsAt: pollMsg.poll.endsAt,
});
const typingP = envelope(sA, 'chat:typing', (t) => t.userId === client.user.id);
await channel.sendTyping();
show('channel.sendTyping() → quem está no canal recebe chat:typing', await typingP);
await client.user.setPresence({ status: 'dnd', activities: [{ name: 'organizando a estante' }] });
show(
  'client.user.setPresence({ status, activities }) → presença como os outros veem',
  (await req('GET', `/servers/${server.id}/presence`, A)).find?.((p) => p.userId === client.user.id) ??
    'consulte GET /servers/:id/presence',
);

// ---------- moderação ----------
const member = await guild.members.fetch(bruno.user.id);
show('member.permissions (PermissionsBitField)', {
  bitfield: member.permissions.bitfield,
  has: member.permissions.has('SendMessages'),
  toArray: member.permissions.toArray().slice(0, 4),
});
await member.timeout(60_000, 'spoiler');
const after = await guild.members.fetch(bruno.user.id);
show('member.timeout(60_000) → communicationDisabledUntil', {
  until: after.communicationDisabledUntil,
  disabled: after.isCommunicationDisabled(),
});
try {
  await req('POST', `/channels/${geral.id}/messages`, B, { requestId: crypto.randomUUID(), body: 'posso falar?' });
} catch (e) {
  show('em castigo: Bruno tenta escrever', e.message);
}
await member.timeout(null);
const spam = [];
for (let i = 0; i < 3; i++) spam.push(await channel.send(`spam ${i + 1}`));
const deleted = await channel.bulkDelete(spam);
show('channel.bulkDelete(mensagens) → Collection', { apagadas: deleted.size });
const banP = once(client, Events.GuildBanAdd);
await guild.members.ban(bruno.user.id, { reason: 'spoilers repetidos', deleteMessageSeconds: 3600 });
const [ban] = await banP;
show('guild.members.ban(id, { reason, deleteMessageSeconds }) → evento guildBanAdd', {
  user: ban.user.tag,
  reason: ban.reason,
  executor: ban.executor?.tag,
});
try {
  await req('POST', `/invites/${invite.code}`, B);
} catch (e) {
  show('banido tenta voltar pelo convite', e.message);
}
await guild.bans.remove(bruno.user.id);
show('guild.bans.fetch() depois de remover', (await guild.bans.fetch()).size);

// ---------- coletor + escala ----------
const collector = announce.createMessageComponentCollector({ time: 3000, filter: (i) => i.customId === 'passo' });
collector.on('collect', (i) => void i.deferUpdate());
await req('POST', '/interactions', A, { type: 'component', messageId: announce.id, customId: 'passo' });
const [collected, reason] = await once(collector, 'end');
show('createMessageComponentCollector({ time: 3000 }) → end', { coletados: collected.size, motivo: reason });
show('client.rest (fila com retentativa)', {
  queued: client.rest.queued,
  ping: client.ws.ping,
  status: client.ws.status,
});
show('client.shard (sem sharding)', client.shard);

sA.disconnect();
sB.disconnect();
client.destroy();
process.exit(0);
