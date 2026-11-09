import { describe, expect, it, vi } from 'vitest';
import { GameBus, power01, type GameEvent } from '../src/features/space3d/events';
import { POOL_R, stepPool, type PoolBall } from '../src/features/space3d/pool';
import { startGrid, stepBike, TRACK } from '../src/features/space3d/race';
import { netCall, netPoint } from '../src/features/space3d/sportplay';
import {
  ARENAS,
  BOARD_X,
  GOAL_X,
  HOOP_X,
  RIM_R,
  RIM_Y,
  stepBall,
  type BallState,
} from '../src/features/space3d/sports';

function run(zone: 1 | 2 | 3 | 4 | 5, b: BallState, secs: number) {
  const fx: GameEvent[] = [];
  const ev = [];
  for (let t = 0; t < secs; t += 1 / 60) ev.push(...stepBall(ARENAS[zone], b, 1 / 60, null, fx));
  return { ev, fx };
}

describe('Espaço 3D: eventos de jogo (ADR-0056)', () => {
  it('barramento: ouvinte por tipo e geral; desligar; um ouvinte com erro não cala os outros', () => {
    const bus = new GameBus();
    const all = vi.fn();
    const kicks = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bus.on(() => {
      throw new Error('quebrou');
    });
    const off = bus.on(all);
    bus.on('kick', kicks);
    const kick: GameEvent = { kind: 'kick', by: 'eu', power: 1, zone: 2, at: { x: 0, y: 0, z: 0 } };
    bus.emit(kick);
    bus.emit({ kind: 'go', power: 1, zone: 7, at: { x: 0, y: 0, z: 0 } });
    expect(kicks).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(2);
    off();
    bus.emit(kick);
    expect(all).toHaveBeenCalledTimes(2);
    expect(kicks).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it('power01 fica entre 0 e 1', () => {
    expect(power01(30, 15)).toBe(1);
    expect(power01(-7.5, 15)).toBe(0.5);
    expect(power01(3, 0)).toBe(0);
  });

  it('basquete: bater na tabela emite surface board com v > 0', () => {
    const b = { x: BOARD_X - 0.4, y: RIM_Y + 0.5, z: 0.3, vx: 6, vy: 0, vz: 0 };
    const { fx } = run(1, b, 0.3);
    const board = fx.find((e) => e.kind === 'surface' && e.surface === 'board');
    expect(board).toBeDefined();
    expect(board && board.kind === 'surface' ? board.v : 0).toBeGreaterThan(0);
    expect(board?.power).toBeGreaterThan(0);
    expect(board?.zone).toBe(1);
  });

  it('basquete: cair em cima do aro emite surface rim com v > 0', () => {
    const b = { x: HOOP_X - RIM_R, y: RIM_Y + 0.4, z: 0, vx: 0, vy: -2, vz: 0 };
    const { fx } = run(1, b, 0.3);
    const rim = fx.find((e) => e.kind === 'surface' && e.surface === 'rim');
    expect(rim && rim.kind === 'surface' ? rim.v : 0).toBeGreaterThan(0);
  });

  it('quique no chão e no muro viram efeito', () => {
    const { fx } = run(2, { x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 20 }, 1.5);
    expect(fx.some((e) => e.kind === 'bounce' && e.surface === 'floor' && e.v > 1)).toBe(true);
    expect(fx.some((e) => e.kind === 'surface' && e.surface === 'wall')).toBe(true);
  });

  it('futebol: bola vinda de trás do gol não é gol; de dentro do campo é', () => {
    const behind = { x: GOAL_X + 1.5, y: 0.11, z: 0, vx: -12, vy: 0, vz: 0 };
    expect(run(2, behind, 1.5).ev.some((e) => e.kind === 'score')).toBe(false);
    const front = { x: GOAL_X - 4, y: 0.11, z: 0, vx: 12, vy: 0.5, vz: 0 };
    expect(run(2, front, 1.5).ev.filter((e) => e.kind === 'score')).toHaveLength(1);
  });

  it('futebol: bater na trave emite surface post', () => {
    const post = { x: GOAL_X - 3, y: 0.11, z: 2.6, vx: 14, vy: 0, vz: 0 };
    expect(run(2, post, 1).fx.some((e) => e.kind === 'surface' && e.surface === 'post')).toBe(true);
  });

  it('tênis: bola baixa na rede emite surface net', () => {
    const low = { x: -3, y: 0.5, z: 0, vx: 10, vy: 0, vz: 0 };
    expect(run(3, low, 1).fx.some((e) => e.kind === 'surface' && e.surface === 'net')).toBe(true);
  });

  it('sinuca: duas bolas em rota de colisão devolvem ballHit com a velocidade relativa', () => {
    const balls: PoolBall[] = [
      { x: 0, z: 0, vx: 2, vz: 0, in: false },
      { x: POOL_R * 2 + 0.05, z: 0, vx: 0, vz: 0, in: false },
    ];
    const fx: GameEvent[] = [];
    for (let i = 0; i < 10; i++) stepPool(balls, 1 / 60, fx);
    const hit = fx.find((e) => e.kind === 'ballHit');
    expect(hit).toMatchObject({ kind: 'ballHit', a: 0, b: 1, zone: 6 });
    const v = hit && hit.kind === 'ballHit' ? hit.v : 0;
    expect(v).toBeGreaterThan(1.9);
    expect(v).toBeLessThanOrEqual(2);
    expect(fx.filter((e) => e.kind === 'ballHit')).toHaveLength(1);
  });

  it('sinuca: tabela vira cushion e a caçapa vira pocket', () => {
    const balls: PoolBall[] = [{ x: 0.3, z: 0, vx: 0, vz: 2, in: false }];
    const fx: GameEvent[] = [];
    for (let i = 0; i < 30; i++) stepPool(balls, 1 / 60, fx);
    expect(fx.some((e) => e.kind === 'cushion' && e.v > 1)).toBe(true);
    const pocketing: PoolBall[] = [{ x: 0, z: 0.5, vx: 0, vz: 2, in: false }];
    const fx2: GameEvent[] = [];
    const fell: number[] = [];
    for (let i = 0; i < 30; i++) fell.push(...stepPool(pocketing, 1 / 60, fx2));
    expect(fell).toEqual([0]);
    expect(fx2.filter((e) => e.kind === 'pocket')).toHaveLength(1);
  });

  it('sem a lista de efeitos, stepPool continua só devolvendo as caçapas', () => {
    const balls: PoolBall[] = [{ x: 0, z: 0.5, vx: 0, vz: 2, in: false }];
    expect(stepPool(balls, 0.2)).toEqual([0]);
  });

  it('corrida: passar no turbo do chão emite boost (pad)', () => {
    const b = startGrid(0);
    const pad = TRACK.pads[0]!;
    const p = TRACK.pts[pad]!;
    const d = TRACK.dirs[pad]!;
    Object.assign(b, { x: p.x, z: p.z, h: Math.atan2(d.x, d.z), idx: pad, v: 10 });
    const fx: GameEvent[] = [];
    stepBike(b, { up: true, down: false, left: false, right: false }, 1 / 60, 10_000, true, fx);
    expect(fx.find((e) => e.kind === 'boost')).toMatchObject({ kind: 'boost', source: 'pad', zone: 7 });
  });
});

describe('Espaço 3D: motivo do ponto nos jogos de rede', () => {
  it('fora, rede, não passou, dois quiques e caiu', () => {
    // tênis: A rebateu e a bola caiu fora direto → ponto B, "fora"
    expect(netCall(3, 'a', { x: 13, z: 0, surface: 'floor' }, 0)).toEqual({ kind: 'point', side: 'b', reason: 'fora' });
    // tênis: A rebateu, bateu na rede e quicou do próprio lado → ponto B, "rede"
    expect(netCall(3, 'a', { x: -1, z: 0, surface: 'floor' }, 0, true)).toEqual({
      kind: 'point',
      side: 'b',
      reason: 'rede',
    });
    // tênis: sem tocar na rede, quicou do próprio lado → "não passou"
    expect(netCall(3, 'a', { x: -1, z: 0, surface: 'floor' }, 0)).toEqual({
      kind: 'point',
      side: 'b',
      reason: 'não passou',
    });
    // tênis: quicou dentro uma vez e de novo → ponto A, "dois quiques"
    expect(netCall(3, 'a', { x: 5, z: 0, surface: 'floor' }, 0)).toEqual({ kind: 'bounce' });
    expect(netCall(3, 'a', { x: 6, z: 0, surface: 'floor' }, 1)).toEqual({
      kind: 'point',
      side: 'a',
      reason: 'dois quiques',
    });
    // vôlei: A bateu e caiu na quadra do B → ponto A, "caiu"
    expect(netCall(4, 'a', { x: 3, z: 0, surface: 'floor' }, 0)).toEqual({ kind: 'point', side: 'a', reason: 'caiu' });
    // vôlei: fora → ponto B
    expect(netCall(4, 'a', { x: 12, z: 0, surface: 'floor' }, 0)).toMatchObject({ side: 'b', reason: 'fora' });
    // ping pong: quicou na mesa do outro lado e caiu no chão → ponto de quem bateu, "caiu"
    expect(netCall(5, 'a', { x: 2, z: 0, surface: 'floor' }, 1)).toMatchObject({ side: 'a', reason: 'caiu' });
    // ping pong: duas vezes na mesa do outro lado
    expect(netCall(5, 'a', { x: 0.8, z: 0, surface: 'table' }, 1)).toMatchObject({ side: 'a', reason: 'dois quiques' });
  });

  it('netPoint (só o lado) continua igual ao netCall', () => {
    expect(netPoint(3, 'a', { x: 13, z: 0, surface: 'floor' }, 0)).toBe('b');
    expect(netPoint(3, 'a', { x: 5, z: 0, surface: 'floor' }, 0)).toBe('bounce');
  });
});
