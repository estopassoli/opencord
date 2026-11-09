import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/features/space3d/events';
import { cancelHeld } from '../src/features/space3d/input';
import { PoolPlay } from '../src/features/space3d/pool';
import { SportPlay, type RemoteBall } from '../src/features/space3d/sportplay';
import type { BallState } from '../src/features/space3d/sports';
import type { SportZone } from '@opencord/contracts';

const ME = { x: 0, y: 0, z: 0, ry: Math.PI / 2, moving: false, running: false };

function play(zone: SportZone, alive: string[], emitted: GameEvent[] = []) {
  const sent: (BallState & { held: string | null; t: number })[] = [];
  const hand = { x: 0.3, y: 0.76, z: 0 };
  const s = new SportPlay(
    new THREE.Scene(),
    zone,
    'eu',
    { sendBall: (b) => sent.push(b), score: () => undefined, emit: (e) => emitted.push(e), alive: () => alive },
    (id) => (alive.includes(id) ? hand : null),
  );
  return { s, sent };
}

const ball = (over: Partial<RemoteBall> = {}): RemoteBall => ({
  x: 0,
  y: 1.2,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  held: null,
  t: 1,
  by: 'amigo',
  ...over,
});

describe('Espaço 3D: partida nas arenas (SportPlay)', () => {
  it('bola segura por um peer que sumiu vira bola solta e cai', () => {
    const { s } = play(1, ['eu', 'amigo']);
    s.remote(ball({ held: 'sumido', by: 'amigo', y: 1.4 }), 0);
    expect(s.holder).toBeNull();
    s.update(1 / 60, 10, ME);
    const y0 = s.mesh.position.y;
    for (let i = 1; i < 10; i++) s.update(1 / 60, 10 + i * 16, ME);
    expect(s.mesh.position.y).toBeLessThan(y0);
  });

  it('bola segura por quem manda o estado continua na mão dele', () => {
    const { s } = play(1, ['eu', 'amigo']);
    s.remote(ball({ held: 'amigo', by: 'amigo' }), 0);
    expect(s.holder).toBe('amigo');
  });

  it('quem segurava sumiu no meio: a bola solta e o menor id vivo assume', () => {
    const alive = ['eu', 'amigo'];
    const { s, sent } = play(1, alive);
    s.remote(ball({ held: 'amigo', by: 'amigo', t: 3 }), 0);
    alive.splice(1, 1);
    s.update(1 / 60, 1700, ME);
    expect(s.holder).toBeNull();
    expect(s.mine).toBe(true);
    expect(sent.at(-1)?.t).toBe(4);
  });

  it('dono calado por pouco tempo continua dono', () => {
    const { s } = play(2, ['eu', 'amigo']);
    s.remote(ball({ by: 'amigo', y: 0.11 }), 0);
    s.update(1 / 60, 1000, { ...ME, x: 10 });
    expect(s.mine).toBe(false);
  });

  it('cancelHeld zera a carga do arremesso sem arremessar', () => {
    const { s } = play(1, ['eu']);
    s.remote(ball({ held: 'eu', by: 'amigo' }), 0);
    expect(s.holding).toBe(true);
    s.press(10);
    s.update(0.3, 20, ME);
    expect(s.charging).toBeGreaterThan(0);
    const keys = new Set(['KeyW', 'Mouse0']);
    cancelHeld(keys, [s, null]);
    expect(s.charging).toBeNull();
    expect(keys.size).toBe(0);
    expect(s.holding).toBe(true);
  });

  it('cancelHeld zera a força da tacada', () => {
    const p = new PoolPlay(new THREE.Scene(), 'eu', { send: () => undefined, score: () => undefined });
    p.press('a');
    p.update(0.3, 10, 0);
    expect(p.charging).toBeGreaterThan(0);
    cancelHeld(new Set(), [p]);
    expect(p.charging).toBeNull();
  });

  it('quem observa vê o chute do rival (o contador de toques subiu)', () => {
    const emitted: GameEvent[] = [];
    const { s } = play(2, ['eu', 'amigo'], emitted);
    s.remote(ball({ by: 'amigo', y: 0.11, vx: 9, t: 2 }), 0);
    expect(emitted.find((e) => e.kind === 'kick')).toMatchObject({ kind: 'kick', by: 'amigo', zone: 2 });
    // o mesmo toque chegando de novo não repete o efeito
    s.remote(ball({ by: 'amigo', y: 0.11, vx: 9, t: 2 }), 100);
    expect(emitted.filter((e) => e.kind === 'kick')).toHaveLength(1);
  });

  it('chute longe da bola emite whiff', () => {
    const emitted: GameEvent[] = [];
    const { s } = play(2, ['eu'], emitted);
    s.update(1 / 60, 0, { ...ME, x: 8 });
    expect(s.press(10).result).toBe('whiff');
    expect(emitted.some((e) => e.kind === 'whiff')).toBe(true);
  });
});
