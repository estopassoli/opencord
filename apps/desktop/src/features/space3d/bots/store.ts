/**
 * Estado do treino contra bot (só neste app; nada vai para a rede): qual bot está ativo e onde, e o placar, a corrida
 * ou o x1 local. O HUD lê daqui no lugar do servidor quando há bot na zona; a cena (`bots/runner.ts`) marca os pontos.
 */
import type { MatchPhase, SpaceDuel } from '@opencord/contracts';
import { useMemo } from 'react';
import { create } from 'zustand';
import { useSpace } from '../../../store/space';
import { botId, botName, type BotLevel } from './level';
import {
  botDuelForfeit,
  botDuelHit,
  botDuelTick,
  botMatchPhase,
  botMatchScore,
  botMatchTick,
  botRaceFinish,
  botRaceTick,
  isBotDuel,
  newBotDuel,
  newBotMatch,
  newBotRace,
  type BotMatch,
  type BotRace,
} from './match';

type Side = 'a' | 'b';

export interface ActiveBot {
  zone: number;
  level: BotLevel;
  id: string;
  name: string;
  /** time do bot (o contrário do meu) */
  team: Side;
  /** quem chamou (eu) */
  me: string;
  /** muda a cada partida nova (a cena põe tudo no lugar) */
  round: number;
}

interface BotPlay {
  bot: ActiveBot | null;
  match: BotMatch | null;
  race: BotRace | null;
  duel: SpaceDuel | null;
  /** aviso para quem joga (o bot saiu porque alguém entrou na arena) */
  notice: string | null;
  start(o: { zone: number; level: BotLevel; me: string; team: Side; ring?: { x: number; z: number } }): void;
  stop(notice?: string): void;
  /** Jogar / Revanche / Correr de novo contra o mesmo bot */
  rematch(): void;
  score(side: Side, points: number): void;
  resetScore(): void;
  raceFinish(id: string, ms: number): void;
  duelHit(by: string, on: string, dmg: number, blocked: boolean): void;
  forfeit(): void;
  /** o relógio (contagem, tempo de jogo, fim da corrida e do x1), chamado pela cena a cada quadro */
  tick(): void;
}

/** relógio do servidor (as lutas usam ele, como as de verdade) */
const serverNow = () => Date.now() + useSpace.getState().duelOffset;

let duelN = 0;

export const useBotPlay = create<BotPlay>()((set, get) => ({
  bot: null,
  match: null,
  race: null,
  duel: null,
  notice: null,
  start({ zone, level, me, team, ring }) {
    const bot: ActiveBot = {
      zone,
      level,
      id: botId(level),
      name: botName(level),
      team: team === 'a' ? 'b' : 'a',
      me,
      round: (get().bot?.round ?? 0) + 1,
    };
    const now = Date.now();
    set({
      bot,
      notice: null,
      match: zone >= 1 && zone <= 6 ? newBotMatch(zone, now) : null,
      race: zone === 7 ? newBotRace(now, [me, bot.id]) : null,
      duel: zone === 0 ? newBotDuel(me, bot.id, ring ?? { x: 0, z: 0 }, serverNow(), ++duelN) : null,
    });
  },
  stop(notice) {
    set({ bot: null, match: null, race: null, duel: null, notice: notice ?? null });
  },
  rematch() {
    const { bot, duel } = get();
    if (!bot) return;
    const now = Date.now();
    set({
      bot: { ...bot, round: bot.round + 1 },
      match: bot.zone >= 1 && bot.zone <= 6 ? newBotMatch(bot.zone, now) : null,
      race: bot.zone === 7 ? newBotRace(now, [bot.me, bot.id]) : null,
      duel: bot.zone === 0 ? newBotDuel(bot.me, bot.id, duel?.ring ?? { x: 0, z: 0 }, serverNow(), ++duelN) : null,
    });
  },
  score(side, points) {
    const m = get().match;
    if (!m) return;
    const next = botMatchScore(m, side, points, Date.now());
    if (next !== m) set({ match: next });
  },
  resetScore() {
    const m = get().match;
    if (m) set({ match: { ...m, score: { a: 0, b: 0 }, phase: 'idle', winner: null, endedAt: null } });
  },
  raceFinish(id, ms) {
    const r = get().race;
    if (!r) return;
    const next = botRaceFinish(r, id, ms, Date.now());
    if (next !== r) set({ race: next });
  },
  duelHit(by, on, dmg, blocked) {
    const d = get().duel;
    if (!d) return;
    const next = botDuelHit(d, by, on, dmg, blocked, serverNow());
    if (next !== d) set({ duel: { ...next, serverNow: serverNow() } });
  },
  forfeit() {
    const { duel, bot } = get();
    if (duel && bot) set({ duel: botDuelForfeit(duel, bot.me) });
  },
  tick() {
    const { match, race, duel } = get();
    const now = Date.now();
    const m = match ? botMatchTick(match, now) : null;
    const r = race ? botRaceTick(race, now) : null;
    const d = duel ? botDuelTick(duel, serverNow()) : null;
    if (m !== match || r !== race || d !== duel) set({ match: m, race: r, duel: d });
  },
}));

/** há bot nesta zona agora? */
export function botIn(zone: number): ActiveBot | null {
  const b = useBotPlay.getState().bot;
  return b && b.zone === zone ? b : null;
}

/** nome do bot pelo id (null se não é o bot ativo) */
export function botNameOf(id: string | null | undefined): string | null {
  const b = useBotPlay.getState().bot;
  return b && id === b.id ? b.name : null;
}

/** fase da partida contra o bot nesta zona (null = sem bot) */
export function botPhaseOf(zone: number, now = Date.now()): MatchPhase | null {
  const m = useBotPlay.getState().match;
  return m && m.zone === zone ? botMatchPhase(m, now) : null;
}

/** todas as lutas que o HUD mostra: as do servidor e a do bot */
export function useAllDuels(): Record<string, SpaceDuel> {
  const duels = useSpace((s) => s.duels);
  const bot = useBotPlay((s) => s.duel);
  return useMemo(() => (bot ? { ...duels, [bot.id]: bot } : duels), [duels, bot]);
}

/** desistir do x1 (o do bot fica aqui; o de verdade vai para o servidor) */
export function forfeitDuel(id: string) {
  if (isBotDuel(id)) useBotPlay.getState().forfeit();
  else void useSpace.getState().forfeit(id);
}
