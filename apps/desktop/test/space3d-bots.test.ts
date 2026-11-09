/** Bots do Espaço 3D: sorteio com semente, partida local (placar, alvo, fim), corrida e x1 contra o bot. */
import { DUEL_HP, MATCH_COUNTDOWN_MS, MATCH_RULES, RACE_CLOSE_MS } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { botId, botName, isBotId } from '../src/features/space3d/bots/level';
import {
  BOT_POOL_TARGET,
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
} from '../src/features/space3d/bots/match';
import { gauss, seeded } from '../src/features/space3d/bots/rng';

describe('bots: sorteio com semente', () => {
  it('a mesma semente dá a mesma sequência; outra semente dá outra', () => {
    const a = seeded(42);
    const b = seeded(42);
    const c = seeded(7);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
    for (const x of sa) expect(x >= 0 && x < 1).toBe(true);
  });

  it('gauss tem média perto de 0 e desvio perto de 1', () => {
    const r = seeded(1);
    const xs = Array.from({ length: 4000 }, () => gauss(r));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(sd).toBeGreaterThan(0.9);
    expect(sd).toBeLessThan(1.1);
  });

  it('id e nome do bot', () => {
    expect(botId('facil')).toBe('bot:facil');
    expect(isBotId('bot:dificil')).toBe(true);
    expect(isBotId('0190a000-0000-7000-8000-0000000000aa')).toBe(false);
    expect(botName('medio')).toBe('Bot · Médio');
  });
});

describe('bots: partida local (treino)', () => {
  it('começa na contagem 3-2-1 e vira jogo no VAI', () => {
    const m = newBotMatch(5, 1000);
    expect(botMatchPhase(m, 1000)).toBe('countdown');
    expect(m.goAt).toBe(1000 + MATCH_COUNTDOWN_MS);
    expect(botMatchPhase(m, m.goAt)).toBe('playing');
  });

  it('ponto na contagem não conta; em jogo conta', () => {
    const m = newBotMatch(3, 0);
    expect(botMatchScore(m, 'a', 1, 100)).toBe(m);
    const n = botMatchScore(m, 'a', 1, m.goAt + 10);
    expect(n.score).toEqual({ a: 1, b: 0 });
    expect(n.phase).toBe('playing');
  });

  it('chega ao alvo do jogo (MATCH_RULES) e acaba com o vencedor; depois nada muda', () => {
    let m = newBotMatch(5, 0);
    const t = m.goAt + 1;
    for (let i = 0; i < MATCH_RULES[5].target; i++) m = botMatchScore(m, 'b', 1, t);
    expect(m.phase).toBe('ended');
    expect(m.winner).toBe('b');
    expect(botMatchScore(m, 'a', 1, t)).toBe(m);
  });

  it('ping pong vence por 2: 11 × 10 ainda não acaba', () => {
    let m = newBotMatch(5, 0);
    const t = m.goAt + 1;
    for (let i = 0; i < 10; i++) m = botMatchScore(botMatchScore(m, 'a', 1, t), 'b', 1, t);
    m = botMatchScore(m, 'a', 1, t);
    expect(m.score).toEqual({ a: 11, b: 10 });
    expect(m.phase).toBe('playing');
    m = botMatchScore(m, 'a', 1, t);
    expect(m.winner).toBe('a');
  });

  it('basquete acaba no tempo com quem está na frente', () => {
    let m = newBotMatch(1, 0);
    m = botMatchScore(m, 'a', 2, m.goAt + 1000);
    expect(botMatchTick(m, m.goAt + 10_000)).toBe(m);
    const end = botMatchTick(m, m.goAt + (MATCH_RULES[1].timeMs ?? 0) + 1);
    expect(end.phase).toBe('ended');
    expect(end.winner).toBe('a');
  });

  it(`sinuca contra o bot vai até ${BOT_POOL_TARGET} bolas`, () => {
    let m = newBotMatch(6, 0);
    const t = m.goAt + 1;
    for (let i = 0; i < BOT_POOL_TARGET - 1; i++) m = botMatchScore(m, 'a', 1, t);
    expect(m.phase).toBe('playing');
    m = botMatchScore(m, 'a', 1, t);
    expect(m.winner).toBe('a');
  });
});

describe('bots: corrida e x1 locais', () => {
  it('corrida: todos chegam e ela fecha; sem o bot chegar, 30 s depois do 1º ele é DNF', () => {
    const r = newBotRace(0, ['eu', 'bot:facil']);
    const a = botRaceFinish(r, 'eu', 90_000, 100_000);
    expect(a.closed).toBe(false);
    const b = botRaceFinish(a, 'bot:facil', 95_000, 105_000);
    expect(b.closed).toBe(true);
    expect(b.results.map((x) => x.userId)).toEqual(['eu', 'bot:facil']);
    const late = botRaceTick(a, 100_000 + RACE_CLOSE_MS + 1);
    expect(late.closed).toBe(true);
    expect(late.dnf).toEqual(['bot:facil']);
  });

  it('x1: contagem, luta, socos tiram vida e o nocaute acaba', () => {
    let d = newBotDuel('eu', 'bot:medio', { x: 0, z: 0 }, 0);
    expect(isBotDuel(d.id)).toBe(true);
    expect(botDuelHit(d, 'eu', 'bot:medio', 10, false, 10)).toBe(d);
    d = botDuelTick(d, d.until);
    expect(d.status).toBe('fighting');
    d = botDuelHit(d, 'eu', 'bot:medio', 30, false, 1);
    expect(d.hp['bot:medio']).toBe(DUEL_HP - 30);
    d = botDuelHit(d, 'eu', 'bot:medio', 999, false, 2);
    expect(d.status).toBe('ended');
    expect(d.winner).toBe('eu');
    expect(d.reason).toBe('ko');
  });

  it('x1: no fim do tempo vence quem tem mais vida; desistir dá a vitória ao outro', () => {
    let d = botDuelTick(newBotDuel('eu', 'bot:facil', { x: 0, z: 0 }, 0), 5000);
    d = botDuelHit(d, 'bot:facil', 'eu', 8, false, 5100);
    const end = botDuelTick(d, d.until + 1);
    expect(end.winner).toBe('bot:facil');
    expect(end.reason).toBe('time');
    expect(botDuelForfeit(d, 'eu').winner).toBe('bot:facil');
  });
});
