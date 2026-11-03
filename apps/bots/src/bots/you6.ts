/**
 * YOU6 — níveis e boas-vindas (o que a turma conhece dos bots de XP): ganha XP por mensagem (com intervalo), sobe de
 * nível, ranking do servidor, cargo de recompensa por nível e mensagem de boas-vindas configurável.
 */
import {
  EmbedBuilder,
  Events,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from '@opencord-chat/bot';
import { fmt, type BotContext, type BotDefinition, reply } from '../shared.js';

const NS = 'you6';
const COOLDOWN_MS = 60_000;
const COLOR = '#f5a524';

interface Settings {
  announceChannelId: string | null;
  rewards: { level: number; roleId: string }[];
  welcome: { channelId: string; text: string } | null;
}
const DEFAULTS: Settings = { announceChannelId: null, rewards: [], welcome: null };

/** XP necessário para sair do nível `level` */
export const xpToNext = (level: number) => 100 + level * level * 50;
/** nível para um total de XP (curva crescente: 100, 250, 450, 700…) */
export function levelFor(totalXp: number): { level: number; into: number; need: number } {
  let level = 0;
  let rest = totalXp;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: xpToNext(level) };
}
export const gainFor = (rnd = Math.random) => 15 + Math.floor(rnd() * 11);

export const you6: BotDefinition = {
  key: 'YOU6',
  name: 'YOU6',
  description: 'Níveis, XP, ranking, cargos por nível e boas-vindas.',
  activity: 'contando XP',
  async start(ctx) {
    const { client, store } = ctx;
    const settings = (guild: string) => store.get<Settings>(NS, guild, DEFAULTS);
    const save = (guild: string, s: Settings) => store.set(NS, guild, s);

    client.once(Events.ClientReady, async (c) => {
      await c.application.commands.set([
        new SlashCommandBuilder()
          .setName('nivel')
          .setDescription('Seu nível e XP (ou de alguém)')
          .addUserOption((o) => o.setName('pessoa').setDescription('Quem ver')),
        new SlashCommandBuilder().setName('ranking').setDescription('Top 10 do servidor em XP'),
        new SlashCommandBuilder()
          .setName('niveis')
          .setDescription('Configurar o YOU6 (quem gerencia o servidor)')
          .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
          .addSubcommand((s) =>
            s
              .setName('canal')
              .setDescription('Canal dos avisos de nível (vazio = no próprio canal)')
              .addChannelOption((o) => o.setName('canal').setDescription('Canal')),
          )
          .addSubcommand((s) =>
            s
              .setName('recompensa')
              .setDescription('Dar um cargo ao chegar num nível')
              .addIntegerOption((o) => o.setName('nivel').setDescription('Nível').setRequired(true).setMinValue(1))
              .addRoleOption((o) => o.setName('cargo').setDescription('Cargo').setRequired(true)),
          )
          .addSubcommand((s) =>
            s
              .setName('remover')
              .setDescription('Tirar a recompensa de um nível')
              .addIntegerOption((o) => o.setName('nivel').setDescription('Nível').setRequired(true).setMinValue(1)),
          )
          .addSubcommand((s) => s.setName('listar').setDescription('Recompensas e canal configurados'))
          .addSubcommand((s) =>
            s
              .setName('boasvindas')
              .setDescription('Mensagem para quem entra ({pessoa}, {servidor}, {membros})')
              .addChannelOption((o) => o.setName('canal').setDescription('Canal').setRequired(true))
              .addStringOption((o) => o.setName('texto').setDescription('Texto').setRequired(true).setMaxLength(500)),
          )
          .addSubcommand((s) => s.setName('semboasvindas').setDescription('Desligar as boas-vindas')),
      ]);
      ctx.log(`pronto em ${c.guilds.cache.size} servidor(es)`);
    });

    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot || message.conversationId) return;
      const guild = message.guild;
      if (!guild) return;
      const now = Date.now();
      const row = store.db
        .prepare('SELECT xp, last_at FROM xp WHERE guild = ? AND user = ?')
        .get(guild.id, message.author.id) as { xp: number; last_at: number } | undefined;
      if (row && now - row.last_at < COOLDOWN_MS) return;
      const before = levelFor(row?.xp ?? 0).level;
      const total = (row?.xp ?? 0) + gainFor();
      store.db
        .prepare(
          'INSERT INTO xp (guild, user, xp, last_at) VALUES (?, ?, ?, ?) ON CONFLICT (guild, user) DO UPDATE SET xp = excluded.xp, last_at = excluded.last_at',
        )
        .run(guild.id, message.author.id, total, now);
      const after = levelFor(total).level;
      if (after <= before) return;
      const s = settings(guild.id);
      const reward = s.rewards.find((r) => r.level === after);
      let extra = '';
      if (reward) {
        const member = await guild.members.fetch(message.author.id).catch(() => null);
        if (member && !member.roleIds.includes(reward.roleId)) {
          await member.roles.set([...member.roleIds, reward.roleId]).catch(() => undefined);
          const role = guild.roles.cache.get(reward.roleId);
          extra = ` e ganhou o cargo **${role?.name ?? 'novo'}**`;
        }
      }
      const target = (s.announceChannelId && guild.channels.cache.get(s.announceChannelId)) || message.channel;
      await target.send(`🎉 <@${message.author.id}> subiu para o **nível ${after}**${extra}!`).catch(() => undefined);
    });

    client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
      const s = settings(member.guild.id);
      if (!s.welcome) return;
      const ch = member.guild.channels.cache.get(s.welcome.channelId);
      if (!ch) return;
      const text = s.welcome.text
        .replaceAll('{pessoa}', `<@${member.id}>`)
        .replaceAll('{servidor}', member.guild.name)
        .replaceAll('{membros}', String(member.guild.members.cache.size));
      await ch.send(text).catch(() => undefined);
    });

    client.on(Events.InteractionCreate, async (i) => {
      if (!i.isChatInputCommand()) return;
      try {
        if (i.commandName === 'nivel') return await showLevel(i, ctx);
        if (i.commandName === 'ranking') return await showRanking(i, ctx);
        if (i.commandName === 'niveis') return await configure(i, settings(i.guildId), (s) => save(i.guildId, s));
      } catch (e) {
        ctx.log(`falha em /${i.commandName}: ${e instanceof Error ? e.message : String(e)}`);
        await reply(i, { content: 'Deu ruim aqui. Tenta de novo.', ephemeral: true }).catch(() => undefined);
      }
    });
  },
};

