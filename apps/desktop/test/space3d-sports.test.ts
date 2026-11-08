import { describe, expect, it } from 'vitest';
import {
  ARENAS,
  basketShot,
  GOAL_X,
  HOOP_X,
  lob,
  stepBall,
  type BallEvent,
  type BallState,
} from '../src/features/space3d/sports';

function run(zone: 1 | 2 | 3, b: BallState, secs: number, from?: { x: number; y: number; z: number }) {
  const ev: BallEvent[] = [];
  for (let t = 0; t < secs; t += 1 / 60) ev.push(...stepBall(ARENAS[zone], b, 1 / 60, from));
  return ev;
}

describe('Espaço 3D: esportes', () => {
  it('basquete: força na faixa boa faz cesta de 2 perto e de 3 de longe; fraca demais erra', () => {
    for (const [x, pts] of [
      [HOOP_X - 4, 2],
      [HOOP_X - 8, 3],
    ] as const) {
      const from = { x, y: 2, z: 0.5 };
      const v = basketShot(from, 0.7, Math.PI / 2);
      const b = { ...from, ...v };
      const score = run(1, b, 4, from).find((e) => e.kind === 'score');
      expect(score).toEqual({ kind: 'score', side: 'a', points: pts });
    }
    const from = { x: HOOP_X - 6, y: 2, z: 0 };
    const b = { ...from, ...basketShot(from, 0.1, Math.PI / 2) };
    expect(run(1, b, 4, from).some((e) => e.kind === 'score')).toBe(false);
  });

  it('basquete: arremesso para o outro lado vale para o time B', () => {
    const from = { x: -HOOP_X + 4, y: 2, z: 0 };
    const b = { ...from, ...basketShot(from, 0.65, -Math.PI / 2) };
    expect(run(1, b, 4, from).find((e) => e.kind === 'score')).toMatchObject({ side: 'b' });
  });

  it('futebol: chute no meio do gol é gol; na trave volta', () => {
    const b = { x: GOAL_X - 6, y: 0.11, z: 0, vx: 14, vy: 1, vz: 0 };
    expect(run(2, b, 2).find((e) => e.kind === 'score')).toEqual({ kind: 'score', side: 'a', points: 1 });
    const post = { x: GOAL_X - 6, y: 0.11, z: 2.6, vx: 14, vy: 0, vz: 0 };
    expect(run(2, post, 2).some((e) => e.kind === 'score')).toBe(false);
  });

  it('tênis: bola baixa para na rede; bola por cima passa', () => {
    const low = { x: -3, y: 0.5, z: 0, vx: 10, vy: 0, vz: 0 };
    expect(run(3, low, 1).some((e) => e.kind === 'net')).toBe(true);
    expect(low.x).toBeLessThan(0.5);
    const from = { x: -8, y: 1, z: 0 };
    const high = { ...from, ...lob(from, { x: 8, y: 0.08, z: 1 }, 2) };
    const ev = run(3, high, 3);
    expect(ev.some((e) => e.kind === 'net')).toBe(false);
    const bounce = ev.find((e) => e.kind === 'bounce');
    expect(bounce && bounce.kind === 'bounce' ? bounce.x : 0).toBeCloseTo(8, 0);
  });

  it('a bola nunca sai da arena', () => {
    const b = { x: 0, y: 1, z: 0, vx: 50, vy: 2, vz: -45 };
    run(2, b, 5);
    expect(Math.abs(b.x)).toBeLessThanOrEqual(ARENAS[2].layout.width / 2);
    expect(Math.abs(b.z)).toBeLessThanOrEqual(ARENAS[2].layout.depth / 2);
  });
});

describe('Espaço 3D: quem fica com a bola', () => {
  it('toque mais novo (contador) ganha, sem depender do relógio de cada PC', async () => {
    const { acceptBall } = await import('../src/features/space3d/sportplay');
    expect(acceptBall(5, 'amigo', 4, 'eu')).toBe(true);
    expect(acceptBall(3, 'amigo', 4, 'eu')).toBe(false);
    // empate: os dois apps escolhem o mesmo (maior id), e quem já mandava continua
    expect(acceptBall(4, 'zz', 4, 'aa')).toBe(true);
    expect(acceptBall(4, 'aa', 4, 'zz')).toBe(false);
    expect(acceptBall(4, 'aa', 4, 'aa')).toBe(true);
    expect(acceptBall(0, 'aa', 0, null)).toBe(true);
  });
});

describe('Espaço 3D: vôlei e ping pong', () => {
  it('regras de ponto', async () => {
    const { netPoint } = await import('../src/features/space3d/sportplay');
    // vôlei: A bateu; caiu dentro do lado B → ponto A; caiu dentro do lado A → ponto B; fora → ponto B
    expect(netPoint(4, 'a', { x: 3, z: 0, surface: 'floor' }, 0)).toBe('a');
    expect(netPoint(4, 'a', { x: -3, z: 0, surface: 'floor' }, 0)).toBe('b');
    expect(netPoint(4, 'a', { x: 12, z: 0, surface: 'floor' }, 0)).toBe('b');
    // ping pong: A bateu; quicou na mesa do B uma vez → conta; duas → ponto A; no chão sem quicar na mesa → ponto B
    expect(netPoint(5, 'a', { x: 0.8, z: 0, surface: 'table' }, 0)).toBe('bounce');
    expect(netPoint(5, 'a', { x: 0.8, z: 0, surface: 'table' }, 1)).toBe('a');
    expect(netPoint(5, 'a', { x: 3, z: 0, surface: 'floor' }, 0)).toBe('b');
    expect(netPoint(5, 'a', { x: 3, z: 0, surface: 'floor' }, 1)).toBe('a');
    expect(netPoint(5, 'a', { x: -0.8, z: 0, surface: 'table' }, 0)).toBe('b');
  });

  it('a bolinha quica na mesa e o lob passa por cima da rede', () => {
    const from = { x: -1.6, y: 0.95, z: 0 };
    const to = { x: 0.9, y: 0.76 + 0.025, z: 0.2 };
    const b = { ...from, ...lob(from, to, 0.25) };
    const ev = run(5, b, 1.5);
    expect(ev.some((e) => e.kind === 'net')).toBe(false);
    const first = ev.find((e) => e.kind === 'bounce');
    expect(first).toMatchObject({ surface: 'table' });
    const vfrom = { x: -6, y: 1.6, z: 0 };
    const vb = { ...vfrom, ...lob(vfrom, { x: 4, y: 0.11, z: 1 }, 1.6) };
    expect(run(4, vb, 3).some((e) => e.kind === 'net')).toBe(false);
  });
});
