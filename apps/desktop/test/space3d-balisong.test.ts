/**
 * Gunfight do Espaço 3D: a balisong na primeira pessoa — a pegada na mão dos braços (o punho fecha nos dois cabos, nada
 * da mão passa à frente dos pinos), a mecânica dos giros (o cabo de morder e a lâmina giram para fora, nunca atravessam
 * o cabo seguro, e passam livres da mão com os dedos como o `viewmodel.ts` os põe) e as trilhas das animações (começam e
 * terminam na guarda, aberta; os dedos soltam sempre que ela gira; os golpes cruzam a tela na hora do acerto).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BAL_DRAW,
  BAL_FIT_START,
  BAL_FLIP_CURL,
  BAL_HEAVY,
  BAL_INSPECT,
  BAL_LIFT,
  BAL_SLASH_L,
  BAL_SLASH_R,
  balShift,
  balSpread,
  type BalTracks,
} from '../src/features/space3d/gunfight/balisong';
import { clearance, fitHand, soupOf } from '../src/features/space3d/gunfight/contact';
import { rightGrip } from '../src/features/space3d/gunfight/grips';
import { ARM_HAND_FIT, handProbes } from '../src/features/space3d/gunfight/handrig';
import { track } from '../src/features/space3d/gunfight/karambit';
import { fileKnife, setBalisong, type GunModel } from '../src/features/space3d/gunfight/models';

const GLB = join(__dirname, '../src/features/space3d/assets/guns/balisong.glb');

function load(): Promise<THREE.Object3D> {
  const buf = readFileSync(GLB);
  // cópia num ArrayBuffer deste ambiente (o do Buffer do Node falha no `instanceof` do GLTFLoader)
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', (g) => ok(g.scene), fail));
}

/** a caixa de uma malha no espaço da faca */
function boxOf(g: GunModel, name: string): THREE.Box3 {
  g.root.updateMatrixWorld(true);
  const o = g.root.getObjectByName(name)!;
  return new THREE.Box3().setFromObject(o).applyMatrix4(g.root.matrixWorld.clone().invert());
}

/** pontos ao longo do eixo de uma malha (a linha do meio da caixa dela), no espaço da faca */
function axisOf(g: GunModel, name: string): THREE.Vector3[] {
  const o = g.root.getObjectByName(name) as THREE.Mesh;
  o.geometry.computeBoundingBox();
  const b = o.geometry.boundingBox!;
  const c = b.getCenter(new THREE.Vector3());
  const inv = g.root.matrixWorld.clone().invert();
  const out: THREE.Vector3[] = [];
  for (let k = 0; k <= 24; k++)
    out.push(
      new THREE.Vector3(c.x, c.y, b.min.z + ((b.max.z - b.min.z) * k) / 24)
        .applyMatrix4(o.matrixWorld)
        .applyMatrix4(inv),
    );
  return out;
}