async function showLevel(i: ChatInputCommandInteraction, ctx: BotContext) {
  const who = i.options.getUser('pessoa') ?? i.user;
  const row = ctx.store.db.prepare('SELECT xp FROM xp WHERE guild = ? AND user = ?').get(i.guildId, who.id) as
    { xp: number } | undefined;
  const total = row?.xp ?? 0;
  const { level, into, need } = levelFor(total);
  const rank = (
    ctx.store.db.prepare('SELECT COUNT(*) AS n FROM xp WHERE guild = ? AND xp > ?').get(i.guildId, total) as {
      n: number;
    }
  ).n;
  const bar = '█'.repeat(Math.round((into / need) * 12)).padEnd(12, '░');
  await reply(i, {
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setAuthor({ name: who.displayName })
        .setTitle(`Nível ${level}`)
        .setDescription(`${bar} ${fmt.format(into)} / ${fmt.format(need)} XP`)
        .addFields(
          { name: 'XP total', value: fmt.format(total), inline: true },
          { name: 'Posição', value: `#${rank + 1}`, inline: true },
        ),
    ],
  });
}

async function showRanking(i: ChatInputCommandInteraction, ctx: BotContext) {
  const rows = ctx.store.db
    .prepare('SELECT user, xp FROM xp WHERE guild = ? ORDER BY xp DESC LIMIT 10')
    .all(i.guildId) as { user: string; xp: number }[];
  if (!rows.length) return reply(i, { content: 'Ninguém pontuou ainda. Conversem!', ephemeral: true });
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map(
    (r, idx) =>
      `${medals[idx] ?? `**${idx + 1}.**`} <@${r.user}> — nível ${levelFor(r.xp).level} · ${fmt.format(r.xp)} XP`,
  );
  await reply(i, {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Ranking de XP').setDescription(lines.join('\n'))],
  });
}

async function configure(i: ChatInputCommandInteraction, s: Settings, save: (s: Settings) => void) {
  const sub = i.options.getSubcommand();
  if (sub === 'canal') {
    const ch = i.options.getChannel('canal');
    s.announceChannelId = ch?.id ?? null;
    save(s);
    return reply(i, {
      content: ch ? `Avisos de nível em <#${ch.id}>.` : 'Avisos de nível no próprio canal.',
      ephemeral: true,
    });
  }
  if (sub === 'recompensa') {
    const level = i.options.getInteger('nivel', true);
    const role = i.options.getRole('cargo', true);
    s.rewards = [...s.rewards.filter((r) => r.level !== level), { level, roleId: role.id }].sort(
      (a, b) => a.level - b.level,
    );
    save(s);
    return reply(i, { content: `Nível ${level} dá o cargo **${role.name}**.`, ephemeral: true });
  }
  if (sub === 'remover') {
    const level = i.options.getInteger('nivel', true);
    s.rewards = s.rewards.filter((r) => r.level !== level);
    save(s);
    return reply(i, { content: `Nível ${level} sem recompensa.`, ephemeral: true });
  }
  if (sub === 'boasvindas') {
    const ch = i.options.getChannel('canal', true);
    s.welcome = { channelId: ch.id, text: i.options.getString('texto', true) };
    save(s);
    return reply(i, { content: `Boas-vindas em <#${ch.id}>.`, ephemeral: true });
  }
  if (sub === 'semboasvindas') {
    s.welcome = null;
    save(s);
    return reply(i, { content: 'Boas-vindas desligadas.', ephemeral: true });
  }
  const rewards = s.rewards.length
    ? s.rewards.map((r) => `nível ${r.level} → <@&${r.roleId}>`).join('\n')
    : 'nenhuma recompensa';
  return reply(i, {
    content: `Avisos: ${s.announceChannelId ? `<#${s.announceChannelId}>` : 'no próprio canal'}\nBoas-vindas: ${
      s.welcome ? `<#${s.welcome.channelId}>` : 'desligadas'
    }\n${rewards}`,
    ephemeral: true,
  });
}
