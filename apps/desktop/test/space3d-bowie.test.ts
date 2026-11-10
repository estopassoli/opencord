/**
 * Gunfight do Espaço 3D: a Bowie na primeira pessoa — a pegada medida na mão dos braços (`BOWIE_ARM`: martelo, os
 * dedos fechados em volta do cabo de 1,6 × 4 cm logo atrás da guarda, sem entrar nele) e as trilhas das animações
 * (começam e terminam na guarda, os golpes saem de uma antecipação para o lado oposto e cruzam a tela no acerto). O
 * .glb não carrega no teste: o cabo e a guarda são caixas com as medidas do modelo (`bowie.glb`).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARM_HAND_FIT, BOWIE_ARM, handProbes } from '../src/features/space3d/gunfight/handrig';
import { clearance, soupOf } from '../src/features/space3d/gunfight/contact';
import { rightGrip } from '../src/features/space3d/gunfight/grips';
import {
  BOWIE_DRAW,
  BOWIE_HEAVY,
  BOWIE_INSPECT,
  BOWIE_SLASH_L,
  BOWIE_SLASH_R,
} from '../src/features/space3d/gunfight/bowie';
import { track, type KarTracks } from '../src/features/space3d/gunfight/karambit';

/** cabo (z de −0,07 a 0,07; 1,6 cm de grossura) e guarda (2 × 6,4 cm, logo à frente do cabo) */
function bowieHandle() {
  const root = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  // o cabo afina perto da guarda (3,4 cm de altura nos primeiros 3,5 cm; 4,2 cm no resto)
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.034, 0.035, 2, 4, 4), mat);
  front.position.set(0, 0.001, -0.0525);
  const rest = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.042, 0.105, 2, 4, 10), mat);
  rest.position.z = 0.0175;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.064, 0.013, 2, 4, 2), mat);
  guard.position.z = -0.0755;
  root.add(front, rest, guard);
  root.updateMatrixWorld(true);
  return root;
}

describe('Bowie — pegada na mão dos braços', () => {
  const root = bowieHandle();
  const soup = soupOf(root);
  const grip = rightGrip({ id: 'bowie', handle: new THREE.Vector3() }, 'knife', ARM_HAND_FIT);
  const c = BOWIE_ARM.curl;
  const off = [0, c[1] - 0.5, c[2] - 0.5, c[3] - 0.5, 0, c[5]] as const;
  const probes = handProbes(1, grip.curl[0], grip.curl[1], grip.curl[2], off);
  const gap = (part: string) =>
    clearance(
      soup,
      [],
      probes.filter((p) => p.part === part),
      grip.pos,
      grip.quat,
      0.05,
    );

  it('usa a pegada medida (e não a conta da baioneta) só na mão dos braços', () => {
    expect(grip.pos.toArray()).toEqual([...BOWIE_ARM.pos]);
    expect(grip.curl).toEqual([0.5, c[4], c[0]]);
    const capsule = rightGrip({ id: 'bowie', handle: new THREE.Vector3() }, 'knife');
    expect(capsule.pos.distanceTo(grip.pos)).toBeGreaterThan(0.001);
  });

  it('cada dedo encosta no cabo sem entrar (nenhum fica aberto, pendurado ao lado)', () => {
    // as caixas têm cantos vivos (o cabo do modelo tem as quinas arredondadas: medido no .glb, nenhum dedo entra e o pior vão é de ~1 cm, na base do médio, por baixo do fio)
    for (const part of ['index', 'middle', 'ring', 'pinky']) {
      const g = gap(part);
      expect(g, part).toBeGreaterThan(-0.004);
      expect(g, part).toBeLessThan(0.004);
    }
    // a palma encosta na lateral direita e o polegar fecha por cima do indicador, sem entrar no cabo nem na guarda
    expect(gap('palm')).toBeGreaterThan(-0.003);
    expect(gap('palm')).toBeLessThan(0.006);
    expect(gap('thumb')).toBeGreaterThan(-0.003);
  });

  it('os dedos dão a volta: as pontas ficam na lateral esquerda do cabo, a palma na direita', () => {
    const tip = (part: string) => {
      const l = probes.filter((p) => p.part === part);
      return l[l.length - 1]!.at.clone().applyQuaternion(grip.quat).add(grip.pos);
    };
    for (const part of ['index', 'middle', 'ring']) expect(tip(part).x, part).toBeLessThan(-0.008);
    const palm = probes
      .filter((p) => p.part === 'palm')
      .map((p) => p.at.clone().applyQuaternion(grip.quat).add(grip.pos));
    expect(palm.reduce((a, p) => a + p.x, 0) / palm.length).toBeGreaterThan(0.008);
    // o indicador logo atrás da guarda (a mão fechada encostada nela)
    expect(tip('index').z).toBeGreaterThan(-0.069);
    expect(tip('index').z).toBeLessThan(-0.03);
  });
});

