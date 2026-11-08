import { describe, expect, it } from 'vitest';
import {
  moving,
  POCKETS,
  POOL_HX,
  POOL_HZ,
  POOL_R,
  rack,
  respotCue,
  stepPool,
  type PoolBall,
} from '../src/features/space3d/pool';

const run = (balls: PoolBall[], secs = 12) => {
  const fell: number[] = [];
  for (let t = 0; t < secs && (t === 0 || moving(balls)); t += 1 / 60) fell.push(...stepPool(balls, 1 / 60));
  return fell;
};

describe('Espaço 3D: sinuca', () => {
  it('mesa arrumada: 16 bolas sem se encostar', () => {
    const b = rack();
    expect(b).toHaveLength(16);
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++)
        expect(Math.hypot(b[i]!.x - b[j]!.x, b[i]!.z - b[j]!.z)).toBeGreaterThanOrEqual(POOL_R * 2 - 1e-6);
  });

  it('tacada reta numa bola em direção à caçapa encaçapa; as bolas param', () => {
    const [px, pz] = POCKETS[2]; // canto (+x, -z)
    const target = { x: px - 0.4, z: pz + 0.4 * (POOL_HZ / POOL_HX) };
    const dir = Math.atan2(px - target.x, pz - target.z);
    const cue = {
      x: target.x - Math.sin(dir) * 0.3,
      z: target.z - Math.cos(dir) * 0.3,
      vx: Math.sin(dir) * 2,
      vz: Math.cos(dir) * 2,
      in: false,
    };
    const balls: PoolBall[] = [cue, { ...target, vx: 0, vz: 0, in: false }];
    const fell = run(balls);
    expect(fell).toContain(1);
    expect(moving(balls)).toBe(false);
  });

  it('tabela devolve a bola e ela nunca sai da mesa', () => {
    const balls: PoolBall[] = [{ x: 0, z: 0.2, vx: 0.3, vz: 4, in: false }];
    run(balls, 20);
    expect(Math.abs(balls[0]!.x)).toBeLessThanOrEqual(POOL_HX);
    expect(Math.abs(balls[0]!.z)).toBeLessThanOrEqual(POOL_HZ);
  });

  it('branca na caçapa volta para o lugar', () => {
    const b = rack();
    b[0]!.in = true;
    respotCue(b);
    expect(b[0]!.in).toBe(false);
    expect(b[0]!.x).toBeLessThan(0);
  });
});
