// Bot de exemplo: responde "pong" a `!ping`; registra /ola (com autocompletar), /sugerir (abre um modal) e o comando
// de contexto "Perfil"; mostra um botão e um menu num embed. Rode com OPENCORD_URL e OPENCORD_TOKEN no ambiente.
import {
  ActionRowBuilder,
  ApplicationCommandType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from '@opencord-chat/bot';

if (!process.env.OPENCORD_TOKEN || !process.env.OPENCORD_URL) {
  console.error('defina OPENCORD_URL (ex.: https://api.seu-opencord.dev) e OPENCORD_TOKEN (token do bot, ocb_…)');
  process.exit(1);
}

const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda'];

// intents são aceitos e ignorados: o bot recebe os eventos dos servidores em que é membro
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once(Events.ClientReady, async (c) => {
  console.warn(`conectado como ${c.user.tag} em ${c.guilds.cache.size} servidor(es)`);
  await c.application.commands.set([
    new SlashCommandBuilder()
      .setName('ola')
      .setDescription('Cumprimenta alguém')
      .addStringOption((o) =>
        o.setName('nome').setDescription('Quem cumprimentar').setRequired(true).setAutocomplete(true),
      ),
    new SlashCommandBuilder().setName('sugerir').setDescription('Sugere um livro (abre um formulário)'),
    new ContextMenuCommandBuilder().setName('Perfil').setType(ApplicationCommandType.User),
  ]);
  await c.user.setActivity('Organizando leituras');
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') await message.reply('pong');
});

client.on(Events.InteractionCreate, async (interaction) => {
  // autocompletar: sugestões enquanto a pessoa digita a opção `nome`
  if (interaction.isAutocomplete()) {
    const typed = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      NOMES.filter((n) => n.toLowerCase().startsWith(typed)).map((n) => ({ name: n, value: n })),
    );
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'ola') {
    const nome = interaction.options.getString('nome', true);
    const embed = new EmbedBuilder()
      .setTitle(`Olá, ${nome}!`)
      .setDescription('Escolha como continuar.')
      .setColor('Blurple');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tchau').setLabel('Tchau').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('mais').setLabel('Mais').setStyle(ButtonStyle.Primary),
    );
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('humor')
        .setPlaceholder('Como você está?')
        .addOptions({ label: 'Bem', value: 'bem', emoji: '😀' }, { label: 'Mais ou menos', value: 'meh', emoji: '😐' }),
    );
    const response = await interaction.reply({ embeds: [embed], components: [row, menu], ephemeral: true });
    // coleta os cliques nesse cartão (efêmero ou não) por 60 s
    const collector = response.createMessageComponentCollector({ time: 60_000 });
    collector.on('collect', async (click) => {
      if (click.isButton())
        await click.update({
          content: click.customId === 'mais' ? 'Mais o quê?' : 'Até logo!',
          embeds: [],
          components: [],
        });
      else if (click.isStringSelectMenu())
        await click.update({ content: `Você está ${click.values[0]}.`, components: [] });
    });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'sugerir') {
    const modal = new ModalBuilder()
      .setCustomId('sugestao')
      .setTitle('Sugerir um livro')
      .addComponents(
        new TextInputBuilder().setCustomId('titulo').setLabel('Título').setStyle(TextInputStyle.Short).setMaxLength(80),
        new TextInputBuilder()
          .setCustomId('motivo')
          .setLabel('Por que ler?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false),
      );
    await interaction.showModal(modal);
    try {
      const submit = await interaction.awaitModalSubmit({ time: 5 * 60_000 });
      const titulo = submit.fields.getTextInputValue('titulo');
      await submit.reply({ content: `Sugestão anotada: **${titulo}**`, ephemeral: true });
    } catch {
      // ninguém enviou o formulário em 5 min
    }
    return;
  }

  if (interaction.isUserContextMenuCommand() && interaction.commandName === 'Perfil') {
    const m = interaction.targetMember;
    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setTitle(interaction.targetUser.displayName)
          .addFields(
            { name: 'Usuário', value: interaction.targetUser.username, inline: true },
            {
              name: 'Cargos',
              value: m ? [...m.roles.cache.values()].map((r) => r.name).join(', ') || 'nenhum' : '?',
              inline: true,
            },
          ),
      ],
    });
  }
});

client.on(Events.RateLimited, (info) =>
  console.warn(`limite de requisições em ${info.route}: esperando ${info.retryAfterMs} ms`),
);
client.on(Events.Error, (err) => console.error('erro:', err.message));

await client.login();
