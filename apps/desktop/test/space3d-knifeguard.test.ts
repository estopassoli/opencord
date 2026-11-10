/**
 * Gunfight do Espaço 3D: a mão esquerda de guarda das facas (`knifeguard.ts`), a mesma em todas — meio punho relaxado
 * (as pontas dos dedos encostando na palma sem entrar, o polegar deitado ao lado do indicador, sem o anel do "OK") e o
 * pulso reto na linha do antebraço, venha ele de onde vier.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { handProbes, type Probe } from '../src/features/space3d/gunfight/handrig';
import { KNIFE_GUARD, knifeGuardQuat } from '../src/features/space3d/gunfight/knifeguard';

const G = KNIFE_GUARD;
const probes = handProbes(-1, G.curl, G.thumb, G.index, G.off);
const part = (p: string) => probes.filter((x) => x.part === p);
const tip = (p: string) => part(p)[part(p).length - 1]!;
const gap = (a: Probe, b: Probe) => a.at.distanceTo(b.at) - a.r - b.r;
const minGap = (as: Probe[], bs: Probe[]) => Math.min(...as.flatMap((a) => bs.map((b) => gap(a, b))));

describe('faca — mão esquerda de guarda', () => {
  it('o indicador fecha como os outros dedos (não vira o dedo do gatilho)', () => {
    expect(G.index).toBeGreaterThanOrEqual(G.curl);
  });

  it('as pontas dos quatro dedos encostam na palma sem entrar (punho fechado, sem garra)', () => {
    const palm = part('palm');
    for (const f of ['index', 'middle', 'ring', 'pinky']) {
      const g = minGap([tip(f)], palm);
      expect(g, f).toBeGreaterThan(-0.0015);
      expect(g, f).toBeLessThan(0.004);
    }
  });

  it('o polegar fica deitado ao lado do indicador, longe da ponta do médio (sem o anel do "OK")', () => {
    expect(minGap(part('thumb'), part('index'))).toBeLessThan(0.01);
    expect(tip('thumb').at.distanceTo(tip('middle').at)).toBeGreaterThan(0.04);
    expect(tip('thumb').at.distanceTo(tip('index').at)).toBeGreaterThan(0.03);
  });

  it('o pulso fica reto (≤ 20°) e o dorso para o lado pedido, com o antebraço em qualquer direção', () => {
    const q = new THREE.Quaternion();
    const back = new THREE.Vector3(...G.back).normalize();
    for (const f of [
      [0.6, 0.8, -0.2],
      [0.3, 0.4, -0.85],
      [0.1, 0.95, 0.1],
      [0.5, 0.2, -0.8],
    ] as const) {
      const fore = new THREE.Vector3(...f).normalize();
      knifeGuardQuat(fore, q);
      const fingers = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      expect((fingers.angleTo(fore) * 180) / Math.PI).toBeLessThan(20);
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).dot(back)).toBeGreaterThan(0);
    }
  });
});
