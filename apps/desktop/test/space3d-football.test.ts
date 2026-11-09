/** Futebol do Espaço 3D (2026-11-09): dominar, chutar forte e fraco, dribles, bicicleta, desarme e falta. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/features/space3d/events';
import {
  CONTROL_MAX_SPEED,
  FOOT_KICK,
  SportPlay,
  tackleCall,
  type RemoteBall,
} from '../src/features/space3d/sportplay';

type P = { x: number; z: number; ry: number; a?: number };

function field(poses: Record<string, P> = {}) {
  const emitted: GameEvent[] = [];
  const tackles: { by: string; on: string; foul: boolean }[] = [];
  const sent: { ev?: unknown }[] = [];
  const teams: Record<string, 'a' | 'b'> = { eu: 'a', ana: 'b', bia: 'a' };
  const s = new SportPlay(
    new THREE.Scene(),
    2,
    'eu',
    {
      sendBall: (b) => sent.push(b),
      score: () => undefined,
      emit: (e) => emitted.push(e),
      alive: () => ['eu', 'ana', 'bia'],
      team: () => 'a',
      teamOf: (id) => teams[id],
      poseOf: (id) => poses[id] ?? null,
      onTackle: (e) => tackles.push(e),
    },
    // pé de quem domina: à frente dele, no chão
    (id) => {
      const p = poses[id];
      return p ? { x: p.x + Math.sin(p.ry) * 0.4, y: 0.11, z: p.z + Math.cos(p.ry) * 0.4 } : null;
    },
  );
  return { s, emitted, tackles, sent };
}

const me = (over: Partial<{ x: number; z: number; ry: number; aim: number; moving: boolean }> = {}) => ({
  x: 0,
  y: 0,
  z: 0,
  ry: 0,
  moving: true,
  running: false,
  aim: 0,
  speed: 3.2,
  ...over,
});

const remote = (over: Partial<RemoteBall> = {}): RemoteBall => ({
  x: 0,
  y: 0.11,
  z: 0.3,
  vx: 0,
  vy: 0,
  vz: 0,
  held: null,
  t: 5,
  by: 'ana',
  ...over,
});

/** a bola solta parada no meu pé */
function ballAtFeet(s: SportPlay, over: Partial<RemoteBall> = {}) {
  s.remote(remote({ held: null, ...over }), 0);
}

describe('futebol: domínio e chutes', () => {
  it('encostar andando domina: a bola fica com quem encostou (sem chutar)', () => {
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 } };
    const { s, emitted } = field(poses);
    ballAtFeet(s, { vz: 0.5 });
    s.update(1 / 60, 1000, me());
    expect(s.holder).toBe('eu');
    expect(emitted.some((e) => e.kind === 'control')).toBe(true);
    expect(emitted.some((e) => e.kind === 'kick' && e.by === 'eu')).toBe(false);
  });

  it('bola muito rápida não é dominada: bate no pé e desvia', () => {
    const { s } = field({ eu: { x: 0, z: 0, ry: 0 } });
    ballAtFeet(s, { vz: -(CONTROL_MAX_SPEED + 3) });
    s.update(1 / 60, 1000, me());
    expect(s.holder).toBeNull();
  });

  it('com a bola: esquerdo chuta forte e direito passa, para onde a câmera olha', () => {
    for (const strong of [true, false]) {
      const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 } };
      const { s, sent } = field(poses);
      ballAtFeet(s);
      s.update(1 / 60, 1000, me());
      expect(s.holder).toBe('eu');
      const r = s.footPress(1100, strong);
      expect(r).toEqual({ result: 'hit', move: 'kick' });
      expect(s.holder).toBeNull();
      const last = sent.at(-1) as { vx: number; vz: number };
      const v = Math.hypot(last.vx, last.vz);
      expect(v).toBeCloseTo(strong ? FOOT_KICK.strong.v : FOOT_KICK.weak.v, 1);
      // câmera olhando para +z (aim 0)
      expect(last.vz).toBeGreaterThan(0);
    }
  });

  it('logo depois do chute não domina de novo (a bola sai do pé)', () => {
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 } };
    const { s } = field(poses);
    ballAtFeet(s);
    s.update(1 / 60, 1000, me());
    s.footPress(1100, false);
    s.update(1 / 60, 1116, me());
    expect(s.holder).toBeNull();
  });
});

