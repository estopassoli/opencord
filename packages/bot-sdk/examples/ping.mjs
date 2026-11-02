// Bot de exemplo: responde "pong" a `!ping` e registra o comando /ola com a opção `nome`.
// Rode com OPENCORD_URL e OPENCORD_TOKEN no ambiente (veja o README).
import { Client, Events, GatewayIntentBits, SlashCommandBuilder } from '@opencord-chat/bot';

if (!process.env.OPENCORD_TOKEN || !process.env.OPENCORD_URL) {
  console.error('defina OPENCORD_URL (ex.: https://api.seu-opencord.dev) e OPENCORD_TOKEN (token do bot, ocb_…)');
  process.exit(1);
}

// intents são aceitos e ignorados: o bot recebe os eventos dos servidores em que é membro
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once(Events.ClientReady, async (c) => {
  console.warn(`conectado como ${c.user.tag} em ${c.guilds.cache.size} servidor(es)`);
  await c.application.commands.set([
    new SlashCommandBuilder()
      .setName('ola')
      .setDescription('Cumprimenta alguém')
      .addStringOption((o) => o.setName('nome').setDescription('Quem cumprimentar').setRequired(true)),
  ]);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') await message.reply('pong');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ola') {
    const nome = interaction.options.getString('nome', true);
    await interaction.reply({ content: `Olá, ${nome}!`, ephemeral: true });
  }
});

client.on(Events.Error, (err) => console.error('erro:', err.message));

await client.login();
