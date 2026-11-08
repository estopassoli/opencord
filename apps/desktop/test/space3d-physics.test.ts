import { generateSpace, type SpaceLayout } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { obstaclesOf, PLAYER_R, resolve } from '../src/features/space3d/physics';

const room = (patch: Partial<SpaceLayout> = {}): SpaceLayout => ({
  v: 1,
  theme: 'lounge',
  width: 10,
  depth: 10,
  floorColor: '#6b4f3a',
  wallColor: '#d9cbb8',
  walls: [],
  items: [],
  spawn: { x: 0, z: 0 },
  ...patch,
});

describe('Espaço 3D: colisão', () => {
  it('não sai do piso', () => {
    const o = obstaclesOf(room());
    const p = resolve(o, 50, -50);
    expect(p.x).toBeCloseTo(5 - PLAYER_R);
    expect(p.z).toBeCloseTo(-5 + PLAYER_R);
  });

  it('parede empurra para o lado de onde veio', () => {
    const o = obstaclesOf(room({ walls: [{ x1: -5, z1: 0, x2: 5, z2: 0, h: 3 }] }));
    expect(resolve(o, 1, 0.1).z).toBeGreaterThan(0.4);
    expect(resolve(o, 1, -0.1).z).toBeLessThan(-0.4);
  });

  it('não atravessa um sofá girado; tapete não bloqueia', () => {
    const o = obstaclesOf(
      room({
        items: [
          { id: 'a', kind: 'sofa', x: 0, z: 0, rot: Math.PI / 2 },
          { id: 'b', kind: 'rug', x: 3, z: 3, rot: 0 },
        ],
      }),
    );
    // girado 90°, o sofá ocupa ~0,95 m em x e 2,2 m em z: o centro dele não é alcançável
    const p = resolve(o, 0, 0.5);
    expect(Math.abs(p.x)).toBeGreaterThanOrEqual(0.95 / 2 + PLAYER_R - 0.01);
    expect(resolve(o, 3, 3)).toEqual({ x: 3, z: 3 });
  });

  it('a entrada dos ambientes gerados é livre', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const l = generateSpace(`01a1bc36-b28d-73b0-b5f9-7da770e67a6${id}`);
      const p = resolve(obstaclesOf(l), l.spawn.x, l.spawn.z);
      expect(Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z)).toBeLessThan(0.01);
    }
  });
});
