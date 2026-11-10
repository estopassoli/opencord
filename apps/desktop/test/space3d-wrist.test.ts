/**
 * Pulso humano nos braços da primeira pessoa (`arms.ts`): o antebraço pedido pela IK do ombro é girado para dentro do
 * limite do pulso em volta do antebraço que deixaria o pulso reto; dentro do limite, fica como veio. Antes, o braço
 * subia sempre por baixo e o pulso dobrava 80–150° na pegada e mirando (pedido do mantenedor, 2026-11-10).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WRIST_LIMIT, keepElbowDown, limitWrist } from '../src/features/space3d/gunfight/arms';

// o antebraço reto vem de −z para +z (do cotovelo para o pulso), a palma para −y
const STRAIGHT = new THREE.Vector3(0, 0, 1);
const PALM = new THREE.Vector3(0, -1, 0);
const deg = THREE.MathUtils.radToDeg;

/** do pulso para o cotovelo, com o pulso dobrado `a` rad em volta de `axis` */
function bent(axis: THREE.Vector3, a: number) {
  return STRAIGHT.clone().negate().applyAxisAngle(axis, a);
}
const bend = (toElbow: THREE.Vector3) => deg(toElbow.clone().negate().angleTo(STRAIGHT));

describe('limitWrist', () => {
  it('dentro do limite, o antebraço fica como veio', () => {
    const v = bent(new THREE.Vector3(1, 0, 0), 0.3);
    const before = v.clone();
    limitWrist(v, STRAIGHT, PALM, 1);
    expect(v.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('um pulso dobrado 90° volta para o limite, na mesma direção da dobra', () => {
    for (const axis of [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 1, 0).normalize(),
    ]) {
      for (const s of [1, -1] as const) {
        const v = bent(axis, Math.PI / 2);
        const want = v.clone().projectOnPlane(STRAIGHT).normalize();
        limitWrist(v, STRAIGHT, PALM, s);
        expect(v.length()).toBeCloseTo(1, 6);
        expect(bend(v)).toBeLessThanOrEqual(deg(WRIST_LIMIT.flex) + 1e-6);
        expect(bend(v)).toBeGreaterThan(deg(WRIST_LIMIT.radial) - 1e-6);
        // continua dobrado para o mesmo lado (só menos)
        expect(v.clone().projectOnPlane(STRAIGHT).normalize().dot(want)).toBeGreaterThan(0.95);
      }
    }
  });

  it('cada lado do pulso tem o seu limite: mais para a palma que para o dorso, mais para o mindinho que para o polegar', () => {
    // o antebraço para o lado do dorso (+y) = pulso dobrado para a palma
    const flex = limitWrist(bent(new THREE.Vector3(1, 0, 0), -1.4), STRAIGHT, PALM, 1);
    const ext = limitWrist(bent(new THREE.Vector3(1, 0, 0), 1.4), STRAIGHT, PALM, 1);
    expect(flex.y).toBeLessThan(0);
    expect(bend(flex)).toBeCloseTo(deg(WRIST_LIMIT.flex), 3);
    expect(bend(ext)).toBeCloseTo(deg(WRIST_LIMIT.ext), 3);
    // na direita o polegar fica para −x (palma −y, dedos para +z): o antebraço indo para +x é desvio para o polegar
    const radial = limitWrist(bent(new THREE.Vector3(0, 1, 0), 1.4), STRAIGHT, PALM, 1);
    const ulnar = limitWrist(bent(new THREE.Vector3(0, 1, 0), -1.4), STRAIGHT, PALM, 1);
    expect(Math.min(bend(radial), bend(ulnar))).toBeCloseTo(deg(WRIST_LIMIT.radial), 3);
    expect(Math.max(bend(radial), bend(ulnar))).toBeCloseTo(deg(WRIST_LIMIT.ulnar), 3);
    // na esquerda, espelhado: a mesma dobra cai no limite do outro lado
    const mirrored = limitWrist(bent(new THREE.Vector3(0, 1, 0), 1.4), STRAIGHT, PALM, -1);
    expect(bend(mirrored)).toBeCloseTo(bend(ulnar), 3);
  });
});

describe('keepElbowDown', () => {
  it('o cotovelo que o pulso reto mandaria para cima volta para o lado da IK até ficar embaixo', () => {
    // a direita puxando a alavanca: o pulso reto pedia o cotovelo na altura dos olhos, para a direita
    const straight = new THREE.Vector3(0.9, 0.05, 0.4).normalize();
    const ik = new THREE.Vector3(0.3, -0.8, 0.5).normalize();
    const v = keepElbowDown(straight.clone(), ik, -0.02, 1);
    expect(v.length()).toBeCloseTo(1, 6);
    expect(-0.02 + v.y * 0.26).toBeLessThanOrEqual(-0.15 + 1e-3);
    // só o necessário: fica entre o pulso reto e a IK, sem chegar nela
    expect(v.angleTo(straight)).toBeLessThan(ik.angleTo(straight) - 0.05);
    expect(v.angleTo(straight) + v.angleTo(ik)).toBeCloseTo(ik.angleTo(straight), 5);
  });

  it('cotovelo já embaixo e do próprio lado fica onde está', () => {
    const v = new THREE.Vector3(0.4, -0.6, 0.7).normalize();
    const before = v.clone();
    keepElbowDown(v, new THREE.Vector3(0, -1, 0), -0.12, 1);
    expect(v.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('o cotovelo não passa para o outro lado do corpo', () => {
    // esquerda (sign −1): +x é o lado de dentro
    const v = keepElbowDown(
      new THREE.Vector3(0.8, -0.5, 0.3).normalize(),
      new THREE.Vector3(-0.5, -0.7, 0.5).normalize(),
      -0.1,
      -1,
    );
    expect(-v.x).toBeGreaterThanOrEqual(-0.25 - 1e-3);
  });
});
