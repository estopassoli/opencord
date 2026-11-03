/**
 * Dínamo — moderação automática (o que a turma conhece dos bots de automod): palavras proibidas, bloqueio de
 * links, antiflood, avisos com castigo automático e canal de registro.
 */
import {
  EmbedBuilder,
  Events,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from '@opencord-chat/bot';
import { formatDuration, type BotContext, type BotDefinition, reply } from '../shared.js';

const NS = 'dinamo';
const COLOR = '#2f81f7';

export interface AutomodSettings {
  words: string[];
  blockLinks: boolean;
  flood: { max: number; windowS: number } | null;
  logChannelId: string | null;
  /** avisos até castigar e por quanto tempo (ms) */
  punish: { warnings: number; timeoutMs: number } | null;
}
export const AUTOMOD_DEFAULTS: AutomodSettings = {
  words: [],
  blockLinks: false,
  flood: { max: 6, windowS: 8 },
  logChannelId: null,
  punish: { warnings: 3, timeoutMs: 10 * 60_000 },
};

const URL_RE = /https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}/i;
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** motivo da violação ou null */
export function checkMessage(
  content: string,
  s: AutomodSettings,
  recent: number[],
  now = Date.now(),
): 'palavra proibida' | 'link' | 'flood' | null {
  const text = norm(content);
  if (s.words.some((w) => w && text.includes(norm(w)))) return 'palavra proibida';
  if (s.blockLinks && URL_RE.test(content)) return 'link';
  if (s.flood) {
    const window = now - s.flood.windowS * 1000;
    const n = recent.filter((t) => t > window).length + 1;
    if (n > s.flood.max) return 'flood';
  }
  return null;
}

export const dinamo: BotDefinition = {
  key: 'DINAMO',
  name: 'Dínamo',
  description: 'Automod: palavras proibidas, links, flood, avisos e castigo automático.',
  activity: 'de olho no chat',
  async start(ctx) {
    const { client, store } = ctx;
    const settings = (guild: string) => ({
      ...AUTOMOD_DEFAULTS,
      ...store.get<Partial<AutomodSettings>>(NS, guild, {}),
    });
    const save = (guild: string, s: AutomodSettings) => store.set(NS, guild, s);
    const recent = new Map<string, number[]>();
    const warnedNoPerm = new Set<string>();

    client.once(Events.ClientReady, async (c) => {
      await c.application.commands.set([
        new SlashCommandBuilder()
          .setName('automod')
          .setDescription('Configurar o Dínamo')
          .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
          .addSubcommandGroup((g) =>
            g
              .setName('palavras')
              .setDescription('Palavras proibidas')
              .addSubcommand((s) =>
                s
                  .setName('adicionar')
                  .setDescription('Proibir uma palavra ou trecho')
                  .addStringOption((o) =>
                    o.setName('palavra').setDescription('Palavra').setRequired(true).setMaxLength(60),
                  ),
              )
              .addSubcommand((s) =>
                s
                  .setName('remover')
                  .setDescription('Liberar uma palavra')
                  .addStringOption((o) => o.setName('palavra').setDescription('Palavra').setRequired(true)),
              )
              .addSubcommand((s) => s.setName('listar').setDescription('Ver a lista')),
          )
          .addSubcommand((s) =>
            s
              .setName('links')
              .setDescription('Bloquear links de quem não modera')
              .addBooleanOption((o) => o.setName('ligado').setDescription('Ligado?').setRequired(true)),
          )
          .addSubcommand((s) =>
            s
              .setName('flood')
              .setDescription('Limite de mensagens por janela (0 desliga)')
              .addIntegerOption((o) =>
                o.setName('maximo').setDescription('Mensagens').setRequired(true).setMinValue(0).setMaxValue(30),
              )
              .addIntegerOption((o) => o.setName('segundos').setDescription('Janela').setMinValue(2).setMaxValue(60)),
          )
          .addSubcommand((s) =>
            s
              .setName('registro')
              .setDescription('Canal onde o Dínamo registra o que fez (vazio = nenhum)')
              .addChannelOption((o) => o.setName('canal').setDescription('Canal')),
          )
          .addSubcommand((s) =>
            s
              .setName('castigo')
              .setDescription('Castigar depois de N avisos (0 desliga)')
              .addIntegerOption((o) =>
                o.setName('avisos').setDescription('Quantos avisos').setRequired(true).setMinValue(0).setMaxValue(20),
              )
              .addIntegerOption((o) =>
                o.setName('minutos').setDescription('Duração').setMinValue(1).setMaxValue(10080),
              ),
          )
          .addSubcommand((s) => s.setName('ver').setDescription('Configuração atual')),
        new SlashCommandBuilder()
          .setName('aviso')
          .setDescription('Avisos de membros')
          .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
          .addSubcommand((s) =>
            s
              .setName('dar')
              .setDescription('Dar um aviso')
              .addUserOption((o) => o.setName('pessoa').setDescription('Quem').setRequired(true))
              .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(true).setMaxLength(200)),
          )
          .addSubcommand((s) =>
            s
              .setName('listar')
              .setDescription('Avisos de alguém')
              .addUserOption((o) => o.setName('pessoa').setDescription('Quem').setRequired(true)),
          )
          .addSubcommand((s) =>
            s
              .setName('limpar')
              .setDescription('Zerar os avisos de alguém')
              .addUserOption((o) => o.setName('pessoa').setDescription('Quem').setRequired(true)),
          ),
      ]);
      ctx.log(`pronto em ${c.guilds.cache.size} servidor(es)`);
    });

    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot || message.conversationId || !message.guild) return;
      const s = settings(message.guild.id);
      const member = message.member;
      if (member?.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
      const key = `${message.guild.id}:${message.author.id}`;
      const list = recent.get(key) ?? [];
      const why = checkMessage(message.content, s, list);
      list.push(Date.now());
      recent.set(key, list.slice(-40));
      if (!why) return;
      const deleted = await message.delete().then(
        () => true,
        () => false,
      );
      if (!deleted && !warnedNoPerm.has(message.guild.id)) {
        warnedNoPerm.add(message.guild.id);
        await message.channel
          .send(
            'Dínamo viu uma violação mas não consegue apagar mensagens: dê a ele um cargo com "Gerenciar mensagens" e "Castigar membros".',
          )
          .catch(() => undefined);
      }
      await warn(ctx, message, why, s);
    });

    client.on(Events.InteractionCreate, async (i) => {
      if (!i.isChatInputCommand()) return;
      try {
        if (i.commandName === 'automod') return await configure(i, settings(i.guildId), (s) => save(i.guildId, s));
        if (i.commandName === 'aviso') return await warnings(i, ctx, settings(i.guildId));
      } catch (e) {
        ctx.log(`falha em /${i.commandName}: ${e instanceof Error ? e.message : String(e)}`);
        await reply(i, { content: 'Deu ruim aqui. Tenta de novo.', ephemeral: true }).catch(() => undefined);
      }
    });
  },
};

