/**
 * Tíquete — atendimento por tickets: um painel com botão abre um canal privado entre a pessoa e a equipe; botão
 * de fechar apaga o canal.
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
import type { BotContext, BotDefinition } from '../shared.js';

const NS = 'tiquete';
const COLOR = '#14b8a6';
interface Settings {
  staffRoleId: string | null;
  categoryId: string | null;
}
const VIEW = Number(PermissionsBitField.Flags.ViewChannel);
const SEND = Number(PermissionsBitField.Flags.SendMessages);
const HISTORY = Number(PermissionsBitField.Flags.ReadMessageHistory);

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'pessoa';

export const tiquete: BotDefinition = {
  key: 'TIQUETE',
  name: 'Tíquete',
  description: 'Tickets: canal privado entre a pessoa e a equipe, com botão para abrir e fechar.',
  activity: 'atendendo tickets',
  async start(ctx) {
    const { client, store } = ctx;
    const settings = (guild: string) => store.get<Settings>(NS, guild, { staffRoleId: null, categoryId: null });

    client.once(Events.ClientReady, async (c) => {
      await c.application.commands.set([
        new SlashCommandBuilder()
          .setName('ticket')
          .setDescription('Tickets de atendimento')
          .addSubcommand((s) =>
            s
              .setName('painel')
              .setDescription('Publicar o painel com o botão "Abrir ticket" neste canal')
              .addStringOption((o) => o.setName('texto').setDescription('Texto do painel').setMaxLength(300)),
          )
          .addSubcommand((s) =>
            s
              .setName('equipe')
              .setDescription('Cargo que atende os tickets')
              .addRoleOption((o) => o.setName('cargo').setDescription('Cargo').setRequired(true)),
          )
          .addSubcommand((s) =>
            s
              .setName('categoria')
              .setDescription('Categoria onde os tickets são criados')
              .addStringOption((o) => o.setName('nome').setDescription('Nome da categoria (vazio = sem)')),
          )
          .addSubcommand((s) => s.setName('fechar').setDescription('Fechar este ticket'))
          .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
      ]);
      ctx.log(`pronto em ${c.guilds.cache.size} servidor(es)`);
    });

    client.on(Events.InteractionCreate, async (i) => {
      try {
        if (i.isButton() && i.customId === 'ticket:abrir') return await open(ctx, i, settings(i.guildId));
        if (i.isButton() && i.customId === 'ticket:fechar') return await close(ctx, i);
        if (!i.isChatInputCommand() || i.commandName !== 'ticket') return;
        const sub = i.options.getSubcommand();
        if (sub === 'painel') {
          await i.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Precisa de ajuda?')
                .setDescription(
                  i.options.getString('texto') ?? 'Toque no botão e um canal só seu com a equipe será criado.',
                ),
            ],
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                  .setCustomId('ticket:abrir')
                  .setLabel('Abrir ticket')
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji('🎫'),
              ),
            ],
          });
          return await i.reply({ content: 'Painel publicado.', ephemeral: true });
        }
        if (sub === 'equipe') {
          const role = i.options.getRole('cargo', true);
          store.set(NS, i.guildId, { ...settings(i.guildId), staffRoleId: role.id });
          return await i.reply({ content: `Equipe: **${role.name}**.`, ephemeral: true });
        }
        if (sub === 'categoria') {
          const name = i.options.getString('nome')?.trim();
          let categoryId: string | null = null;
          if (name && i.guild) {
            const existing = [...i.guild.categories.cache.values()].find(
              (c) => c.name.toLowerCase() === name.toLowerCase(),
            );
            categoryId = (existing ?? (await i.guild.categories.create(name))).id;
          }
          store.set(NS, i.guildId, { ...settings(i.guildId), categoryId });
          return await i.reply({
            content: categoryId ? `Tickets na categoria **${name}**.` : 'Tickets sem categoria.',
            ephemeral: true,
          });
        }
        if (sub === 'fechar') return await close(ctx, i);
      } catch (e) {
        ctx.log(`falha na interação: ${e instanceof Error ? e.message : String(e)}`);
        if (i.isRepliable())
          await i.reply({ content: 'Deu ruim aqui. Tenta de novo.', ephemeral: true }).catch(() => undefined);
      }
    });
  },
};

async function open(ctx: BotContext, i: ButtonInteraction, s: Settings) {
  const guild = i.guild;
  if (!guild) return;
  const existing = ctx.store.db
    .prepare('SELECT channel FROM tickets WHERE guild = ? AND user = ?')
    .get(guild.id, i.user.id) as { channel: string } | undefined;
  if (existing && guild.channels.cache.get(existing.channel))
    return i.reply({ content: `Você já tem um ticket aberto: <#${existing.channel}>.`, ephemeral: true });
  const everyone = [...guild.roles.cache.values()].find((r) => r.isEveryone);
  const created = await guild.channels.create({
    name: `ticket-${slugify(i.user.displayName)}`,
    parent: s.categoryId,
    topic: `Ticket de ${i.user.displayName}`,
  });
  if (!('send' in created)) return i.reply({ content: 'Não consegui criar o canal do ticket.', ephemeral: true });
  const channel = created;
  const botId = ctx.client.user?.id;
  const overrides = [
    ...(everyone ? [{ subjectType: 'role' as const, subjectId: everyone.id, allow: 0, deny: VIEW }] : []),
    { subjectType: 'member' as const, subjectId: i.user.id, allow: VIEW | SEND | HISTORY, deny: 0 },
    ...(botId ? [{ subjectType: 'member' as const, subjectId: botId, allow: VIEW | SEND | HISTORY, deny: 0 }] : []),
    ...(s.staffRoleId
      ? [{ subjectType: 'role' as const, subjectId: s.staffRoleId, allow: VIEW | SEND | HISTORY, deny: 0 }]
      : []),
  ];
  await guild.channels.edit(channel, { overrides });
  ctx.store.db
    .prepare(
      'INSERT INTO tickets (channel, guild, user, opened_at) VALUES (?, ?, ?, ?) ON CONFLICT (channel) DO NOTHING',
    )
    .run(channel.id, guild.id, i.user.id, Date.now());
  await channel.send({
    content: `<@${i.user.id}>${s.staffRoleId ? ` <@&${s.staffRoleId}>` : ''}`,
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('Ticket aberto')
        .setDescription('Conte o que precisa. Quando resolver, feche aqui embaixo.'),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket:fechar')
          .setLabel('Fechar ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒'),
      ),
    ],
  });
  await i.reply({ content: `Ticket criado: <#${channel.id}>`, ephemeral: true });
}

async function close(ctx: BotContext, i: ButtonInteraction | ChatInputCommandInteraction) {
  const row = ctx.store.db.prepare('SELECT user FROM tickets WHERE channel = ?').get(i.channelId) as
    { user: string } | undefined;
  if (!row) return i.reply({ content: 'Este canal não é um ticket.', ephemeral: true });
  const staff = i.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels) ?? false;
  if (row.user !== i.user.id && !staff)
    return i.reply({ content: 'Só quem abriu ou a equipe fecha o ticket.', ephemeral: true });
  await i.reply({ content: 'Fechando o ticket em 5 segundos…' });
  ctx.store.db.prepare('DELETE FROM tickets WHERE channel = ?').run(i.channelId);
  setTimeout(() => void i.channel.delete().catch(() => undefined), 5000);
}
