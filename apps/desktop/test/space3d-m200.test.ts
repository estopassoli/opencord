/**
 * Gunfight do Espaço 3D: as trilhas da M200 na primeira pessoa (ferrolho, inspeção e golpe com a arma) — começam e
 * terminam na pose de repouso (sem pulo entre estados), o ferrolho deita a arma para a esquerda com a alavanca em cima,
 * a inspeção mostra os dois lados sem trazer a arma para perto da câmera e o golpe vai para a frente no acerto.
 */
import { describe, expect, it } from 'vitest';
import { M200_BASH, M200_BOLT, M200_INSPECT, m200Pose, type M200Tracks } from '../src/features/space3d/gunfight/m200';

function at(t: M200Tracks, u: number) {
  const pos = { x: 0, y: 0, z: 0 };
  const rot = { x: 0, y: 0, z: 0 };
  m200Pose(t, u, 1, pos, rot);
  return { pos, rot };
}

const ALL: [string, M200Tracks][] = [
  ['bolt', M200_BOLT],
  ['inspect', M200_INSPECT],
  ['bash', M200_BASH],
];

describe('M200 na primeira pessoa', () => {
  it.each(ALL)('%s começa e termina no repouso', (_, t) => {
    for (const u of [0, 1]) {
      const { pos, rot } = at(t, u);
      for (const v of [pos.x, pos.y, pos.z, rot.x, rot.y, rot.z]) expect(Math.abs(v)).toBeLessThan(1e-9);
    }
  });

  it.each(ALL)('%s anda sem saltos (nenhum passo de 1/60 da ação muda mais que 6 cm ou 0,25 rad)', (_, t) => {
    let prev = at(t, 0);
    for (let i = 1; i <= 60; i++) {
      const now = at(t, i / 60);
      expect(Math.hypot(now.pos.x - prev.pos.x, now.pos.y - prev.pos.y, now.pos.z - prev.pos.z)).toBeLessThan(0.06);
      expect(Math.abs(now.rot.x - prev.rot.x)).toBeLessThan(0.25);
      expect(Math.abs(now.rot.y - prev.rot.y)).toBeLessThan(0.25);
      expect(Math.abs(now.rot.z - prev.rot.z)).toBeLessThan(0.25);
      prev = now;
    }
  });

  it('ferrolho: a arma deita para a esquerda (lado direito para cima) enquanto a mão trabalha a alavanca', () => {
    for (const u of [0.2, 0.45, 0.66]) expect(at(M200_BOLT, u).rot.z).toBeGreaterThan(0.3);
  });

  it('inspeção: um lado e depois o outro, sem a arma vir para perto da câmera', () => {
    expect(at(M200_INSPECT, 0.35).rot.y).toBeGreaterThan(0.5);
    expect(at(M200_INSPECT, 0.7).rot.z).toBeLessThan(-0.8);
    for (let i = 0; i <= 40; i++) expect(at(M200_INSPECT, i / 40).pos.z).toBeLessThan(0.02);
  });

  it('golpe: antecipa para trás e no acerto (32%) a arma está indo para a frente', () => {
    expect(at(M200_BASH, 0.14).pos.z).toBeGreaterThan(0.02);
    expect(at(M200_BASH, 0.32).pos.z).toBeLessThan(-0.15);
  });
});
