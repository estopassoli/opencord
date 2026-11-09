import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AUTHORITY_SILENCE_MS, nextAuthority } from '../src/features/space3d/net/authority';
import { PoolPlay, rack, type PoolMsg } from '../src/features/space3d/pool';
import type { GameEvent } from '../src/features/space3d/events';

describe('Espaço 3D: troca de autoridade (ADR-0056)', () => {
  it('dono presente e falando continua dono', () => {
    expect(nextAuthority(['eu', 'dono'], 'dono', 1000, 1000 + AUTHORITY_SILENCE_MS)).toBe('dono');
  });

  it('dono saiu da zona: assume o menor id vivo', () => {
    expect(nextAuthority(['m', 'c', 'x'], 'dono', 1000, 1100)).toBe('c');
  });

  it('dono calado por 1,6 s: assume o menor id vivo (que não é ele)', () => {
    expect(nextAuthority(['b', 'a', 'z'], 'a', 0, 1600)).toBe('b');
    expect(nextAuthority(['b', 'a', 'z'], 'a', 0, 1400)).toBe('a');
  });

  it('empate de ids: todos os apps escolhem o mesmo, em qualquer ordem da lista', () => {
    const lists = [
      ['bb', 'aa', 'cc'],
      ['cc', 'bb', 'aa'],
      ['aa', 'aa', 'cc', 'bb'],
    ];
    for (const l of lists) expect(nextAuthority(l, 'zz', 0, 5000)).toBe('aa');
  });

  it('sem ninguém para assumir: fica com o dono se ainda está; sem dono, nada', () => {
    expect(nextAuthority(['dono'], 'dono', 0, 9000)).toBe('dono');
    expect(nextAuthority([], 'dono', 0, 9000)).toBeNull();
    expect(nextAuthority(['eu'], null, 0, 9000)).toBeNull();
  });
});

function pool(alive: string[], emitted: GameEvent[] = []) {
  const sent: PoolMsg[] = [];
  const p = new PoolPlay(new THREE.Scene(), 'eu', {
    send: (m) => sent.push(m),
    score: () => undefined,
    emit: (e) => emitted.push(e),
    alive: () => alive,
  });
  return { p, sent };
}

const msg = (over: Partial<PoolMsg> = {}): PoolMsg & { by: string } => ({
  balls: rack().map((b) => [b.x, b.z, 0] as [number, number, number]),
  turn: 'b',
  moving: true,
  t: 1,
  by: 'amigo',
  ...over,
});

describe('Espaço 3D: sinuca com o dono sumido', () => {
  it('quem observa guarda o "rolando" do dono e não deixa tacar', () => {
    const { p } = pool(['eu', 'amigo']);
    p.remote(msg({ turn: 'a', moving: true }), 0);
    expect(p.canShoot('a')).toBe(false);
    expect(p.prompt('a')).toBe('Bolas rolando…');
    p.remote(msg({ turn: 'a', moving: false, t: 1 }), 100);
    expect(p.canShoot('a')).toBe(true);
  });

  it('autoridade esquecida no meio da tacada: o update assume e termina a tacada', () => {
    const emitted: GameEvent[] = [];
    const { p, sent } = pool(['eu'], emitted);
    p.remote(msg({ turn: 'b', moving: true }), 0);
    expect(p.canShoot('a')).toBe(false);
    // 1,6 s sem notícia e o dono nem está mais na zona
    p.update(1 / 60, 1600, 0);
    expect(p.moving).toBe(false);
    // nada caiu: a vez passa para o outro time, e o novo estado sai para todos
    expect(p.turn).toBe('a');
    expect(p.canShoot('a')).toBe(true);
    const last = sent.at(-1)!;
    expect(last).toMatchObject({ moving: false, turn: 'a' });
    expect(last.t).toBeGreaterThan(1);
  });

  it('caçapa de quem simula aparece para quem observa', () => {
    const emitted: GameEvent[] = [];
    const { p } = pool(['eu', 'amigo'], emitted);
    p.remote(msg({ moving: true }), 0);
    const balls = rack().map((b) => [b.x, b.z, 0] as [number, number, number]);
    balls[3] = [balls[3]![0], balls[3]![1], 1];
    p.remote(msg({ moving: true, balls }), 100);
    expect(emitted.filter((e) => e.kind === 'pocket')).toMatchObject([{ ball: 3 }]);
    expect(emitted.some((e) => e.kind === 'cue')).toBe(true);
  });
});
