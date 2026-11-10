/**
 * Gunfight do Espaço 3D: a baioneta M9 na primeira pessoa — a pegada em martelo na mão dos braços (os quatro dedos
 * fecham no cabo, o polegar por cima, a palma encosta sem entrar, nada na frente da guarda, o fio para o lado dos nós),
 * a guarda (fio para baixo, antebraço vindo de baixo à direita), o floreio (a volta inteira passa livre da mão aberta) e
 * as trilhas das animações (começam e terminam na guarda; os golpes cruzam o meio da tela na hora do acerto).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARM_HAND_FIT, BAYONET_ARM, handProbes } from '../src/features/space3d/gunfight/handrig';
import { clearance, soupOf } from '../src/features/space3d/gunfight/contact';
import { rightGrip } from '../src/features/space3d/gunfight/grips';
import { M9, knife } from '../src/features/space3d/gunfight/models';
import {
  BAY_DRAW,
  BAY_HEAVY,
  BAY_INSPECT,
  BAY_OPEN,
  BAY_POSE,
  BAY_SLASH_L,
  BAY_SLASH_R,
  BAY_TOSS,
} from '../src/features/space3d/gunfight/bayonet';
import { track, type KarTracks } from '../src/features/space3d/gunfight/karambit';

describe('baioneta — pegada em martelo na mão dos braços', () => {
  const g = knife('bayonet');
  g.root.updateMatrixWorld(true);
  const soup = soupOf(g.root);
  const grip = rightGrip(g, 'knife', ARM_HAND_FIT);
  const [c, t, ix] = grip.curl;
  // como o `viewmodel.ts` aplica: o fechamento do indicador e o acerto do médio, do anelar e do mindinho
  const off = [
    0,
    BAYONET_ARM.curl[1] - c,
    BAYONET_ARM.curl[2] - c,
    BAYONET_ARM.curl[3] - c,
    0,
    BAYONET_ARM.thumbUp,
  ] as const;
  const probes = handProbes(1, c, t, ix, off);
  const gap = (part: string) =>
    clearance(
      soup,
      [],
      probes.filter((p) => p.part === part),
      grip.pos,
      grip.quat,
      0.03,
    );

  it('usa a pegada medida (não a conta do martelo da mão de cápsulas)', () => {
    expect(grip.pos.toArray()).toEqual(BAYONET_ARM.pos);
  });

  it('os quatro dedos e o polegar fecham no cabo, encostados, sem entrar', () => {
    for (const k of BAYONET_ARM.curl.slice(0, 4)) expect(k).toBeGreaterThan(0.8);
    expect(BAYONET_ARM.curl[4]).toBeGreaterThan(0.5);
    for (const part of ['index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
      const d = gap(part);
      expect(d, part).toBeGreaterThan(-0.0005);
      expect(d, part).toBeLessThan(0.003);
    }
    const palm = gap('palm');
    expect(palm).toBeGreaterThan(-0.0005);
    expect(palm).toBeLessThan(0.004);
  });

  it('nenhum dedo fica na frente da guarda (o indicador encosta atrás dela)', () => {
    let minZ = Infinity;
    for (const p of probes) {
      if (p.part === 'palm') continue;
      minZ = Math.min(minZ, p.at.clone().applyQuaternion(grip.quat).add(grip.pos).z - p.r);
    }
    expect(minZ).toBeGreaterThan(M9.guardBack - 0.001);
    expect(minZ).toBeLessThan(M9.guardBack + 0.006);
  });

  it('o fio fica do lado dos nós dos dedos e o dorso do lado do pulso', () => {
    // os dedos (−z da mão) apontam para o fio (−y da faca)
    const fingers = new THREE.Vector3(0, 0, -1).applyQuaternion(grip.quat);
    expect(fingers.y).toBeLessThan(-0.8);
  });

  it('na guarda o fio fica para baixo, a face para a câmera e o antebraço vem de baixo à direita', () => {
    const K = new THREE.Quaternion().setFromEuler(new THREE.Euler(...BAY_POSE.rot, 'YXZ'));
    const spine = new THREE.Vector3(0, 1, 0).applyQuaternion(K);
    const face = new THREE.Vector3(1, 0, 0).applyQuaternion(K);
    const blade = new THREE.Vector3(0, 0, -1).applyQuaternion(K);
    expect(spine.y).toBeGreaterThan(0.5);
    expect(blade.y).toBeGreaterThan(0.3);
    expect(blade.x).toBeLessThan(0);
    expect(Math.abs(face.dot(BAY_POSE.pos.clone().normalize()))).toBeGreaterThan(0.7);
    const fore = BAY_POSE.fore.clone().applyQuaternion(K.multiply(grip.quat));
    // do cotovelo ao pulso: para a frente e para a esquerda, sem descer (o cotovelo não fica acima da mão)
    expect(fore.z).toBeLessThan(-0.7);
    expect(fore.x).toBeLessThan(0);
    expect(fore.y).toBeGreaterThan(-0.15);
  });

  it('no floreio a volta inteira passa livre da mão aberta (a faca sai para fora da palma)', () => {
    const open = handProbes(1, BAY_OPEN.fingers, BAY_OPEN.thumb, BAY_OPEN.index);
    const slide = new THREE.Vector3(...BAY_TOSS).normalize().multiplyScalar(track(0.7, BAY_INSPECT.slide));
    const pivot = g.handle!.clone();
    const axis = new THREE.Vector3(1, 0, 0);
    const q = new THREE.Quaternion();
    const inv = new THREE.Matrix4();
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      q.setFromAxisAngle(axis, -a);
      const at = pivot.clone().sub(pivot.clone().applyQuaternion(q)).add(slide);
      inv.compose(at, q, new THREE.Vector3(1, 1, 1)).invert();
      for (const part of ['palm', 'index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
        const local = open
          .filter((p) => p.part === part)
          .map((p) => ({ at: p.at.clone().applyQuaternion(grip.quat).add(grip.pos).applyMatrix4(inv), r: p.r }));
        const d = clearance(soup, [], local, new THREE.Vector3(), new THREE.Quaternion(), 0.02);
        expect(d, `${part} a ${Math.round((a * 180) / Math.PI)}°`).toBeGreaterThan(0.002);
      }
    }
  });
});

describe('baioneta — trilhas das animações', () => {
  const all: [string, KarTracks][] = [
    ['saque', BAY_DRAW],
    ['inspeção', BAY_INSPECT],
    ['golpe da direita', BAY_SLASH_L],
    ['golpe de volta', BAY_SLASH_R],
    ['pesado', BAY_HEAVY],
  ];

  it('toda animação termina na guarda (giro em voltas inteiras)', () => {
    for (const [name, tr] of all) {
      for (const [key, keys] of Object.entries(tr)) {
        const end = track(1, keys);
        if (key === 'spin')
          expect(Math.abs(end / (Math.PI * 2) - Math.round(end / (Math.PI * 2))), name).toBeLessThan(1e-9);
        else expect(Math.abs(end), `${name} ${key}`).toBeLessThan(1e-9);
      }
    }
  });

  it('os golpes começam na guarda, antecipam para o lado contrário e cruzam a tela no acerto', () => {
    for (const tr of [BAY_SLASH_L, BAY_SLASH_R, BAY_HEAVY])
      for (const keys of Object.values(tr)) expect(Math.abs(track(0, keys))).toBeLessThan(1e-9);
    // corte da direita: arma à direita, no acerto (30%) já foi para a esquerda
    expect(track(0.18, BAY_SLASH_L.px)).toBeGreaterThan(0);
    expect(track(0.3, BAY_SLASH_L.px)).toBeLessThan(-0.05);
    // corte de volta: arma à esquerda, no acerto anda para a direita
    expect(track(0.18, BAY_SLASH_R.px)).toBeLessThan(-0.1);
    expect(track(0.34, BAY_SLASH_R.px)).toBeGreaterThan(track(0.2, BAY_SLASH_R.px) + 0.1);
    // pesado: recua (z para a câmera) e estoca para a frente e para o meio no acerto (45%)
    expect(track(0.34, BAY_HEAVY.pz)).toBeGreaterThan(0.03);
    expect(track(0.45, BAY_HEAVY.pz)).toBeLessThan(-0.12);
    expect(track(0.45, BAY_HEAVY.px)).toBeLessThan(-0.05);
  });

  it('a faca só gira na inspeção com a mão aberta e ela fora da palma', () => {
    let checked = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      const spin = track(u, BAY_INSPECT.spin);
      const end = track(1, BAY_INSPECT.spin);
      if (Math.abs(spin) > 0.05 && Math.abs(spin - end) > 0.05) {
        expect(track(u, BAY_INSPECT.open)).toBeGreaterThan(0.99);
        expect(track(u, BAY_INSPECT.slide)).toBeGreaterThan(0.044);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});