async function addWarning(ctx: BotContext, guild: string, user: string, by: string, reason: string): Promise<number> {
  ctx.store.db
    .prepare('INSERT INTO warnings (guild, user, by_user, reason, at) VALUES (?, ?, ?, ?, ?)')
    .run(guild, user, by, reason, Date.now());
  return (
    ctx.store.db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE guild = ? AND user = ?').get(guild, user) as {
      n: number;
    }
  ).n;
}

async function warn(ctx: BotContext, message: Message, why: string, s: AutomodSettings) {
  const guild = message.guild;
  if (!guild) return;
  const count = await addWarning(ctx, guild.id, message.author.id, ctx.client.user?.id ?? 'automod', `automod: ${why}`);
  let punished = '';
  if (s.punish && s.punish.warnings > 0 && count % s.punish.warnings === 0) {
    const member = await guild.members.fetch(message.author.id).catch(() => null);
    if (member) {
      await member.timeout(s.punish.timeoutMs, `automod: ${count} avisos`).catch(() => undefined);
      punished = ` Castigo de ${formatDuration(s.punish.timeoutMs)} aplicado.`;
    }
  }
  const notice = await message.channel
    .send(`<@${message.author.id}>, mensagem removida (${why}). Aviso ${count}.${punished}`)
    .catch(() => null);
  if (notice) setTimeout(() => void notice.delete().catch(() => undefined), 8000);
  if (s.logChannelId) {
    const log = guild.channels.cache.get(s.logChannelId);
    await log
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle(`Automod: ${why}`)
            .setDescription(message.content.slice(0, 500) || '(sem texto)')
            .addFields(
              { name: 'Pessoa', value: `<@${message.author.id}>`, inline: true },
              { name: 'Canal', value: `<#${message.channelId}>`, inline: true },
              { name: 'Avisos', value: String(count), inline: true },
            ),
        ],
      })
      .catch(() => undefined);
  }
}