describe('futebol: dribles e bicicleta', () => {
  it('pular com a bola faz a carretilha: a bola sobe e sai do pé, e o lance vai junto do estado', () => {
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 } };
    const { s, emitted, sent } = field(poses);
    ballAtFeet(s);
    s.update(1 / 60, 1000, me());
    expect(s.footJump(1100)).toBe(true);
    expect(s.holder).toBeNull();
    const last = sent.at(-1) as { vy: number; vz: number; ev?: { kind: string } };
    expect(last.vy).toBeGreaterThan(5);
    expect(last.vz).toBeGreaterThan(0);
    expect(last.ev?.kind).toBe('carretilha');
    expect(emitted.some((e) => e.kind === 'trick' && e.trick === 'carretilha')).toBe(true);
  });

  it('sem a bola, pular é só pular', () => {
    const { s } = field({ eu: { x: 0, z: 0, ry: 0 } });
    expect(s.footJump(1000)).toBe(false);
  });

  it('bola alta perto + esquerdo = bicicleta', () => {
    const { s, emitted } = field({ eu: { x: 0, z: 0, ry: 0 } });
    s.update(1 / 60, 900, me());
    s.remote(remote({ y: 1.7, z: 0.6, vy: 0 }), 950);
    s.update(0, 1000, me());
    const r = s.footPress(1000, true);
    expect(r.move).toBe('bike');
    expect(emitted.some((e) => e.kind === 'trick' && e.trick === 'bicicleta')).toBe(true);
  });

  it('com a bola, interagir faz o elástico', () => {
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 } };
    const { s } = field(poses);
    ballAtFeet(s);
    s.update(1 / 60, 1000, me());
    expect(s.footInteract(1100)).toBe('elastico');
    expect(s.holder).toBe('eu');
  });
});

describe('futebol: desarme e falta', () => {
  it('pegou a bola de frente: desarme; por trás ou na perna: falta', () => {
    // a pessoa olha para −z; o lance vem de frente (dir +z... contra ela) ou por trás
    expect(tackleCall({ x: 0, z: 1 }, Math.PI, true)).toBe('clean');
    expect(tackleCall({ x: 0, z: 1 }, 0, true)).toBe('foul');
    expect(tackleCall({ x: 0, z: 1 }, Math.PI, false)).toBe('foul');
  });

  it('bote de frente rouba a bola de quem é do outro time', () => {
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 }, ana: { x: 0, z: 1, ry: Math.PI } };
    const { s, tackles, sent } = field(poses);
    s.remote(remote({ held: 'ana', x: 0, z: 0.6 }), 0);
    s.update(1 / 60, 1000, me());
    expect(s.footInteract(1100)).toBe('kick');
    expect(s.holder).toBe('eu');
    expect(tackles).toEqual([{ by: 'eu', on: 'ana', foul: false }]);
    expect((sent.at(-1) as { ev?: unknown }).ev).toEqual({ kind: 'tackle', on: 'ana' });
  });

  it('no elástico ninguém desarma', () => {
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 }, ana: { x: 0, z: 1, ry: Math.PI, a: 14 } };
    const { s, tackles } = field(poses);
    s.remote(remote({ held: 'ana', x: 0, z: 0.6 }), 0);
    s.update(1 / 60, 1000, me());
    expect(s.footInteract(1100)).toBeNull();
    expect(tackles).toEqual([]);
  });

  it('companheiro de time não é desarmado', () => {
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 }, bia: { x: 0, z: 1, ry: Math.PI } };
    const { s } = field(poses);
    s.remote(remote({ held: 'bia', by: 'bia', x: 0, z: 0.6 }), 0);
    s.update(1 / 60, 1000, me());
    expect(s.footInteract(1100)).toBeNull();
  });

  it('carrinho por trás é falta: a bola fica com quem sofreu', () => {
    // ana corre para +z (de costas para mim) com a bola à frente dela
    const poses: Record<string, P> = { eu: { x: 0, z: 0, ry: 0 }, ana: { x: 0, z: 1.2, ry: 0 } };
    const { s, tackles } = field(poses);
    s.remote(remote({ held: 'ana', x: 0, z: 1.6 }), 0);
    s.update(1 / 60, 1000, me({ moving: true }));
    expect(s.footPress(1000, false).move).toBe('slide');
    // o carrinho anda (a cena empurra o boneco): chega na perna dela
    s.update(1 / 60, 1100, me({ z: 0.6 }));
    expect(tackles).toEqual([{ by: 'eu', on: 'ana', foul: true }]);
    expect(s.holder).toBe('ana');
  });

  it('quem sofreu a falta fica sabendo pelo estado (e cai na cena)', () => {
    const { s, tackles, emitted } = field({ eu: { x: 0, z: 0, ry: 0 }, ana: { x: 1, z: 0, ry: 0 } });
    s.remote(remote({ held: 'eu', by: 'ana', t: 9, ev: { kind: 'foul', on: 'eu' } }), 0);
    expect(tackles).toEqual([{ by: 'ana', on: 'eu', foul: true }]);
    expect(emitted.some((e) => e.kind === 'tackle' && e.foul)).toBe(true);
    expect(s.holder).toBe('eu');
  });
});
