// Gera `src/features/space3d/gunfight/armsrig.ts` a partir de `src/features/space3d/assets/arms.glb` (feito pelo
// `arms-build.py`): o descanso de cada osso da mão, o tamanho e a grossura de cada falange e a grade da palma, no
// "espaço da mão" do jogo (pulso na origem, dedos para −z, palma para −y, dorso para +y; na direita o indicador em −x).
// Com esses números a mão é medida contra as armas (esferas por falange) sem carregar o arquivo, igual ao que se vê.
//
//   node scripts/arms-rig.mjs
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../src/features/space3d/assets/arms.glb');
const out = join(here, '../src/features/space3d/gunfight/armsrig.ts');
const buf = readFileSync(src);
const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const scene = gltf.scene;
scene.updateMatrixWorld(true);

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const bone = (n) => {
  const b = scene.getObjectByName(n);
  if (!b) throw new Error('sem osso ' + n);
  return b;
};
const wpos = (n) => bone(n).getWorldPosition(new THREE.Vector3());

// vértices em descanso, com o osso dominante
const verts = [];
scene.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  const p = o.geometry.getAttribute('position');
  const si = o.geometry.getAttribute('skinIndex');
  const sw = o.geometry.getAttribute('skinWeight');
  for (let i = 0; i < p.count; i++) {
    let best = -1;
    let bw = 0;
    for (let k = 0; k < 4; k++)
      if (sw.getComponent(i, k) > bw) {
        bw = sw.getComponent(i, k);
        best = si.getComponent(i, k);
      }
    verts.push({
      at: new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld),
      bone: o.skeleton.bones[best].name,
    });
  }
});

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const pct = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0.008;
};

function side(sx) {
  const s = sx > 0 ? '_r' : '_l';
  // espaço da mão no descanso: z do nó do médio para o pulso; x do indicador para o mindinho (na esquerda, o contrário)
  const W = wpos('hand' + s);
  const z = W.clone()
    .sub(wpos('middle1' + s))
    .normalize();
  const x = wpos(sx > 0 ? 'pinky1' + s : 'index1' + s)
    .sub(wpos(sx > 0 ? 'index1' + s : 'pinky1' + s))
    .normalize();
  x.addScaledVector(z, -x.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const HS = new THREE.Matrix4().makeBasis(x, y, z).setPosition(W);
  const HSi = HS.clone().invert();
  const hand = bone('hand' + s);
  const handInHs = HSi.clone().multiply(hand.matrixWorld);
  const hp = new THREE.Vector3();
  const hq = new THREE.Quaternion();
  handInHs.decompose(hp, hq, new THREE.Vector3());

  const names = [];
  for (const f of FINGERS) names.push('palm_' + f, f + '1', f + '2', f + '3');
  names.push('thumb1', 'thumb2', 'thumb3');
  const bones = names.map((n) => {
    const b = bone(n + s);
    const kid = b.children.find((c) => c.isBone);
    const own = verts.filter((v) => v.bone === b.name).map((v) => b.worldToLocal(v.at.clone()));
    // o comprimento: até o filho; na ponta, até o vértice mais longe do osso no sentido do dedo
    let dir;
    let len;
    if (kid) {
      dir = kid.position.clone().normalize();
      len = kid.position.length();
    } else {
      dir = b.position.clone().normalize();
      len = Math.max(...own.map((v) => v.dot(dir)));
    }
    // grossura: distância dos vértices dele até o eixo (só os do meio do segmento)
    const ds = own
      .filter((v) => {
        const t = v.dot(dir) / len;
        return t > 0.2 && t < 0.8;
      })
      .map((v) => v.clone().addScaledVector(dir, -v.dot(dir)).length());
    return {
      name: n,
      parent: b.parent.name.replace(new RegExp(s + '$'), ''),
      pos: b.position.toArray().map(r5),
      quat: b.quaternion.toArray().map(r5),
      dir: dir.toArray().map(r4),
      len: r5(len),
      r: r5(Math.max(0.005, pct(ds, 0.5))),
    };
  });

  // palma: grade em x–z no espaço da mão; em cada ponto, o meio da espessura e a meia espessura
  const palmV = verts
    .filter((v) => v.bone === 'hand' + s || (v.bone.startsWith('palm_') && v.bone.endsWith(s)))
    .map((v) => v.at.clone().applyMatrix4(HSi));
  const xs = palmV.map((v) => v.x);
  const zs = palmV.map((v) => v.z);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
  const palm = [];
  const STEP = 0.011;
  for (let px = x0 + 0.008; px <= x1 - 0.006; px += STEP)
    for (let pz = z0 + 0.006; pz <= z1 - 0.004; pz += STEP) {
      const near = palmV.filter((v) => Math.hypot(v.x - px, v.z - pz) < 0.007);
      if (near.length < 6) continue;
      const lo = Math.min(...near.map((v) => v.y));
      const hi = Math.max(...near.map((v) => v.y));
      if (hi - lo < 0.012) continue;
      palm.push([r4(px), r4((lo + hi) / 2), r4(pz), r4((hi - lo) / 2)]);
    }
  return { hand: { pos: hp.toArray().map(r5), quat: hq.toArray().map(r5) }, bones, palm };
}

const lenOf = (a, b) => r5(wpos(a).distanceTo(wpos(b)));
const data = {
  upper: lenOf('upperarm_r', 'forearm_r'),
  fore: lenOf('forearm_r', 'hand_r'),
  r: side(1),
  l: side(-1),
};

writeFileSync(
  out,
  `/**
 * Gerado por \`scripts/arms-rig.mjs\` a partir de \`assets/arms.glb\` — não editar à mão.
 *
 * O descanso de cada osso da mão (posição e giro em relação ao pai), o sentido e o tamanho de cada osso, a grossura
 * dele e a grade de esferas da palma (x, y, z, raio), no espaço da mão do jogo. \`hand\`: o osso da mão nesse espaço.
 */
export interface ArmBoneRest {
  name: string;
  parent: string;
  pos: [number, number, number];
  quat: [number, number, number, number];
  dir: [number, number, number];
  len: number;
  r: number;
}
export interface ArmSideRest {
  hand: { pos: [number, number, number]; quat: [number, number, number, number] };
  bones: ArmBoneRest[];
  palm: [number, number, number, number][];
}
export const ARM_RIG: { upper: number; fore: number; r: ArmSideRest; l: ArmSideRest } = ${JSON.stringify(data)};
`,
);
process.stdout.write(
  ['ok', out, 'palm', data.r.palm.length, data.l.palm.length, 'upper', data.upper, 'fore', data.fore].join(' ') + '\n',
);
