/**
 * Gunfight do Espaço 3D: a karambit na primeira pessoa — a pegada na mão dos braços (o indicador atravessa a argola, o
 * anelar e o mindinho fecham no cabo, a palma encosta sem entrar), o giro no indicador (a volta inteira passa livre da
 * mão com a argola escorregada para fora) e as trilhas das animações (começam e terminam na guarda, o giro termina em
 * voltas inteiras, os golpes cruzam o meio da tela na hora do acerto).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARM_HAND_FIT, handProbes } from '../src/features/space3d/gunfight/handrig';
import { clearance, fitHand, soupOf } from '../src/features/space3d/gunfight/contact';
import { rightGrip } from '../src/features/space3d/gunfight/grips';
import { knife } from '../src/features/space3d/gunfight/models';
import {
  KAR_DRAW,
  KAR_HEAVY,
  KAR_INSPECT,
  KAR_SLASH_L,
  KAR_SLASH_R,
  KAR_SLIDE,
  KAR_SPIN_CURL,
  track,
  type KarTracks,
} from '../src/features/space3d/gunfight/karambit';

/** a argola do modelo: centro, eixo (o furo) e o raio do furo */
function ringOf(root: THREE.Object3D) {
  let ring: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!ring && o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry) ring = o;
  });
  const r = ring as THREE.Mesh | null;
  if (!r) throw new Error('sem argola');
  const p = (r.geometry as THREE.TorusGeometry).parameters;
  return { at: r.position.clone(), axis: new THREE.Vector3(1, 0, 0), hole: p.radius - p.tube };
}

describe('karambit — pegada na mão dos braços', () => {
  const g = knife('karambit');
  g.root.updateMatrixWorld(true);
  const soup = soupOf(g.root);
  const grip = rightGrip(g, 'knife', ARM_HAND_FIT);
  const [c, t, ix] = grip.curl;
  const fit = fitHand(soup, 1, grip.pos, grip.quat, grip.curl, { fingers: ['ring', 'pinky', 'thumb'], maxCurl: 1.6 });
  const probes = handProbes(1, c, t, ix, fit.offsets);
  const toKnife = (v: THREE.Vector3) => v.clone().applyQuaternion(grip.quat).add(fit.pos);
  const ring = ringOf(g.root);

  it('o indicador atravessa a argola (cruza o plano dela por dentro do furo)', () => {
    const idx = probes.filter((p) => p.part === 'index');
    let best = Infinity;
    for (let i = 0; i + 1 < idx.length; i++) {
      const a = toKnife(idx[i]!.at);
      const b = toKnife(idx[i + 1]!.at);
      if ((a.x - ring.at.x) * (b.x - ring.at.x) > 0 || a.x === b.x) continue;
      const x = a.lerp(b, (ring.at.x - a.x) / (b.x - a.x));
      best = Math.min(best, Math.hypot(x.y - ring.at.y, x.z - ring.at.z) + idx[i]!.r);
    }
    expect(best).toBeLessThan(ring.hole + 0.001);
  });

  it('anelar e mindinho fecham no cabo e a palma encosta sem entrar', () => {
    expect(c + (fit.offsets[2] ?? 0)).toBeGreaterThan(0.7);
    expect(c + (fit.offsets[3] ?? 0)).toBeGreaterThan(0.7);
    const palm = clearance(
      soup,
      [],
      probes.filter((p) => p.part === 'palm'),
      fit.pos,
      grip.quat,
      0.02,
    );
    expect(palm).toBeGreaterThan(-0.0005);
    expect(palm).toBeLessThan(0.008);
    for (const part of ['ring', 'pinky', 'thumb'] as const) {
      const gap = clearance(
        soup,
        [],
        probes.filter((p) => p.part === part),
        fit.pos,
        grip.quat,
        0.02,
      );
      expect(gap, part).toBeGreaterThan(-0.0005);
    }
  });

  it('a volta inteira no indicador passa livre da mão (argola escorregada, dedos soltos)', () => {
    // a mão como fica girando: dedos de baixo abertos, polegar fechado, indicador mais dobrado, sem os acertos
    const open = handProbes(1, KAR_SPIN_CURL.fingers, KAR_SPIN_CURL.thumb, KAR_SPIN_CURL.index);
    const slide = new THREE.Vector3(...KAR_SLIDE).normalize().multiplyScalar(0.03);
    const pivot = ring.at.clone();
    const q = new THREE.Quaternion();
    const inv = new THREE.Matrix4();
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      q.setFromAxisAngle(ring.axis, -a);
      const at = pivot.clone().sub(pivot.clone().applyQuaternion(q)).add(slide);
      inv.compose(at, q, new THREE.Vector3(1, 1, 1)).invert();
      for (const part of ['palm', 'middle', 'ring', 'pinky', 'thumb', 'index'] as const) {
        const local = open.filter((p) => p.part === part).map((p) => ({ at: toKnife(p.at).applyMatrix4(inv), r: p.r }));
        const gap = clearance(soup, [], local, new THREE.Vector3(), new THREE.Quaternion(), 0.02);
        expect(gap, `${part} a ${Math.round((a * 180) / Math.PI)}°`).toBeGreaterThan(-0.001);
      }
    }
  });
});