async function configure(i: ChatInputCommandInteraction, s: AutomodSettings, save: (s: AutomodSettings) => void) {
  const group = i.options.getSubcommandGroup(false);
  const sub = i.options.getSubcommand();
  if (group === 'palavras') {
    if (sub === 'adicionar') {
      const w = i.options.getString('palavra', true).trim();
      if (!s.words.includes(w)) s.words.push(w);
      save(s);
      return reply(i, { content: `"${w}" proibida.`, ephemeral: true });
    }
    if (sub === 'remover') {
      const w = i.options.getString('palavra', true).trim();
      s.words = s.words.filter((x) => x !== w);
      save(s);
      return reply(i, { content: `"${w}" liberada.`, ephemeral: true });
    }
    return reply(i, {
      content: s.words.length ? s.words.map((w) => `• ${w}`).join('\n') : 'Nenhuma palavra proibida.',
      ephemeral: true,
    });
  }
  if (sub === 'links') {
    s.blockLinks = i.options.getBoolean('ligado', true);
    save(s);
    return reply(i, {
      content: s.blockLinks ? 'Links bloqueados para quem não modera.' : 'Links liberados.',
      ephemeral: true,
    });
  }
  if (sub === 'flood') {
    const max = i.options.getInteger('maximo', true);
    const windowS = i.options.getInteger('segundos') ?? s.flood?.windowS ?? 8;
    s.flood = max > 0 ? { max, windowS } : null;
    save(s);
    return reply(i, {
      content: s.flood ? `Flood: mais de ${max} mensagens em ${windowS} s apaga.` : 'Antiflood desligado.',
      ephemeral: true,
    });
  }
  if (sub === 'registro') {
    const ch = i.options.getChannel('canal');
    s.logChannelId = ch?.id ?? null;
    save(s);
    return reply(i, { content: ch ? `Registro em <#${ch.id}>.` : 'Sem canal de registro.', ephemeral: true });
  }
  if (sub === 'castigo') {
    const warnings = i.options.getInteger('avisos', true);
    const minutes = i.options.getInteger('minutos') ?? Math.round((s.punish?.timeoutMs ?? 600_000) / 60_000);
    s.punish = warnings > 0 ? { warnings, timeoutMs: minutes * 60_000 } : null;
    save(s);
    return reply(i, {
      content: s.punish ? `A cada ${warnings} avisos: castigo de ${minutes} min.` : 'Castigo automático desligado.',
      ephemeral: true,
    });
  }
  return reply(i, {
    content: [
      `Palavras proibidas: ${s.words.length}`,
      `Links: ${s.blockLinks ? 'bloqueados' : 'liberados'}`,
      `Flood: ${s.flood ? `máx. ${s.flood.max} em ${s.flood.windowS} s` : 'desligado'}`,
      `Castigo: ${s.punish ? `${s.punish.warnings} avisos → ${formatDuration(s.punish.timeoutMs)}` : 'desligado'}`,
      `Registro: ${s.logChannelId ? `<#${s.logChannelId}>` : 'nenhum'}`,
    ].join('\n'),
    ephemeral: true,
  });
}

async function warnings(i: ChatInputCommandInteraction, ctx: BotContext, s: AutomodSettings) {
  const sub = i.options.getSubcommand();
  const who = i.options.getUser('pessoa', true);
  if (sub === 'dar') {
    const reason = i.options.getString('motivo', true);
    const count = await addWarning(ctx, i.guildId, who.id, i.user.id, reason);
    let punished = '';
    if (s.punish && s.punish.warnings > 0 && count % s.punish.warnings === 0 && i.guild) {
      const member = await i.guild.members.fetch(who.id).catch(() => null);
      if (member) {
        await member.timeout(s.punish.timeoutMs, `${count} avisos`).catch(() => undefined);
        punished = ` Castigo de ${formatDuration(s.punish.timeoutMs)} aplicado.`;
      }
    }
    return reply(i, { content: `<@${who.id}> recebeu o aviso ${count}: ${reason}.${punished}` });
  }
  if (sub === 'limpar') {
    ctx.store.db.prepare('DELETE FROM warnings WHERE guild = ? AND user = ?').run(i.guildId, who.id);
    return reply(i, { content: `Avisos de <@${who.id}> zerados.`, ephemeral: true });
  }
  const rows = ctx.store.db
    .prepare('SELECT reason, at, by_user FROM warnings WHERE guild = ? AND user = ? ORDER BY at DESC LIMIT 15')
    .all(i.guildId, who.id) as { reason: string; at: number; by_user: string }[];
  if (!rows.length) return reply(i, { content: `<@${who.id}> não tem avisos.`, ephemeral: true });
  return reply(i, {
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`Avisos de ${who.displayName} (${rows.length})`)
        .setDescription(
          rows
            .map((r) => `• ${new Date(r.at).toLocaleDateString('pt-BR')} — ${r.reason} (por <@${r.by_user}>)`)
            .join('\n'),
        ),
    ],
    ephemeral: true,
  });
}
