/**
 * Partida contra bot (treino, só no app de quem chamou o bot): placar, contagem, alvo e fim, sem servidor. Usa a
 * mesma regra das partidas de verdade (`MATCH_RULES`/`matchWinner` de @opencord/contracts); a sinuca, que não tem
 * regra de vitória no servidor, vai até `BOT_POOL_TARGET` bolas. Corrida e x1 têm o próprio estado (mesmo formato do
 * servidor, para o HUD reaproveitar os componentes). Puro: o relógio entra por parâmetro.
 */
import {
  DUEL_COUNTDOWN_MS,
  DUEL_FIGHT_MS,
  DUEL_HP,
  isMatchZone,
  MATCH_COUNTDOWN_MS,
  matchWinner,
  RACE_CLOSE_MS,
  RACE_COUNTDOWN_MS,
  RACE_LAPS,
  type MatchPhase,
  type SpaceDuel,
} from '@opencord/contracts';

type Side = 'a' | 'b';

/** sinuca contra o bot: quem encaçapar 8 bolas primeiro (a maioria das 15) vence */
export const BOT_POOL_TARGET = 8;

export interface BotMatch {
  zone: number;
  score: { a: number; b: number };
  /** fase gravada; a contagem vira jogo sozinha no `goAt` (`botMatchPhase`) */
  phase: MatchPhase;
  /** o VAI (relógio local, ms) */
  goAt: number;
  winner: Side | null;
  endedAt: number | null;
}

export function newBotMatch(zone: number, now: number): BotMatch {
  return {
    zone,
    score: { a: 0, b: 0 },
    phase: 'countdown',
    goAt: now + MATCH_COUNTDOWN_MS,
    winner: null,
    endedAt: null,
  };
}

/** fase de agora */
export function botMatchPhase(m: BotMatch, now: number): MatchPhase {
  return m.phase === 'countdown' && now >= m.goAt ? 'playing' : m.phase;
}

/** quem venceu com este placar (null = segue); `elapsed` = tempo de jogo desde o VAI */
export function botWinner(zone: number, score: { a: number; b: number }, elapsed: number): Side | null {
  if (isMatchZone(zone)) return matchWinner(zone, score, elapsed);
  if (zone === 6) {
    if (score.a >= BOT_POOL_TARGET && score.a > score.b) return 'a';
    if (score.b >= BOT_POOL_TARGET && score.b > score.a) return 'b';
  }
  return null;
}

/** texto da regra no placar ("até 8 bolas" na sinuca; nas outras, o do servidor) */
export function botRuleLabel(zone: number): string | null {
  return zone === 6 ? `até ${BOT_POOL_TARGET} bolas` : null;
}

/** ponto: só conta em jogo (na contagem e depois do fim, nada muda) */
export function botMatchScore(m: BotMatch, side: Side, points: number, now: number): BotMatch {
  if (botMatchPhase(m, now) !== 'playing') return m;
  const score = { ...m.score, [side]: m.score[side] + points };
  const winner = botWinner(m.zone, score, now - m.goAt);
  return winner ? { ...m, score, phase: 'ended', winner, endedAt: now } : { ...m, score, phase: 'playing' };
}

/** o relógio: a contagem vira jogo e, nos jogos com tempo, o tempo acaba (devolve o mesmo objeto se nada mudou) */
export function botMatchTick(m: BotMatch, now: number): BotMatch {
  const ph = botMatchPhase(m, now);
  if (ph !== 'playing') return m;
  const winner = botWinner(m.zone, m.score, now - m.goAt);
  if (winner) return { ...m, phase: 'ended', winner, endedAt: now };
  return m.phase === 'playing' ? m : { ...m, phase: 'playing' };
}

// ---------- corrida ----------
export interface BotRace {
  /** largada (relógio local) */
  startAt: number;
  laps: number;
  results: { userId: string; ms: number }[];
  racers: string[];
  endsAt?: number;
  closed: boolean;
  dnf: string[];
}

export function newBotRace(now: number, racers: string[]): BotRace {
  return { startAt: now + RACE_COUNTDOWN_MS, laps: RACE_LAPS, results: [], racers, closed: false, dnf: [] };
}

/** alguém cruzou a linha: entra na chegada; todos chegaram, a corrida fecha */
export function botRaceFinish(r: BotRace, id: string, ms: number, now: number): BotRace {
  if (r.closed || r.results.some((x) => x.userId === id)) return r;
  const results = [...r.results, { userId: id, ms }];
  const closed = r.racers.every((x) => results.some((y) => y.userId === x));
  return { ...r, results, closed, endsAt: r.endsAt ?? now + RACE_CLOSE_MS };
}

/** 30 s depois do primeiro, quem não chegou fica de fora (DNF) */
export function botRaceTick(r: BotRace, now: number): BotRace {
  if (r.closed || r.endsAt === undefined || now < r.endsAt) return r;
  const dnf = r.racers.filter((x) => !r.results.some((y) => y.userId === x));
  return { ...r, closed: true, dnf };
}

// ---------- x1 ----------
/** id das lutas contra o bot (nunca vai para o servidor) */
export const BOT_DUEL_PREFIX = 'bot-duel:';

export function isBotDuel(id: string | null | undefined): boolean {
  return !!id && id.startsWith(BOT_DUEL_PREFIX);
}

/** x1 novo contra o bot (o relógio é o do servidor, como nas lutas de verdade: o HUD soma o `duelOffset`) */
export function newBotDuel(me: string, bot: string, ring: { x: number; z: number }, now: number, n = 1): SpaceDuel {
  return {
    id: `${BOT_DUEL_PREFIX}${n}`,
    channelId: '00000000-0000-0000-0000-000000000000',
    a: me,
    b: bot,
    status: 'countdown',
    hp: { [me]: DUEL_HP, [bot]: DUEL_HP },
    ring,
    until: now + DUEL_COUNTDOWN_MS,
    winner: null,
    reason: null,
    lastHit: null,
    serverNow: now,
  };
}

/** a contagem vira luta e, no fim do tempo, vence quem tem mais vida (mesmo objeto se nada mudou) */
export function botDuelTick(d: SpaceDuel, now: number): SpaceDuel {
  if (d.status === 'countdown' && now >= d.until) return { ...d, status: 'fighting', until: now + DUEL_FIGHT_MS };
  if (d.status === 'fighting' && now >= d.until) {
    const ha = d.hp[d.a] ?? 0;
    const hb = d.hp[d.b] ?? 0;
    return { ...d, status: 'ended', winner: ha === hb ? null : ha > hb ? d.a : d.b, reason: 'time' };
  }
  return d;
}

/** um soco acertou: tira a vida; zerou, nocaute */
export function botDuelHit(
  d: SpaceDuel,
  by: string,
  on: string,
  dmg: number,
  blocked: boolean,
  now: number,
): SpaceDuel {
  if (d.status !== 'fighting') return d;
  const hp = { ...d.hp, [on]: Math.max(0, (d.hp[on] ?? 0) - dmg) };
  const lastHit = { by, on, dmg, blocked, at: now };
  if (hp[on] === 0) return { ...d, hp, lastHit, status: 'ended', winner: by, reason: 'ko' };
  return { ...d, hp, lastHit };
}

export function botDuelForfeit(d: SpaceDuel, by: string): SpaceDuel {
  if (d.status === 'ended') return d;
  return { ...d, status: 'ended', winner: by === d.a ? d.b : d.a, reason: 'forfeit' };
}