describe('karambit — trilhas das animações', () => {
  const all: [string, KarTracks][] = [
    ['saque', KAR_DRAW],
    ['inspeção', KAR_INSPECT],
    ['golpe da direita', KAR_SLASH_R],
    ['golpe puxado', KAR_SLASH_L],
    ['pesado', KAR_HEAVY],
  ];

  it('a trilha interpola entre as chaves e segura as pontas', () => {
    const k = [
      [0, 0],
      [0.5, 1, 1],
      [1, 0],
    ] as const;
    expect(track(-1, k)).toBe(0);
    expect(track(0.5, k)).toBe(1);
    expect(track(2, k)).toBe(0);
    // de 0 a 0,5 a curva suave; de 0,5 a 1 a curva 1 (golpe): sai rápido, já passou da metade no primeiro quarto
    expect(track(0.25, k)).toBeCloseTo(0.5, 5);
    expect(track(0.625, k)).toBeLessThan(0.5);
    expect(track(0.75, k)).toBeCloseTo(0.125, 5);
  });

  it('toda animação termina na guarda (giro em voltas inteiras, sem pulo na volta)', () => {
    for (const [name, tr] of all) {
      for (const [key, keys] of Object.entries(tr)) {
        const end = track(1, keys);
        if (key === 'spin')
          expect(Math.abs(end / (Math.PI * 2) - Math.round(end / (Math.PI * 2))), name).toBeLessThan(1e-9);
        else expect(Math.abs(end), `${name} ${key}`).toBeLessThan(1e-9);
      }
    }
  });

  it('os golpes começam na guarda e estão cruzando o meio da tela na hora do acerto', () => {
    for (const tr of [KAR_SLASH_R, KAR_SLASH_L, KAR_HEAVY])
      for (const keys of Object.values(tr)) expect(Math.abs(track(0, keys))).toBeLessThan(1e-9);
    // o punho parte de x ≈ 0,12 na guarda: no acerto ele está entre o meio da tela e a guarda, já descendo/andando
    expect(track(0.3, KAR_SLASH_R.px)).toBeLessThan(-0.08);
    expect(track(0.3, KAR_SLASH_L.py)).toBeLessThan(track(0.2, KAR_SLASH_L.py));
    expect(track(0.45, KAR_HEAVY.px)).toBeLessThan(-0.08);
    // antecipação: antes do corte o braço vai para o lado contrário
    expect(track(0.18, KAR_SLASH_R.px)).toBeGreaterThan(0);
    expect(track(0.33, KAR_HEAVY.py)).toBeGreaterThan(0);
  });

  it('o saque e a inspeção giram a faca com os dedos soltos e a argola escorregada', () => {
    for (const tr of [KAR_DRAW, KAR_INSPECT]) {
      let checked = 0;
      for (let u = 0; u <= 1; u += 0.01) {
        const spin = track(u, tr.spin);
        const end = track(1, tr.spin);
        if (Math.abs(spin) > 0.05 && Math.abs(spin - end) > 0.05) {
          expect(track(u, tr.open)).toBeGreaterThan(0.99);
          expect(track(u, tr.slide)).toBeGreaterThan(0.029);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(5);
    }
  });
});
