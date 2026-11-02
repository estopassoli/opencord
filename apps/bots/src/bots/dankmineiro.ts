/**
 * Dank Mineiro — economia de brincadeira: moedas diárias, trabalhar, apostar, cara ou coroa, roubar, pagar e
 * ranking. Nada vale dinheiro de verdade; é zoeira entre amigos.
 */
import { EmbedBuilder, Events, SlashCommandBuilder, type ChatInputCommandInteraction } from '@opencord-chat/bot';
import { fmt, type BotContext, type BotDefinition } from '../shared.js';

const COLOR = '#22c55e';
const DAILY = 250;
const DAILY_MS = 20 * 3600_000;
const WORK_MS = 60 * 60_000;
const ROB_MS = 6 * 3600_000;
const JOBS = [
  ['tirou o pó de prosa na venda', 80, 160],
  ['vendeu pão de queijo na porta do estádio', 120, 220],
  ['consertou o Wi-Fi da tia', 60, 140],
  ['fez frete de sofá', 100, 200],
  ['deu aula de Minecraft', 90, 180],
  ['achou moeda no sofá', 10, 40],
] as const;

interface Row {
  balance: number;
  last_daily: number;
  last_work: number;
  last_rob: number;
}

/** resultado de uma aposta: dobra com 45 % de chance */
export const betOutcome = (amount: number, rnd = Math.random): number => (rnd() < 0.45 ? amount : -amount);
/** roubo: 35 % de chance de levar até 30 % do saldo da vítima; falhou, paga multa de 20 % do próprio saldo */
export function robOutcome(mine: number, theirs: number, rnd = Math.random): { delta: number; ok: boolean } {
  if (rnd() < 0.35) return { ok: true, delta: Math.floor(theirs * (0.1 + rnd() * 0.2)) };
  return { ok: false, delta: -Math.floor(mine * 0.2) };
}