describe('balisong — pegada e giros na mão dos braços', () => {
  let g: GunModel;
  let safe: THREE.Box3;
  beforeAll(async () => {
    g = fileKnife('balisong', await load());
    setBalisong(g, 1);
    safe = boxOf(g, 'safe_mesh');
  }, 30_000);

  /** a pegada como o `setGun` mede: dedos partindo de abertos, todos fecham até encostar */
  const fit = () => {
    const grip = rightGrip(g, 'knife', ARM_HAND_FIT);
    const start: [number, number, number] = [...BAL_FIT_START];
    const f = fitHand(soupOf(g.root), 1, grip.pos, grip.quat, start, {
      fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
      maxCurl: 1.6,
    });
    return { grip, start, f };
  };

  it('o punho fecha nos dois cabos: cada dedo dá a volta e encosta, sem entrar, e a palma encosta', () => {
    const { grip, start, f } = fit();
    const [c, t, ix] = start;
    // índice, médio, anelar, mindinho (o acerto em cima da partida)
    expect(ix + (f.offsets[0] ?? 0)).toBeGreaterThan(0.9);
    for (const i of [1, 2, 3]) expect(c + (f.offsets[i] ?? 0), `dedo ${i}`).toBeGreaterThan(0.95);
    const probes = handProbes(1, c, t, ix, f.offsets);
    const soup = soupOf(g.root);
    for (const part of ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm'] as const) {
      const gap = clearance(
        soup,
        [],
        probes.filter((p) => p.part === part),
        f.pos,
        grip.quat,
        0.02,
      );
      expect(gap, part).toBeGreaterThan(-0.0005);
      expect(gap, part).toBeLessThan(0.003);
    }
  });

  it('nada da mão passa à frente dos pinos (onde começa a lâmina)', () => {
    const { grip, start, f } = fit();
    const probes = handProbes(1, start[0], start[1], start[2], f.offsets).filter((p) => p.part !== 'palm');
    g.root.updateMatrixWorld(true);
    const pins = g.root.getObjectByName('blade')!.getWorldPosition(new THREE.Vector3()).z;
    for (const p of probes) expect(p.at.clone().applyQuaternion(grip.quat).add(f.pos).z - p.r).toBeGreaterThan(pins);
  });

  it('abrindo, o cabo de morder e a lâmina giram para fora e nunca atravessam o cabo seguro', () => {
    for (let u = 0.02; u < 0.99; u += 0.02) {
      setBalisong(g, u);
      g.root.updateMatrixWorld(true);
      const inSafe = (p: THREE.Vector3) =>
        Math.abs(p.x) < safe.max.x && p.y > safe.min.y && p.y < safe.max.y && p.z > safe.min.z + 0.012;
      expect(axisOf(g, 'bite_mesh').filter(inSafe).length, `cabo de morder em ${u.toFixed(2)}`).toBe(0);
      // a lâmina (que só gira na segunda metade) sai do canal do cabo seguro para fora: longe do pino, nunca dentro dele
      if (u < 0.52) continue;
      const blade = axisOf(g, 'blade_mesh').filter((p) => p.z > safe.min.z + 0.02);
      expect(blade.filter(inSafe).length, `lâmina em ${u.toFixed(2)}`).toBe(0);
    }
    setBalisong(g, 1);
  });

  it('a volta inteira passa livre da mão (dedos soltos, polegar fechado, a faca descolada da palma)', () => {
    const grip = rightGrip(g, 'knife', ARM_HAND_FIT);
    for (let u = 0; u <= 1.0001; u += 0.025) {
      const shut = 1 - u;
      setBalisong(g, u);
      g.root.updateMatrixWorld(true);
      // só o que gira (a lâmina e o cabo de morder, preso nela)
      const soup = soupOf(g.root, undefined, g.flip!.blade);
      const s = 1 - balSpread(shut);
      const probes = handProbes(1, BAL_FLIP_CURL.fingers * s, BAL_FLIP_CURL.thumb, BAL_FLIP_CURL.index * s);
      // a mão no espaço da faca: a faca desce `balShift` e descola `BAL_LIFT` (a mão vai o contrário)
      const at = grip.pos.clone().sub(new THREE.Vector3(BAL_LIFT, balShift(shut), 0));
      for (const part of ['palm', 'index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
        const gap = clearance(
          soup,
          [],
          probes.filter((p) => p.part === part),
          at,
          grip.quat,
          0.02,
        );
        expect(gap, `${part} em ${u.toFixed(3)}`).toBeGreaterThan(-0.0005);
      }
    }
    setBalisong(g, 1);
  });

  it('fechada, a pilha desce na mão o tanto que fica fora do lugar dos cabos abertos', () => {
    setBalisong(g, 0);
    const closed = boxOf(g, 'safe_mesh').union(boxOf(g, 'bite_mesh'));
    setBalisong(g, 1);
    const open = boxOf(g, 'safe_mesh').union(boxOf(g, 'bite_mesh'));
    const mid = (b: THREE.Box3) => (b.min.y + b.max.y) / 2;
    expect(mid(closed) + balShift(1) - mid(open)).toBeCloseTo(0, 3);
    expect(Math.abs(balShift(0))).toBe(0);
  });
});

describe('balisong — trilhas das animações', () => {
  const all: [string, BalTracks][] = [
    ['saque', BAL_DRAW],
    ['inspeção', BAL_INSPECT],
    ['golpe da direita', BAL_SLASH_R],
    ['revés', BAL_SLASH_L],
    ['pesado', BAL_HEAVY],
  ];

  it('toda animação termina na guarda, aberta e de dedos fechados', () => {
    for (const [name, tr] of all)
      for (const [key, keys] of Object.entries(tr))
        expect(Math.abs(track(1, keys)), `${name} ${key}`).toBeLessThan(1e-9);
  });

  it('o saque começa fechado e a inspeção começa aberta; os golpes não fecham a faca', () => {
    expect(track(0, BAL_DRAW.shut)).toBe(1);
    expect(track(0, BAL_INSPECT.shut)).toBe(0);
    for (const tr of [BAL_SLASH_R, BAL_SLASH_L, BAL_HEAVY]) {
      expect(tr.shut).toBeUndefined();
      for (const keys of Object.values(tr)) expect(Math.abs(track(0, keys))).toBeLessThan(1e-9);
    }
  });

  it('os dedos estão soltos sempre que ela gira (e fecham quando ela trava aberta)', () => {
    for (const tr of [BAL_DRAW, BAL_INSPECT]) {
      let checked = 0;
      for (let u = 0; u <= 1; u += 0.005) {
        const prev = track(Math.max(0, u - 0.005), tr.shut);
        const now = track(u, tr.shut);
        if (Math.abs(now - prev) > 1e-6) {
          expect(track(u, tr.open), `u ${u.toFixed(3)}`).toBeGreaterThan(0.99);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10);
    }
  });

  it('os golpes armam para o lado contrário e estão cruzando a tela na hora do acerto', () => {
    // leve: o acerto sai em 30%; pesado, em 45%
    expect(track(0.16, BAL_SLASH_R.px)).toBeGreaterThan(0);
    expect(track(0.3, BAL_SLASH_R.px)).toBeLessThan(-0.15);
    expect(track(0.16, BAL_SLASH_L.px)).toBeLessThan(-0.2);
    expect(track(0.3, BAL_SLASH_L.px)).toBeGreaterThan(track(0.16, BAL_SLASH_L.px) + 0.1);
    expect(track(0.32, BAL_HEAVY.pz)).toBeGreaterThan(0);
    expect(track(0.45, BAL_HEAVY.pz)).toBeLessThan(-0.05);
    expect(track(0.45, BAL_HEAVY.px)).toBeLessThan(-0.1);
  });
});
