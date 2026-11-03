/**
 * Carlos — utilidades da turma: tags (respostas prontas), lembretes, sorteios com botão, escolher e dado.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  PermissionsBitField,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from '@opencord-chat/bot';
import { randomUUID } from 'node:crypto';
import { formatDuration, parseDuration, pickRandom, type BotContext, type BotDefinition, reply } from '../shared.js';

const COLOR = '#8b5cf6';

interface GiveawayRow {
  id: string;
  guild: string;
  channel: string;
  message: string;
  prize: string;
  winners: number;
  ends_at: number;
  host: string;
  ended: number;
  entrants: string;
  won: string;
}

export const carlos: BotDefinition = {
  key: 'CARLOS',
  name: 'Carlos',
  description: 'Tags, lembretes, sorteios com botão, escolher e dado.',
  activity: 'anotando tudo',
  async start(ctx) {
    const { client, store } = ctx;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const scheduleGiveaway = (g: GiveawayRow) => {
      const delay = Math.max(0, g.ends_at - Date.now());
      const t = setTimeout(() => void endGiveaway(ctx, g.id), Math.min(delay, 2 ** 31 - 1));
      timers.set(g.id, t);
    };

    client.once(Events.ClientReady, async (c) => {
      await c.application.commands.set([
        new SlashCommandBuilder()
          .setName('tag')
          .setDescription('Respostas prontas do servidor')
          .addSubcommand((s) =>
            s
              .setName('ver')
              .setDescription('Mostrar uma tag')
              .addStringOption((o) => o.setName('nome').setDescription('Nome').setRequired(true).setAutocomplete(true)),
          )
          .addSubcommand((s) =>
            s
              .setName('criar')
              .setDescription('Criar ou atualizar uma tag')
              .addStringOption((o) => o.setName('nome').setDescription('Nome').setRequired(true).setMaxLength(32))
              .addStringOption((o) =>
                o.setName('texto').setDescription('Conteúdo').setRequired(true).setMaxLength(1500),
              ),
          )
          .addSubcommand((s) =>
            s
              .setName('apagar')
              .setDescription('Apagar uma tag')
              .addStringOption((o) => o.setName('nome').setDescription('Nome').setRequired(true).setAutocomplete(true)),
          )
          .addSubcommand((s) => s.setName('listar').setDescription('Todas as tags')),
        new SlashCommandBuilder()
          .setName('lembrar')
          .setDescription('Me avise daqui a um tempo')
          .addStringOption((o) => o.setName('quando').setDescription('Ex.: 10m, 2h, 1d').setRequired(true))
          .addStringOption((o) => o.setName('texto').setDescription('Do quê').setRequired(true).setMaxLength(300)),
        new SlashCommandBuilder()
          .setName('sorteio')
          .setDescription('Sorteios com botão de participar')
          .addSubcommand((s) =>
            s
              .setName('criar')
              .setDescription('Começar um sorteio')
              .addStringOption((o) => o.setName('premio').setDescription('Prêmio').setRequired(true).setMaxLength(100))
              .addStringOption((o) => o.setName('duracao').setDescription('Ex.: 30m, 2h, 1d').setRequired(true))
              .addIntegerOption((o) =>
                o.setName('vencedores').setDescription('Quantos').setMinValue(1).setMaxValue(20),
              ),
          )
          .addSubcommand((s) =>
            s
              .setName('encerrar')
              .setDescription('Encerrar agora')
              .addStringOption((o) => o.setName('id').setDescription('Id do sorteio').setRequired(true)),
          )
          .addSubcommand((s) =>
            s
              .setName('resortear')
              .setDescription('Sortear de novo')
              .addStringOption((o) => o.setName('id').setDescription('Id do sorteio').setRequired(true)),
          ),
        new SlashCommandBuilder()
          .setName('escolher')
          .setDescription('Escolhe uma opção por você')
          .addStringOption((o) => o.setName('opcoes').setDescription('Separe por vírgula').setRequired(true)),
        new SlashCommandBuilder()
          .setName('dado')
          .setDescription('Rola um dado')
          .addIntegerOption((o) =>
            o.setName('lados').setDescription('Lados (padrão 6)').setMinValue(2).setMaxValue(1000),
          ),
        new SlashCommandBuilder().setName('sortear').setDescription('Sorteia um membro do servidor'),
      ]);
      // sorteios e lembretes pendentes voltam depois de reiniciar
      for (const g of store.db.prepare('SELECT * FROM giveaways WHERE ended = 0').all() as unknown as GiveawayRow[])
        scheduleGiveaway(g);
      for (const r of store.db.prepare('SELECT id, user, channel, text, at FROM reminders WHERE done = 0').all() as {
        id: number;
        user: string;
        channel: string;
        text: string;
        at: number;
      }[])
        scheduleReminder(ctx, r);
      ctx.log(`pronto em ${c.guilds.cache.size} servidor(es)`);
    });

    client.on(Events.InteractionCreate, async (i) => {
      try {
        if (i.isAutocomplete()) {
          const typed = String(i.options.getFocused()).toLowerCase();
          const rows = store.db
            .prepare('SELECT name FROM tags WHERE guild = ? AND name LIKE ? ORDER BY name LIMIT 20')
            .all(i.guildId, `${typed}%`) as { name: string }[];
          return await i.respond(rows.map((r) => r.name));
        }
        if (i.isButton() && i.customId.startsWith('sorteio:')) return await joinGiveaway(ctx, i);
        if (!i.isChatInputCommand()) return;
        if (i.commandName === 'tag') return await tags(i, ctx);
        if (i.commandName === 'lembrar') return await remind(i, ctx);
        if (i.commandName === 'sorteio') return await giveaway(i, ctx, scheduleGiveaway);
        if (i.commandName === 'escolher') {
          const opts = i.options
            .getString('opcoes', true)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          if (opts.length < 2)
            return await reply(i, { content: 'Me dê pelo menos duas opções separadas por vírgula.', ephemeral: true });
          return await reply(i, `🎯 **${pickRandom(opts, 1)[0]}**`);
        }
        if (i.commandName === 'dado') {
          const sides = i.options.getInteger('lados') ?? 6;
          return await reply(i, `🎲 d${sides}: **${1 + Math.floor(Math.random() * sides)}**`);
        }
        if (i.commandName === 'sortear') {
          const members = [...(i.guild?.members.cache.values() ?? [])].filter((m) => !m.user.bot);
          const pick = pickRandom(members, 1)[0];
          return await reply(i, pick ? `🎉 Sorteado: <@${pick.id}>` : 'Ninguém para sortear.');
        }
      } catch (e) {
        ctx.log(`falha na interação: ${e instanceof Error ? e.message : String(e)}`);
        if (i.isRepliable())
          await reply(i, { content: 'Deu ruim aqui. Tenta de novo.', ephemeral: true }).catch(() => undefined);
      }
    });
  },
};

async function tags(i: ChatInputCommandInteraction, ctx: BotContext) {
  const sub = i.options.getSubcommand();
  const db = ctx.store.db;
  if (sub === 'ver') {
    const name = i.options.getString('nome', true).toLowerCase();
    const row = db.prepare('SELECT content FROM tags WHERE guild = ? AND name = ?').get(i.guildId, name) as
      { content: string } | undefined;
    return reply(i, row ? row.content : { content: `Não existe a tag "${name}".`, ephemeral: true });
  }
  if (sub === 'criar') {
    if (!i.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages))
      return reply(i, { content: 'Só quem gerencia mensagens cria tags.', ephemeral: true });
    const name = i.options.getString('nome', true).toLowerCase().replace(/\s+/g, '-');
    db.prepare(
      'INSERT INTO tags (guild, name, content, by_user) VALUES (?, ?, ?, ?) ON CONFLICT (guild, name) DO UPDATE SET content = excluded.content, by_user = excluded.by_user',
    ).run(i.guildId, name, i.options.getString('texto', true), i.user.id);
    return reply(i, { content: `Tag "${name}" salva. Use /tag ver ${name}.`, ephemeral: true });
  }
  if (sub === 'apagar') {
    if (!i.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages))
      return reply(i, { content: 'Só quem gerencia mensagens apaga tags.', ephemeral: true });
    const name = i.options.getString('nome', true).toLowerCase();
    db.prepare('DELETE FROM tags WHERE guild = ? AND name = ?').run(i.guildId, name);
    return reply(i, { content: `Tag "${name}" apagada.`, ephemeral: true });
  }
  const rows = db.prepare('SELECT name FROM tags WHERE guild = ? ORDER BY name').all(i.guildId) as { name: string }[];
  return reply(i, {
    content: rows.length ? rows.map((r) => `\`${r.name}\``).join(', ') : 'Nenhuma tag ainda. Crie com /tag criar.',
    ephemeral: true,
  });
}

function scheduleReminder(ctx: BotContext, r: { id: number; user: string; channel: string; text: string; at: number }) {
  const delay = Math.max(0, r.at - Date.now());
  setTimeout(
    async () => {
      ctx.store.db.prepare('UPDATE reminders SET done = 1 WHERE id = ?').run(r.id);
      const ch = ctx.client.channels.cache.get(r.channel);
      await ch?.send(`⏰ <@${r.user}>, lembrete: ${r.text}`).catch(() => undefined);
    },
    Math.min(delay, 2 ** 31 - 1),
  );
}

async function remind(i: ChatInputCommandInteraction, ctx: BotContext) {
  const ms = parseDuration(i.options.getString('quando', true));
  if (!ms) return reply(i, { content: 'Tempo inválido. Use algo como 10m, 2h ou 1d.', ephemeral: true });
  const text = i.options.getString('texto', true);
  const at = Date.now() + ms;
  const res = ctx.store.db
    .prepare('INSERT INTO reminders (user, channel, text, at) VALUES (?, ?, ?, ?)')
    .run(i.user.id, i.channelId, text, at);
  scheduleReminder(ctx, { id: Number(res.lastInsertRowid), user: i.user.id, channel: i.channelId, text, at });
  return reply(i, { content: `Combinado: daqui a ${formatDuration(ms)} eu te lembro de "${text}".`, ephemeral: true });
}

function giveawayEmbed(g: GiveawayRow, entrants: number) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🎁 Sorteio: ${g.prize}`)
    .setDescription(
      g.ended ? 'Encerrado.' : `Toque em **Participar**. Termina em ${formatDuration(g.ends_at - Date.now())}.`,
    )
    .addFields(
      { name: 'Participantes', value: String(entrants), inline: true },
      { name: 'Vencedores', value: String(g.winners), inline: true },
      { name: 'Id', value: g.id.slice(0, 8), inline: true },
    )
    .setFooter({ text: `por ${g.host.slice(0, 8)}` });
}
const giveawayRow = (id: string, ended: boolean) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`sorteio:entrar:${id}`)
      .setLabel('Participar')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎉')
      .setDisabled(ended),
  );

function loadGiveaway(ctx: BotContext, idPrefix: string, guild: string): GiveawayRow | null {
  return (
    (ctx.store.db.prepare('SELECT * FROM giveaways WHERE guild = ? AND id LIKE ?').get(guild, `${idPrefix}%`) as
      GiveawayRow | undefined) ?? null
  );
}

async function giveaway(i: ChatInputCommandInteraction, ctx: BotContext, schedule: (g: GiveawayRow) => void) {
  const sub = i.options.getSubcommand();
  if (sub === 'criar') {
    const ms = parseDuration(i.options.getString('duracao', true));
    if (!ms) return reply(i, { content: 'Duração inválida. Use algo como 30m, 2h ou 1d.', ephemeral: true });
    const g: GiveawayRow = {
      id: randomUUID(),
      guild: i.guildId,
      channel: i.channelId,
      message: '',
      prize: i.options.getString('premio', true),
      winners: i.options.getInteger('vencedores') ?? 1,
      ends_at: Date.now() + ms,
      host: i.user.id,
      ended: 0,
      entrants: '[]',
      won: '[]',
    };
    const res = await reply(i, { embeds: [giveawayEmbed(g, 0)], components: [giveawayRow(g.id, false)] });
    g.message = res.messageId ?? '';
    ctx.store.db
      .prepare(
        'INSERT INTO giveaways (id, guild, channel, message, prize, winners, ends_at, host) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(g.id, g.guild, g.channel, g.message, g.prize, g.winners, g.ends_at, g.host);
    schedule(g);
    return;
  }
  const g = loadGiveaway(ctx, i.options.getString('id', true), i.guildId);
  if (!g) return reply(i, { content: 'Sorteio não encontrado.', ephemeral: true });
  if (g.host !== i.user.id && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild))
    return reply(i, { content: 'Só quem criou (ou gerencia o servidor) mexe nesse sorteio.', ephemeral: true });
  if (sub === 'encerrar') {
    if (g.ended) return reply(i, { content: 'Já encerrado.', ephemeral: true });
    await endGiveaway(ctx, g.id);
    return reply(i, { content: 'Encerrado.', ephemeral: true });
  }
  if (!g.ended) return reply(i, { content: 'Ainda está rolando; encerre primeiro.', ephemeral: true });
  const winners = pickRandom(JSON.parse(g.entrants) as string[], g.winners);
  ctx.store.db.prepare('UPDATE giveaways SET won = ? WHERE id = ?').run(JSON.stringify(winners), g.id);
  const ch = ctx.client.channels.cache.get(g.channel);
  await ch
    ?.send(
      winners.length
        ? `🎉 Novo sorteio de **${g.prize}**: ${winners.map((w) => `<@${w}>`).join(', ')}`
        : 'Ninguém participou.',
    )
    .catch(() => undefined);
  return reply(i, { content: 'Resorteado.', ephemeral: true });
}

async function joinGiveaway(ctx: BotContext, i: ButtonInteraction) {
  const id = i.customId.split(':')[2] ?? '';
  const g = ctx.store.db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) as GiveawayRow | undefined;
  if (!g || g.ended) return reply(i, { content: 'Esse sorteio já acabou.', ephemeral: true });
  const entrants = new Set(JSON.parse(g.entrants) as string[]);
  const joined = !entrants.has(i.user.id);
  if (joined) entrants.add(i.user.id);
  else entrants.delete(i.user.id);
  ctx.store.db.prepare('UPDATE giveaways SET entrants = ? WHERE id = ?').run(JSON.stringify([...entrants]), g.id);
  await i.update({ embeds: [giveawayEmbed(g, entrants.size)], components: [giveawayRow(g.id, false)] });
  await i
    .followUp({ content: joined ? 'Você está participando. Boa sorte!' : 'Você saiu do sorteio.', ephemeral: true })
    .catch(() => undefined);
}

async function endGiveaway(ctx: BotContext, id: string) {
  const g = ctx.store.db.prepare('SELECT * FROM giveaways WHERE id = ? AND ended = 0').get(id) as
    GiveawayRow | undefined;
  if (!g) return;
  const entrants = JSON.parse(g.entrants) as string[];
  const winners = pickRandom(entrants, g.winners);
  ctx.store.db.prepare('UPDATE giveaways SET ended = 1, won = ? WHERE id = ?').run(JSON.stringify(winners), id);
  const ch = ctx.client.channels.cache.get(g.channel);
  if (!ch) return;
  const ended = { ...g, ended: 1 };
  await ch.messages
    .edit(g.message, { embeds: [giveawayEmbed(ended, entrants.length)], components: [giveawayRow(g.id, true)] })
    .catch(() => undefined);
  await ch
    .send(
      winners.length
        ? `🎉 Sorteio de **${g.prize}** encerrado! Ganhou: ${winners.map((w) => `<@${w}>`).join(', ')}`
        : `Sorteio de **${g.prize}** encerrado sem participantes.`,
    )
    .catch(() => undefined);
}