export const dankMineiro: BotDefinition = {
  key: 'DANKMINEIRO',
  name: 'Dank Mineiro',
  description: 'Economia de brincadeira: moedas diárias, trabalhar, apostar, roubar e ranking.',
  activity: 'contando moedas, uai',
  async start(ctx) {
    const { client } = ctx;
    client.once(Events.ClientReady, async (c) => {
      await c.application.commands.set([
        new SlashCommandBuilder().setName('diario').setDescription(`Pega ${DAILY} moedas por dia`),
        new SlashCommandBuilder().setName('trabalhar').setDescription('Ganha umas moedas (1x por hora)'),
        new SlashCommandBuilder()
          .setName('saldo')
          .setDescription('Quantas moedas você tem')
          .addUserOption((o) => o.setName('pessoa').setDescription('De quem')),
        new SlashCommandBuilder()
          .setName('apostar')
          .setDescription('Dobra ou perde (45 % de chance)')
          .addIntegerOption((o) => o.setName('valor').setDescription('Quanto').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder()
          .setName('caraoucoroa')
          .setDescription('Aposta num lado da moeda (50 %)')
          .addStringOption((o) =>
            o
              .setName('lado')
              .setDescription('cara ou coroa')
              .setRequired(true)
              .addChoices({ name: 'cara', value: 'cara' }, { name: 'coroa', value: 'coroa' }),
          )
          .addIntegerOption((o) => o.setName('valor').setDescription('Quanto').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder()
          .setName('roubar')
          .setDescription('Tenta roubar alguém (35 %; se falhar, paga multa)')
          .addUserOption((o) => o.setName('pessoa').setDescription('Vítima').setRequired(true)),
        new SlashCommandBuilder()
          .setName('pagar')
          .setDescription('Transfere moedas')
          .addUserOption((o) => o.setName('pessoa').setDescription('Para quem').setRequired(true))
          .addIntegerOption((o) => o.setName('valor').setDescription('Quanto').setRequired(true).setMinValue(1)),
        new SlashCommandBuilder().setName('ricos').setDescription('Top 10 em moedas'),
      ]);
      ctx.log(`pronto em ${c.guilds.cache.size} servidor(es)`);
    });
    client.on(Events.InteractionCreate, async (i) => {
      if (!i.isChatInputCommand()) return;
      try {
        await handle(i, ctx);
      } catch (e) {
        ctx.log(`falha em /${i.commandName}: ${e instanceof Error ? e.message : String(e)}`);
        await i.reply({ content: 'Deu ruim aqui, sô. Tenta de novo.', ephemeral: true }).catch(() => undefined);
      }
    });
  },
};

function account(ctx: BotContext, guild: string, user: string): Row {
  const row = ctx.store.db
    .prepare('SELECT balance, last_daily, last_work, last_rob FROM coins WHERE guild = ? AND user = ?')
    .get(guild, user) as Row | undefined;
  return row ?? { balance: 0, last_daily: 0, last_work: 0, last_rob: 0 };
}
function put(ctx: BotContext, guild: string, user: string, r: Row) {
  ctx.store.db
    .prepare(
      'INSERT INTO coins (guild, user, balance, last_daily, last_work, last_rob) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (guild, user) DO UPDATE SET balance = excluded.balance, last_daily = excluded.last_daily, last_work = excluded.last_work, last_rob = excluded.last_rob',
    )
    .run(guild, user, Math.max(0, r.balance), r.last_daily, r.last_work, r.last_rob);
}
const coins = (n: number) => `🪙 ${fmt.format(n)}`;
const wait = (ms: number) => `${Math.ceil(ms / 60_000)} min`;

async function handle(i: ChatInputCommandInteraction, ctx: BotContext) {
  const g = i.guildId;
  const me = account(ctx, g, i.user.id);
  const now = Date.now();
  switch (i.commandName) {
    case 'diario': {
      if (now - me.last_daily < DAILY_MS)
        return i.reply({
          content: `Já pegou hoje. Volta em ${wait(DAILY_MS - (now - me.last_daily))}.`,
          ephemeral: true,
        });
      put(ctx, g, i.user.id, { ...me, balance: me.balance + DAILY, last_daily: now });
      return i.reply(`${coins(DAILY)} no bolso. Saldo: ${coins(me.balance + DAILY)}`);
    }
    case 'trabalhar': {
      if (now - me.last_work < WORK_MS)
        return i.reply({
          content: `Descansa, trem. Volta em ${wait(WORK_MS - (now - me.last_work))}.`,
          ephemeral: true,
        });
      const job = JOBS[Math.floor(Math.random() * JOBS.length)] ?? JOBS[0];
      const earned = job[1] + Math.floor(Math.random() * (job[2] - job[1] + 1));
      put(ctx, g, i.user.id, { ...me, balance: me.balance + earned, last_work: now });
      return i.reply(`Você ${job[0]} e ganhou ${coins(earned)}. Saldo: ${coins(me.balance + earned)}`);
    }
    case 'saldo': {
      const who = i.options.getUser('pessoa') ?? i.user;
      const r = account(ctx, g, who.id);
      return i.reply(`${who.displayName} tem ${coins(r.balance)}.`);
    }
    case 'apostar': {
      const amount = i.options.getInteger('valor', true);
      if (amount > me.balance) return i.reply({ content: `Você só tem ${coins(me.balance)}.`, ephemeral: true });
      const delta = betOutcome(amount);
      put(ctx, g, i.user.id, { ...me, balance: me.balance + delta });
      return i.reply(
        delta > 0
          ? `🎰 Ganhou ${coins(delta)}! Saldo: ${coins(me.balance + delta)}`
          : `💸 Perdeu ${coins(amount)}. Saldo: ${coins(me.balance + delta)}`,
      );
    }
    case 'caraoucoroa': {
      const amount = i.options.getInteger('valor', true);
      if (amount > me.balance) return i.reply({ content: `Você só tem ${coins(me.balance)}.`, ephemeral: true });
      const side = Math.random() < 0.5 ? 'cara' : 'coroa';
      const won = side === i.options.getString('lado', true);
      put(ctx, g, i.user.id, { ...me, balance: me.balance + (won ? amount : -amount) });
      return i.reply(`Deu **${side}**. ${won ? `Ganhou ${coins(amount)}!` : `Perdeu ${coins(amount)}.`}`);
    }
    case 'roubar': {
      const victim = i.options.getUser('pessoa', true);
      if (victim.id === i.user.id || victim.bot)
        return i.reply({ content: 'Rouba outra pessoa, uai.', ephemeral: true });
      if (now - me.last_rob < ROB_MS)
        return i.reply({
          content: `A polícia tá de olho. Volta em ${wait(ROB_MS - (now - me.last_rob))}.`,
          ephemeral: true,
        });
      const them = account(ctx, g, victim.id);
      if (them.balance < 50) return i.reply({ content: 'Essa pessoa está dura. Não vale a pena.', ephemeral: true });
      const r = robOutcome(me.balance, them.balance);
      put(ctx, g, i.user.id, { ...me, balance: me.balance + r.delta, last_rob: now });
      if (r.ok) put(ctx, g, victim.id, { ...them, balance: them.balance - r.delta });
      return i.reply(
        r.ok
          ? `🥷 Você levou ${coins(r.delta)} de <@${victim.id}>!`
          : `🚔 Pego no flagra: multa de ${coins(-r.delta)}.`,
      );
    }
    case 'pagar': {
      const to = i.options.getUser('pessoa', true);
      const amount = i.options.getInteger('valor', true);
      if (to.id === i.user.id) return i.reply({ content: 'Pagar a si mesmo não conta.', ephemeral: true });
      if (amount > me.balance) return i.reply({ content: `Você só tem ${coins(me.balance)}.`, ephemeral: true });
      const them = account(ctx, g, to.id);
      put(ctx, g, i.user.id, { ...me, balance: me.balance - amount });
      put(ctx, g, to.id, { ...them, balance: them.balance + amount });
      return i.reply(`Pagou ${coins(amount)} para <@${to.id}>.`);
    }
    case 'ricos': {
      const rows = ctx.store.db
        .prepare('SELECT user, balance FROM coins WHERE guild = ? ORDER BY balance DESC LIMIT 10')
        .all(g) as { user: string; balance: number }[];
      if (!rows.length) return i.reply({ content: 'Ninguém tem moedas ainda. /diario!', ephemeral: true });
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle('Os mais ricos')
            .setDescription(rows.map((r, k) => `**${k + 1}.** <@${r.user}> — ${coins(r.balance)}`).join('\n')),
        ],
      });
    }
  }
}
