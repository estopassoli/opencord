/**
 * Gunfight do Espaço 3D: a Ka-Bar na primeira pessoa — a pegada em martelo na mão dos braços (os dedos fecham no cabo,
 * a palma encosta sem entrar, o indicador logo atrás da guarda e o pomo para fora da mão) e as animações (trilhas e
 * giros começam e terminam na guarda, o giro não dá saltos entre quadros e os golpes cruzam o meio da tela no acerto).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { clearance, fitHand, soupOf, type Soup } from '../src/features/space3d/gunfight/contact';
import { handProbes } from '../src/features/space3d/gunfight/handrig';
import {
  KABAR_GRIP,
  KB_DRAW,
  KB_DRAW_T,
  KB_HEAVY,
  KB_HEAVY_T,
  KB_INSPECT,
  KB_INSPECT_T,
  KB_SLASH_L,
  KB_SLASH_L_T,
  KB_SLASH_R,
  KB_SLASH_R_T,
  turnInto,
  type TurnKey,
} from '../src/features/space3d/gunfight/kabar';
import { track, type KarTracks } from '../src/features/space3d/gunfight/karambit';

const GLB = join(__dirname, '../src/features/space3d/assets/guns/kabar.glb');

function load(): Promise<THREE.Object3D> {
  const buf = readFileSync(GLB);
  // cópia num ArrayBuffer deste ambiente (o do Buffer do Node falha no `instanceof` do GLTFLoader)
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', (g) => ok(g.scene), fail));
}

describe('Ka-Bar — pegada na mão dos braços', () => {
  let soup: Soup;
  beforeAll(async () => {
    // a textura do arquivo não carrega no Node; a malha é o que conta
    const warn = console.warn;
    const error = console.error;
    console.warn = () => undefined;
    console.error = () => undefined;
    try {
      const scene = await load();
      scene.updateMatrixWorld(true);
      soup = soupOf(scene);
    } finally {
      console.warn = warn;
      console.error = error;
    }
  });

  const fit = () => {
    const pos = new THREE.Vector3(...KABAR_GRIP.pos);
    const quat = new THREE.Quaternion(...KABAR_GRIP.quat);
    const [c, t, ix] = KABAR_GRIP.start;
    const f = fitHand(soup, 1, pos, quat, KABAR_GRIP.start, {
      fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
      maxCurl: 1.6,
    });
    const probes = handProbes(1, c, t, ix, f.offsets);
    const gap = (part: string) =>
      clearance(
        soup,
        [],
        probes.filter((p) => p.part === part),
        f.pos,
        quat,
        0.03,
      );
    const z = (part: string) =>
      probes.filter((p) => p.part === part).map((p) => p.at.clone().applyQuaternion(quat).add(f.pos).z);
    return { f, gap, z, curl: [ix + f.offsets[0], c + f.offsets[1], c + f.offsets[2], c + f.offsets[3]] };
  };

  it('a mão fecha no cabo: todos os dedos dobrados em volta dele, sem entrar', () => {
    const { curl, gap } = fit();
    for (const v of curl) expect(v).toBeGreaterThan(0.8);
    for (const part of ['index', 'middle', 'ring', 'pinky', 'thumb', 'palm'])
      expect(gap(part), part).toBeGreaterThan(-0.0005);
  });

  it('a palma encosta no cabo (antes ficava a 1,4 cm, a mão solta em volta dele)', () => {
    expect(fit().gap('palm')).toBeLessThan(0.002);
  });

  it('o indicador fica logo atrás da guarda e o pomo sobra para fora do mindinho', () => {
    const { z } = fit();
    // a guarda vai até z ≈ −0,075; o pomo começa em z ≈ +0,035
    expect(Math.min(...z('index'))).toBeGreaterThan(-0.075);
    expect(Math.min(...z('index'))).toBeLessThan(-0.06);
    expect(Math.max(...z('pinky'))).toBeLessThan(0.03);
  });
});

describe('Ka-Bar — animações', () => {
  const all: [string, KarTracks, readonly TurnKey[]][] = [
    ['saque', KB_DRAW, KB_DRAW_T],
    ['inspeção', KB_INSPECT, KB_INSPECT_T],
    ['golpe de direita', KB_SLASH_R, KB_SLASH_R_T],
    ['golpe de revés', KB_SLASH_L, KB_SLASH_L_T],
    ['pesado', KB_HEAVY, KB_HEAVY_T],
  ];
  const q = (u: number, k: readonly TurnKey[]) => {
    const o = { ex: 0, ey: 0, ez: 0 };
    turnInto(u, k, o);
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(o.ex, o.ey, o.ez, 'ZYX'));
  };

  it('tudo termina na guarda; os golpes e a inspeção também começam nela', () => {
    for (const [name, tr, turn] of all) {
      for (const [key, keys] of Object.entries(tr))
        expect(Math.abs(track(1, keys)), `${name} ${key}`).toBeLessThan(1e-9);
      expect(q(1, turn).angleTo(new THREE.Quaternion()), name).toBeLessThan(1e-6);
      if (name === 'saque') continue;
      for (const [key, keys] of Object.entries(tr))
        expect(Math.abs(track(0, keys)), `${name} ${key}`).toBeLessThan(1e-9);
      expect(q(0, turn).angleTo(new THREE.Quaternion()), name).toBeLessThan(1e-6);
    }
  });

  it('o giro anda sem saltos entre quadros a 60 qps, mesmo virando a faca de face', () => {
    const ms: Record<string, number> = {
      saque: 1000,
      inspeção: 3400,
      'golpe de direita': 480,
      'golpe de revés': 480,
      pesado: 720,
    };
    for (const [name, , turn] of all) {
      const step = 1000 / 60 / ms[name]!;
      // os golpes estalam de propósito (o corte sai do pulso armado: ~2,5 rad em ~150 ms); o saque e a inspeção, não
      const max = name.startsWith('golpe') || name === 'pesado' ? 0.7 : 0.3;
      let prev = q(0, turn);
      for (let u = step; u <= 1; u += step) {
        const now = q(u, turn);
        expect(now.angleTo(prev), `${name} em ${u.toFixed(3)}`).toBeLessThan(max);
        prev = now;
      }
    }
  });

  it('a inspeção vira a faca de face (meia volta) e para em cada uma', () => {
    const faceA = q(0.3, KB_INSPECT_T);
    const faceB = q(0.65, KB_INSPECT_T);
    expect(faceA.angleTo(faceB)).toBeGreaterThan(2.5);
    expect(q(0.22, KB_INSPECT_T).angleTo(q(0.38, KB_INSPECT_T))).toBeLessThan(0.15);
    expect(q(0.57, KB_INSPECT_T).angleTo(q(0.73, KB_INSPECT_T))).toBeLessThan(0.15);
  });

  it('os golpes antecipam para o lado contrário e cruzam o meio da tela no acerto', () => {
    // o punho fica em x ≈ 0,155 na guarda: no acerto ele está perto do meio
    expect(track(0.17, KB_SLASH_R.px)).toBeGreaterThan(0);
    expect(0.155 + track(0.3, KB_SLASH_R.px)).toBeLessThan(0.05);
    expect(track(0.17, KB_SLASH_L.px)).toBeLessThan(-0.15);
    // revés: no acerto o punho está passando pelo lugar da guarda, a lâmina apontando para cima e para o meio
    expect(track(0.3, KB_SLASH_L.px)).toBeGreaterThan(track(0.2, KB_SLASH_L.px));
    expect(0.155 + track(0.3, KB_SLASH_L.px)).toBeLessThan(0.17);
    expect(track(0.31, KB_HEAVY.pz)).toBeGreaterThan(0.05);
    expect(track(0.45, KB_HEAVY.pz)).toBeLessThan(-0.1);
  });
});
