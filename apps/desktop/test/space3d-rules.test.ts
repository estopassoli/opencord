import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PoolPlay, rack, type PoolMsg } from '../src/features/space3d/pool';
import {
  attackHoop,
  AUTO_SERVE_MS,
  canSteal,
  clampToHalf,
  goodBand,
  netSideOf,
  poolTurn,
  STEAL_GUARD_MS,
  type PoolRota,
  type PoolSeat,
} from '../src/features/space3d/rules';
import { SportPlay } from '../src/features/space3d/sportplay';
import { basketShot, HOOP_X } from '../src/features/space3d/sports';

describe('Espaço 3D: roubo de bola no basquete', () => {
  // quem tem a bola olha para +z
  const holder = { x: 0, z: 0, ry: 0 };
  it('recusa antes de 1 s de posse', () => {
    expect(canSteal(holder, 1000, { x: 0, z: 0.8 }, 1000 + STEAL_GUARD_MS - 1)).toBe(false);
    expect(canSteal(holder, 1000, { x: 0, z: 0.8 }, 1000 + STEAL_GUARD_MS)).toBe(true);
  });
  it('recusa por trás e aceita de frente ou de lado-frente', () => {
    expect(canSteal(holder, 0, { x: 0, z: -0.8 }, 5000)).toBe(false);
    expect(canSteal(holder, 0, { x: 0.8, z: -0.3 }, 5000)).toBe(false);
    expect(canSteal(holder, 0, { x: 0.5, z: 0.6 }, 5000)).toBe(true);
  });
});

describe('Espaço 3D: roubo na partida (SportPlay)', () => {
  it('a bola acabou de chegar na mão do amigo: não rouba; depois de 1 s, de frente, rouba; por trás, nunca', () => {
    const friend = { x: 0, z: 0, ry: 0 };
    const s = new SportPlay(
      new THREE.Scene(),
      1,
      'eu',
      { sendBall: () => undefined, score: () => undefined, alive: () => ['eu', 'amigo'], poseOf: () => friend },
      () => ({ x: 0, y: 0.76, z: 0.3 }),
    );
    s.remote({ x: 0, y: 0.76, z: 0.3, vx: 0, vy: 0, vz: 0, held: 'amigo', t: 1, by: 'amigo' }, 0);
    const front = { x: 0, y: 0, z: 0.9, ry: Math.PI, moving: false, running: false };
    s.update(1 / 60, 500, front);
    s.press(500);
    expect(s.holder).toBe('amigo');
    const back = { ...front, z: -0.6 };
    s.update(1 / 60, 1500, back);
    expect(s.prompt()).toBeNull();
    s.press(1500);
    expect(s.holder).toBe('amigo');
    s.update(1 / 60, 1600, front);
    s.press(1600);
    expect(s.holder).toBe('eu');
  });
});

describe('Espaço 3D: cesta de ataque e faixa verde', () => {
  it('a cesta é a do time, não a do olhar', () => {
    expect(attackHoop('a')).toBe(1);
    expect(attackHoop('b')).toBe(-1);
    // arremesso do azul olhando para trás continua indo para +x
    const from = { x: 4, y: 2, z: 0 };
    expect(basketShot(from, 0.7, attackHoop('a')).vx).toBeGreaterThan(0);
  });
  it('a faixa a 7 m é mais estreita que a 2 m; com marcador, mais estreita ainda', () => {
    const w = (b: { lo: number; hi: number }) => b.hi - b.lo;
    expect(w(goodBand(7))).toBeLessThan(w(goodBand(2)));
    expect(w(goodBand(7, true))).toBeLessThan(w(goodBand(7)));
    expect(w(goodBand(30))).toBeCloseTo(w(goodBand(12.6)));
    const near = goodBand(2);
    expect(near.lo).toBeGreaterThan(0);
    expect(near.hi).toBeLessThan(1);
  });
  it('força dentro da faixa de perto erra fora dela de longe', () => {
    // 0,56 está na faixa a 3 m e fora dela a 10 m
    const d3 = goodBand(3);
    const d10 = goodBand(10);
    expect(0.56 >= d3.lo && 0.56 <= d3.hi).toBe(true);
    expect(0.56 >= d10.lo && 0.56 <= d10.hi).toBe(false);
    expect(Math.abs(HOOP_X)).toBeGreaterThan(10);
  });
});

describe('Espaço 3D: vez da sinuca por pessoa (poolTurn)', () => {
  const seq = (seats: PoolSeat[], n: number) => {
    let r: PoolRota = poolTurn(seats, { turn: null, last: {} }, 'check');
    const out = [r.turn];
    for (let i = 1; i < n; i++) {
      r = poolTurn(seats, r, 'pass');
      out.push(r.turn);
    }
    return out;
  };

  it('sozinho na mesa, a vez fica sempre com a mesma pessoa', () => {
    expect(seq([{ id: 'a1', team: 'a' }], 6)).toEqual(Array(6).fill('a1'));
    expect(seq([{ id: 'b1', team: 'b' }], 3)).toEqual(['b1', 'b1', 'b1']);
  });

  it('A1, A2 e B1: o rodízio é A1, B1, A2, B1, A1', () => {
    const seats: PoolSeat[] = [
      { id: 'b1', team: 'b' },
      { id: 'a2', team: 'a' },
      { id: 'a1', team: 'a' },
    ];
    expect(seq(seats, 5)).toEqual(['a1', 'b1', 'a2', 'b1', 'a1']);
  });

  it('nunca dois do mesmo time seguidos quando o outro time tem gente; encaçapou, joga de novo', () => {
    const seats: PoolSeat[] = [
      { id: 'a1', team: 'a' },
      { id: 'a2', team: 'a' },
      { id: 'a3', team: 'a' },
      { id: 'b1', team: 'b' },
      { id: 'b2', team: 'b' },
    ];
    const team = (id: string | null) => seats.find((s) => s.id === id)!.team;
    const order = seq(seats, 12);
    for (let i = 1; i < order.length; i++) expect(team(order[i]!)).not.toBe(team(order[i - 1]!));
    const r = poolTurn(seats, { turn: 'a2', last: {} }, 'keep');
    expect(r.turn).toBe('a2');
  });

  it('quem tinha a vez saiu da mesa: a vez vai para quem ficou', () => {
    const r = poolTurn([{ id: 'b1', team: 'b' }], { turn: 'a1', last: {} }, 'check');
    expect(r.turn).toBe('b1');
  });
});

