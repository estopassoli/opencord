/**
 * Bots do Espaço 3D (treino contra o computador): os níveis e o que cada um muda. Os bots rodam só no app de quem
 * os chamou (não vão para a rede) e a partida contra eles é treino: não conta na classificação.
 */
export const BOT_LEVELS = ['facil', 'medio', 'dificil'] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];

export const BOT_LEVEL_LABEL: Record<BotLevel, string> = {
  facil: 'Fácil',
  medio: 'Médio',
  dificil: 'Difícil',
};

/**
 * Parâmetros comuns: tempo de reação (s), erro de mira (0 = perfeito, 1 = muito ruim) e o quanto o bot "pensa"
 * antes de agir (chance de escolher a melhor jogada). Cada jogo usa o que fizer sentido.
 */
export interface BotSkill {
  reaction: number;
  error: number;
  smart: number;
  /** multiplica a velocidade de movimento */
  speed: number;
}

export const BOT_SKILL: Record<BotLevel, BotSkill> = {
  facil: { reaction: 0.75, error: 0.55, smart: 0.3, speed: 0.75 },
  medio: { reaction: 0.4, error: 0.28, smart: 0.65, speed: 0.9 },
  dificil: { reaction: 0.2, error: 0.1, smart: 0.92, speed: 1 },
};

/** id do bot (começa com "bot:"; nunca é o id de uma pessoa) */
export function botId(level: BotLevel): string {
  return `bot:${level}`;
}

export function isBotId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('bot:');
}

/** nome que aparece em cima do boneco e no placar ("Bot · Fácil") */
export function botName(level: BotLevel): string {
  return `Bot · ${BOT_LEVEL_LABEL[level]}`;
}