describe('Bowie — trilhas das animações', () => {
  const all: [string, KarTracks][] = [
    ['saque', BOWIE_DRAW],
    ['inspeção', BOWIE_INSPECT],
    ['leve (direita)', BOWIE_SLASH_R],
    ['leve (revés)', BOWIE_SLASH_L],
    ['pesado', BOWIE_HEAVY],
  ];

  it('terminam na guarda; os golpes, a inspeção e o pesado também começam nela', () => {
    for (const [name, t] of all)
      for (const k of Object.keys(t) as (keyof KarTracks)[]) {
        expect(Math.abs(track(1, t[k])), `${name} ${k}`).toBeLessThan(1e-6);
        if (t !== BOWIE_DRAW) expect(Math.abs(track(0, t[k])), `${name} ${k}`).toBeLessThan(1e-6);
      }
  });

  it('o saque vem de baixo com a lâmina para baixo e gira para a guarda', () => {
    expect(track(0, BOWIE_DRAW.py)).toBeLessThan(-0.2);
    expect(track(0, BOWIE_DRAW.ez)).toBeGreaterThan(2);
  });

  it('os golpes leves antecipam para um lado e cruzam para o outro até o acerto (30%)', () => {
    const at = (t: KarTracks, u: number) => track(u, t.px);
    expect(at(BOWIE_SLASH_R, 0.2)).toBeGreaterThan(0.03);
    expect(at(BOWIE_SLASH_R, 0.34)).toBeLessThan(-0.1);
    expect(at(BOWIE_SLASH_L, 0.2)).toBeLessThan(-0.05);
    expect(at(BOWIE_SLASH_L, 0.34)).toBeGreaterThan(0.02);
  });

  it('o revés mostra o arco a 60 Hz: nenhum quadro pula metade do corte e ≥ 2 quadros passam pelo meio', () => {
    // golpe leve de 560 ms; o corte vai da antecipação (0,2) ao acerto (0,33)
    const tick = 1000 / 60 / 560;
    const a = track(0.2, BOWIE_SLASH_L.px);
    const b = track(0.33, BOWIE_SLASH_L.px);
    const frac: number[] = [];
    for (let u = 0.2; u <= 0.33 + 1e-9; u += tick) frac.push((track(u, BOWIE_SLASH_L.px) - a) / (b - a));
    for (let i = 1; i < frac.length; i++) expect(frac[i]! - frac[i - 1]!).toBeLessThan(0.4);
    expect(frac.filter((f) => f > 0.25 && f < 0.8).length).toBeGreaterThanOrEqual(2);
    // a lâmina vem de deitada para a esquerda até em pé (gira com o braço, não fica para trás)
    expect(track(0.33, BOWIE_SLASH_L.ez) - track(0.2, BOWIE_SLASH_L.ez)).toBeLessThan(-1.2);
  });

  it('o pesado arma no alto, segura um instante e desce depois do acerto (45%)', () => {
    expect(track(0.33, BOWIE_HEAVY.py)).toBeGreaterThan(0.08);
    expect(track(0.36, BOWIE_HEAVY.py) - track(0.3, BOWIE_HEAVY.py)).toBeLessThan(0.02);
    expect(track(0.5, BOWIE_HEAVY.px)).toBeLessThan(-0.1);
  });
});