describe('Espaço 3D: sinuca com a vez por pessoa (PoolPlay)', () => {
  it('sozinho na mesa, errar não tira a vez (treino)', () => {
    const sent: PoolMsg[] = [];
    const p = new PoolPlay(new THREE.Scene(), 'eu', {
      send: (m) => sent.push(m),
      score: () => undefined,
      alive: () => ['eu'],
      players: () => [{ id: 'eu', team: 'a' }],
    });
    p.update(1 / 60, 0, 0);
    expect(p.canShoot('a')).toBe(true);
    p.press('a');
    p.update(0.05, 50, 0);
    // tacada fraquinha para o lado vazio da mesa (não acerta nada)
    p.release(100, 'a', Math.PI);
    for (let i = 0; i < 600 && p.moving; i++) p.update(1 / 60, 100 + i * 16, Math.PI);
    p.update(1 / 60, 20_000, 0);
    expect(p.turnId).toBe('eu');
    expect(p.canShoot('a')).toBe(true);
    expect(sent.at(-1)).toMatchObject({ turnId: 'eu', moving: false });
  });

  it('a vez de outra pessoa (por id) não deixa tacar e mostra o nome', () => {
    const p = new PoolPlay(new THREE.Scene(), 'eu', {
      send: () => undefined,
      score: () => undefined,
      alive: () => ['eu', 'ana'],
      players: () => [
        { id: 'eu', team: 'a' },
        { id: 'ana', team: 'a' },
      ],
      nameOf: () => 'Ana',
    });
    const balls = rack().map((b) => [b.x, b.z, 0] as [number, number, number]);
    p.remote({ balls, turn: 'a', turnId: 'ana', moving: false, t: 2, by: 'ana' }, 0);
    expect(p.canShoot('a')).toBe(false);
    expect(p.prompt('a')).toBe('Vez de Ana');
  });
});

describe('Espaço 3D: lado do time nos jogos de rede e saque automático', () => {
  it('lado pelo time e a rede como parede', () => {
    expect(netSideOf('a')).toBe(-1);
    expect(netSideOf('b')).toBe(1);
    expect(clampToHalf(2, 'a', 0.4)).toBe(-0.4);
    expect(clampToHalf(-3, 'a', 0.4)).toBe(-3);
    expect(clampToHalf(-1, 'b', 0.4)).toBe(0.4);
  });

  it('o vermelho rebate para o lado do azul mesmo parado do lado errado da quadra', () => {
    const s = new SportPlay(
      new THREE.Scene(),
      3,
      'eu',
      { sendBall: () => undefined, score: () => undefined, team: () => 'b' },
      () => null,
    );
    // a bola parada no saque, na frente de quem está em x = -2 (lado azul pela posição)
    s.remote({ x: -2, y: 1.2, z: 0.5, vx: 0, vy: 0, vz: 0, held: null, t: 1, by: 'amigo' }, 0);
    const me = { x: -2, y: 0, z: 0, ry: 0, moving: false, running: false };
    s.update(1 / 60, 10, me);
    expect(s.press(20).result).toBe('hit');
    s.update(1 / 60, 30, me);
    expect(s.mesh.position.x).toBeLessThan(-2);
  });

  it('em jogo, ninguém sacou em 8 s: o saque sai sozinho; na contagem, não', () => {
    const sent: { vx: number }[] = [];
    const s = new SportPlay(
      new THREE.Scene(),
      5,
      'eu',
      { sendBall: (b) => sent.push(b), score: () => undefined, team: () => 'a' },
      () => null,
    );
    const me = { x: -2.5, y: 0, z: 0, ry: Math.PI / 2, moving: false, running: false };
    s.setPhase('countdown', 0);
    s.resetMatch(0);
    s.update(1 / 60, 1, me);
    expect(s.press(2).result).toBe('whiff');
    s.update(1 / 60, AUTO_SERVE_MS + 10, me);
    expect(sent.at(-1)?.vx ?? 0).toBe(0);
    s.setPhase('playing', 3000);
    s.update(1 / 60, 3000 + AUTO_SERVE_MS - 100, me);
    expect(sent.at(-1)?.vx ?? 0).toBe(0);
    s.update(1 / 60, 3000 + AUTO_SERVE_MS + 100, me);
    // sacou para o lado do vermelho (+x)
    expect(sent.at(-1)!.vx).toBeGreaterThan(0);
  });
});
