/**
 * Gunfight do Espaço 3D: a kukri na primeira pessoa — o modelo (o fio para baixo, do lado dos nós dos dedos, e o cabo
 * com a grossura de um cabo de verdade), a pegada em martelo na mão dos braços (os quatro dedos fecham no cabo, a palma
 * encosta sem entrar, nada atravessa a faca) e as trilhas das animações (começam e terminam na guarda; nos golpes, a
 * lâmina cruza o meio da tela na hora do acerto, descendo).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARM_HAND_FIT, KUKRI_ARM, handProbes } from '../src/features/space3d/gunfight/handrig';
import { clearance, fitHand, soupOf } from '../src/features/space3d/gunfight/contact';
import { rightGrip } from '../src/features/space3d/gunfight/grips';
import { fileKnife, type GunModel } from '../src/features/space3d/gunfight/models';
import { track } from '../src/features/space3d/gunfight/karambit';
import {
  KUK_CHOP_L,
  KUK_CHOP_R,
  KUK_DRAW,
  KUK_HEAVY,
  KUK_INSPECT,
  KUKRI_POSE,
  type KukTracks,
} from '../src/features/space3d/gunfight/kukri';

const GLB = join(__dirname, '../src/features/space3d/assets/guns/kukri.glb');

async function load(): Promise<THREE.Object3D> {
  const buf = readFileSync(GLB);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const g = await new Promise<{ scene: THREE.Object3D }>((ok, fail) => new GLTFLoader().parse(ab, '', ok, fail));
  return g.scene;
}

/** a caixa de uma peça do modelo no espaço da faca */
function boxOf(g: GunModel, name: string) {
  const o = g.root.getObjectByName(name);
  if (!o) throw new Error(`sem ${name}`);
  g.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

let g: GunModel;
beforeAll(async () => {
  g = fileKnife('kukri', await load());
  g.root.updateMatrixWorld(true);
});

describe('kukri — modelo', () => {
  it('o fio (a faixa clara) fica para baixo, do lado dos nós dos dedos na pegada em martelo', () => {
    const edge = boxOf(g, 'Object_5');
    expect(edge.max.y).toBeLessThan(0);
  });

  it('o cabo tem ~2,6 cm de grossura (o do arquivo tinha 1 cm)', () => {
    const h = boxOf(g, 'Object_6');
    expect(h.max.x - h.min.x).toBeGreaterThan(0.022);
    expect(h.max.x - h.min.x).toBeLessThan(0.03);
  });
});

describe('kukri — pegada na mão dos braços', () => {
  it('os quatro dedos fecham no cabo, a palma encosta sem entrar e nada atravessa a faca', () => {
    const soup = soupOf(g.root);
    const grip = rightGrip(g, 'knife', ARM_HAND_FIT);
    const start: [number, number, number] = [0.3, 0.2, 0.3];
    const fit = fitHand(soup, 1, grip.pos, grip.quat, start, {
      fingers: ['index', 'middle', 'ring', 'pinky'],
      maxCurl: 1.6,
      base: [0, 0, 0, 0, KUKRI_ARM.thumb[0] - start[1], KUKRI_ARM.thumb[1]],
    });
    const o = fit.offsets;
    // indicador, médio, anelar e mindinho fechados (o mindinho, mais curto, fecha menos)
    expect(start[2] + (o[0] ?? 0)).toBeGreaterThan(0.75);
    for (const i of [1, 2]) expect(start[0] + (o[i] ?? 0)).toBeGreaterThan(0.9);
    expect(start[0] + (o[3] ?? 0)).toBeGreaterThan(0.65);
    const probes = handProbes(1, start[0], start[1], start[2], o);
    const gap = (part: string) =>
      clearance(
        soup,
        [],
        probes.filter((p) => p.part === part),
        fit.pos,
        grip.quat,
        0.03,
      );
    expect(gap('palm')).toBeGreaterThan(-0.0005);
    expect(gap('palm')).toBeLessThan(0.006);
    for (const part of ['index', 'middle', 'ring', 'pinky', 'thumb']) expect(gap(part)).toBeGreaterThan(-0.001);
  });
});

describe('kukri — trilhas das animações', () => {
  const all: Record<string, KukTracks> = {
    KUK_DRAW,
    KUK_INSPECT,
    KUK_CHOP_L,
    KUK_CHOP_R,
    KUK_HEAVY,
  };
  it('todas terminam na guarda (e só o saque começa fora dela)', () => {
    for (const [name, t] of Object.entries(all))
      for (const [k, keys] of Object.entries(t)) {
        expect(track(1, keys), `${name}.${k} no fim`).toBeCloseTo(0, 5);
        if (name !== 'KUK_DRAW') expect(track(0, keys), `${name}.${k} no começo`).toBeCloseTo(0, 5);
      }
  });

  /** onde a lâmina (do cabo à ponta) aparece na tela no momento `u`: x/−z e y/−z de cada ponta */
  const guardQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...KUKRI_POSE.rot, 'YXZ'));
  const screen = (t: KukTracks, u: number) => {
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(track(u, t.ex), track(u, t.ey), track(u, t.ez), 'ZYX'))
      .multiply(guardQ);
    const at = KUKRI_POSE.pos.clone().add(new THREE.Vector3(track(u, t.px), track(u, t.py), track(u, t.pz)));
    return [new THREE.Vector3(0, 0, -0.07), new THREE.Vector3(0, -0.08, -0.34)].map((p) => {
      const w = p.applyQuaternion(q).add(at);
      return { x: w.x / -w.z, y: w.y / -w.z };
    });
  };

  it('nos golpes, a lâmina cruza o meio da tela no acerto e desce (a ponta vai para baixo e para a esquerda)', () => {
    for (const [t, hit] of [
      [KUK_CHOP_L, 0.3],
      [KUK_CHOP_R, 0.3],
      [KUK_HEAVY, 0.45],
    ] as const) {
      const [hilt, tip] = screen(t, hit);
      // o meio da tela (x = 0) fica entre o cabo e a ponta, na altura do meio (±0,25)
      expect(hilt!.x).toBeGreaterThan(0);
      expect(tip!.x).toBeLessThan(0);
      const y0 = hilt!.y + ((tip!.y - hilt!.y) * hilt!.x) / (hilt!.x - tip!.x);
      expect(Math.abs(y0)).toBeLessThan(0.25);
      // antecipação: a ponta está mais alta antes do golpe do que depois dele
      const before = screen(t, hit - 0.1)[1]!.y;
      const after = screen(t, hit + 0.12)[1]!.y;
      expect(before).toBeGreaterThan(after);
    }
  });
});
