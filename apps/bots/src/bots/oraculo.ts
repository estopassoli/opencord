/**
 * Oráculo — assistente com IA (Claude): /pergunte, /resumo do canal, /traduzir e /explicar uma mensagem
 * (menu de contexto). Usa a mesma chave da Anthropic da instância (ANTHROPIC_API_KEY); sem ela avisa.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  EmbedBuilder,
  Events,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from '@opencord-chat/bot';
import { reply, type BotDefinition } from '../shared.js';

const COLOR = '#a855f7';
const SYSTEM =
  'Você é o Oráculo, assistente de um grupo de amigos num chat de voz e texto. Responda em português do Brasil, direto, sem enrolação, com humor leve quando couber. Nada de inventar fatos; se não souber, diga. Respostas curtas (até ~1200 caracteres), sem markdown pesado.';

function model(env = process.env): Anthropic | null {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({
    apiKey: key,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    timeout: 30_000,
    maxRetries: 1,
  });
}
const MODEL = process.env.ORACULO_MODEL ?? 'claude-haiku-5-5';

async function ask(ai: Anthropic, prompt: string, system = SYSTEM): Promise<string> {
  const res = await ai.messages.create({
    model: MODEL,
    max_tokens: 800,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return 'Isso eu não respondo.';
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

async function transcript(channel: TextChannel, limit: number): Promise<string> {
  const msgs = await channel.messages.fetch({ limit });
  const list = [...msgs.values()].filter((m) => m.content).reverse();
  return list.map((m) => `${m.author.displayName}: ${m.content.slice(0, 400)}`).join('\n');
}

export const oraculo: BotDefinition = {
  key: 'ORACULO',
  name: 'Oráculo',
  description: 'Assistente com IA: pergunte, resuma o canal, traduza e explique mensagens.',
  activity: 'pensando',
  async start(ctx) {
    const { client } = ctx;
    const ai = model();
    if (!ai) ctx.log('sem ANTHROPIC_API_KEY: comandos vão avisar que a IA está desligada');
    client.once(Events.ClientReady, async (c) => {
      await c.application.commands.set([
        new SlashCommandBuilder()
          .setName('pergunte')
          .setDescription('Pergunte qualquer coisa ao Oráculo')
          .addStringOption((o) =>
            o.setName('pergunta').setDescription('Sua pergunta').setRequired(true).setMaxLength(1000),
          ),
        new SlashCommandBuilder()
          .setName('resumo')
          .setDescription('Resume as últimas mensagens deste canal')
          .addIntegerOption((o) =>
            o.setName('quantas').setDescription('Mensagens (padrão 50)').setMinValue(10).setMaxValue(200),
          ),
        new SlashCommandBuilder()
          .setName('traduzir')
          .setDescription('Traduz um texto')
          .addStringOption((o) => o.setName('texto').setDescription('Texto').setRequired(true).setMaxLength(1500))
          .addStringOption((o) => o.setName('para').setDescription('Idioma (padrão português)').setMaxLength(30)),
        new ContextMenuCommandBuilder().setName('Explicar mensagem').setType(ApplicationCommandType.Message),
      ]);
      ctx.log(`pronto em ${c.guilds.cache.size} servidor(es)`);
    });

    client.on(Events.InteractionCreate, async (i) => {
      try {
        if (i.isMessageContextMenuCommand() && i.commandName === 'Explicar mensagem') {
          if (!ai) return await reply(i, { content: 'A IA está desligada nesta instância.', ephemeral: true });
          await i.deferReply({ ephemeral: true });
          const text = i.targetMessage.content || '(mensagem sem texto)';
          const out = await ask(
            ai,
            `Explique esta mensagem de forma simples (gírias, referências, contexto):\n\n${text}`,
          );
          return await i.editReply({ content: out });
        }
        if (!i.isChatInputCommand()) return;
        if (!ai)
          return await reply(i, {
            content: 'A IA está desligada nesta instância (sem chave da Anthropic).',
            ephemeral: true,
          });
        await handle(i, ai);
      } catch (e) {
        ctx.log(`falha na interação: ${e instanceof Error ? e.message : String(e)}`);
        if (i.isRepliable())
          await reply(i, { content: 'O Oráculo engasgou. Tenta de novo.', ephemeral: true }).catch(() => undefined);
      }
    });
  },
};

async function handle(i: ChatInputCommandInteraction, ai: Anthropic) {
  if (i.commandName === 'pergunte') {
    const q = i.options.getString('pergunta', true);
    await i.deferReply();
    const out = await ask(ai, q);
    return i.editReply({
      embeds: [new EmbedBuilder().setColor(COLOR).setTitle(q.slice(0, 120)).setDescription(out.slice(0, 2000))],
    });
  }
  if (i.commandName === 'resumo') {
    const n = i.options.getInteger('quantas') ?? 50;
    await i.deferReply();
    const text = await transcript(i.channel, n);
    if (!text) return i.editReply({ content: 'Nada para resumir aqui.' });
    const out = await ask(
      ai,
      `Resuma a conversa abaixo em até 6 tópicos curtos, dizendo quem disse o quê quando importar:\n\n${text}`,
    );
    return i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(`Resumo das últimas ${n} mensagens`)
          .setDescription(out.slice(0, 2000)),
      ],
    });
  }
  if (i.commandName === 'traduzir') {
    const text = i.options.getString('texto', true);
    const to = i.options.getString('para') ?? 'português do Brasil';
    await i.deferReply();
    const out = await ask(
      ai,
      `Traduza para ${to}, só a tradução:\n\n${text}`,
      'Você é um tradutor. Responda apenas com a tradução.',
    );
    return i.editReply({ content: out.slice(0, 2000) });
  }
}
