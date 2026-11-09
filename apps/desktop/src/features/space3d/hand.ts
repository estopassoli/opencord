/**
 * Mão com dedos (bonecos e primeira pessoa): palma, quatro dedos de três falanges e polegar de duas, cada falange uma
 * cápsula girando na junta. `setCurl` fecha os dedos (0 aberta, 1 punho fechado) — em volta do punho da arma, da faca
 * ou do guarda-mão. Medidas de mão adulta (m); o boneco usa a mesma mão em escala.
 *
 * Espaço da mão: o pulso na origem, a palma e os dedos para −z, a palma virada para −y, o dorso para +y. Na mão
 * direita (`side` 1) o indicador e o polegar ficam em −x (o mindinho em +x); na esquerda, espelhado. O polegar sai da
 * lateral da palma do lado do indicador, apontando para a frente e para dentro, com a polpa virada para os dedos
 * (oposição): fechando, ele vem por cima dos dedos.
 *
 * Desempenho: as 18 peças são juntadas numa geometria só por pose de dedos (uma chamada de desenho por mão, sem sombra).
 * As poses ficam num cache compartilhado por todas as mãos (os bonecos seguram as armas com as mesmas poses).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FINGERS = [
  // x na palma (do indicador ao mindinho), comprimentos das 3 falanges
  { x: 0.027, len: [0.042, 0.026, 0.022] },
  { x: 0.009, len: [0.046, 0.029, 0.023] },
  { x: -0.009, len: [0.043, 0.027, 0.022] },
  { x: -0.026, len: [0.034, 0.021, 0.019] },
];
const THUMB = [0.036, 0.03];
const R = 0.0085;
/** passo do cache de poses (curl e polegar arredondados) e quantas poses guardar no máximo */
const STEP = 0.05;
const CACHE_MAX = 160;

/**
 * Centro do vão dos dedos fechados (onde passa um cabo), no espaço da mão, com os dedos em ~0,95. Medido na malha da
 * mão: o ponto do plano y–z mais longe de qualquer vértice, cercado por cima, por baixo, pela frente e por trás
 * (cabe um cabo de ~1,2 cm de raio). As pegadas de faca encaixam o centro do cabo aqui.
 */
export const FIST_HOLE = new THREE.Vector3(0, -0.029, -0.046);
export const FIST_CURL = 0.95;

/**
 * Acerto de cada dedo em cima do fechamento (somado ao `curl`): indicador, médio, anelar, mindinho e polegar. Vem do
 * encaixe medido na arma (`gunfight/contact.ts`): cada dedo fecha até encostar na superfície, sem entrar nela.
 */
export type FingerOffsets = readonly [number, number, number, number, number];
const NO_OFFSETS: FingerOffsets = [0, 0, 0, 0, 0];
/** passo dos acertos por dedo (mais fino que o do curl: 0,05 de curl anda ~1 cm na ponta do dedo) */
const OFF_STEP = 0.01;

export interface Hand {
  root: THREE.Group;
  /**
   * fecha os dedos (0–1); o polegar fecha junto, um pouco menos. `index` é o indicador à parte (no gatilho, ~0,4; na
   * argola da karambit, fechado); sem ele, o indicador fecha como os outros
   */
  setCurl(c: number, thumb?: number, index?: number, offsets?: FingerOffsets): void;
  dispose(): void;
}

/** o esqueleto da mão (só juntas, sem malha) e onde vai cada peça */
interface Rig {
  root: THREE.Group;
  joints: THREE.Object3D[][];
  thumbBase: THREE.Object3D;
  thumb: THREE.Object3D[];
  /** peça → geometria base (compartilhada) */
  pieces: { at: THREE.Object3D; geo: THREE.BufferGeometry }[];
}

let shared: {
  palm: THREE.BufferGeometry;
  wrist: THREE.BufferGeometry;
  caps: Map<string, THREE.BufferGeometry>;
} | null = null;
function geos() {
  shared ??= {
    palm: new THREE.SphereGeometry(1, 16, 12),
    wrist: new THREE.SphereGeometry(1, 12, 10),
    caps: new Map(),
  };
  return shared;
}
function capsule(r: number, len: number): THREE.BufferGeometry {
  const g = geos();
  const key = `${r.toFixed(5)}:${len.toFixed(5)}`;
  let c = g.caps.get(key);
  if (!c) {
    c = new THREE.CapsuleGeometry(r, len, 3, 8).rotateX(Math.PI / 2);
    g.caps.set(key, c);
  }
  return c;
}

function buildRig(side: 1 | -1): Rig {
  const root = new THREE.Group();
  const g = geos();
  const pieces: Rig['pieces'] = [];
  // palma arredondada (uma esfera achatada) e o volume do pulso
  const palm = new THREE.Object3D();
  palm.scale.set(0.043, 0.017, 0.05);
  palm.position.set(0, 0, -0.046);
  root.add(palm);
  pieces.push({ at: palm, geo: g.palm });
  const wrist = new THREE.Object3D();
  wrist.scale.set(0.03, 0.02, 0.03);
  wrist.position.set(0, 0, -0.008);
  root.add(wrist);
  pieces.push({ at: wrist, geo: g.wrist });
  // cada dedo: uma corrente de juntas; a falange vai de 0 até −len no z da junta
  const joints: THREE.Object3D[][] = [];
  const mirror = side;
  for (const f of FINGERS) {
    const chain: THREE.Object3D[] = [];
    let parent: THREE.Object3D = root;
    for (let i = 0; i < 3; i++) {
      const j = new THREE.Group();
      // direita: indicador em −x
      j.position.set(i === 0 ? f.x * -mirror : 0, i === 0 ? 0.002 : 0, i === 0 ? -0.088 : -f.len[i - 1]!);
      const ph = new THREE.Object3D();
      ph.position.z = -f.len[i]! / 2;
      j.add(ph);
      pieces.push({ at: ph, geo: capsule(R * (1 - i * 0.08), f.len[i]! - R * 1.4) });
      parent.add(j);
      chain.push(j);
      parent = j;
    }
    joints.push(chain);
  }
  // polegar: do lado do indicador, perto do pulso, apontando para a frente e para dentro, polpa para os dedos
  const thumbBase = new THREE.Group();
  thumbBase.position.set(0.036 * -mirror, -0.008, -0.03);
  root.add(thumbBase);
  const thumb: THREE.Object3D[] = [];
  let tp: THREE.Object3D = thumbBase;
  for (const [i, len] of THUMB.entries()) {
    const j = new THREE.Group();
    if (i > 0) j.position.z = -THUMB[0]!;
    const ph = new THREE.Object3D();
    ph.position.z = -len / 2;
    j.add(ph);
    pieces.push({ at: ph, geo: capsule(R * 1.15, len - R * 1.4) });
    tp.add(j);
    thumb.push(j);
    tp = j;
  }
  return { root, joints, thumbBase, thumb, pieces };
}

/** quanto cada junta dobra com o dedo fechado (base, meio e ponta, rad por unidade de `curl`) */
const BEND = [1.35, 1.55, 1.1] as const;
/**
 * Indicador separado dos outros (no gatilho): a base quase reta, ao longo da armação, e o meio dobrado para a polpa
 * da ponta encostar na lâmina (dedo de gatilho de verdade, que não enrola no punho); a base abre para o lado do
 * polegar, o que leva o dedo para cima do guarda-mato no punho inclinado. Medido com a ponta na lâmina
 * (`grips.ts`, `TRIGGER_CURL`).
 */
const TRIGGER_BEND = [0.3, 2.2, 1.1] as const;
const TRIGGER_SPLAY = 0.8;

/** põe as juntas na pose (`c` dedos, `t` polegar, `ix` indicador) */
export function poseRig(rig: Rig, side: 1 | -1, c: number, t: number, ix = c, off: FingerOffsets = NO_OFFSETS) {
  // o indicador vira "dedo de gatilho" quando fica mais aberto que os outros (0,05 já basta: o aperto não desmonta)
  const split = Math.max(0, Math.min(1, (c - ix) / 0.05));
  // dobra para o lado da palma (−y): girar em −x leva o −z para −y
  rig.joints.forEach((chain, f) => {
    const cf = Math.max(0, (f === 0 ? ix : c) + off[f]!);
    const sp = f === 0 ? split : 0;
    chain.forEach((j, i) => (j.rotation.x = -cf * (BEND[i]! * (1 - sp) + TRIGGER_BEND[i]! * sp)));
    chain[0]!.rotation.y = sp * TRIGGER_SPLAY * side;
  });
  // oposição (gira no próprio eixo para a polpa olhar os dedos), aponta para dentro e desce para a palma ao fechar
  // aberta, o polegar abre para fora do indicador (~30°); fechando, cruza por cima dos dedos
  t = Math.max(0, t + off[4]);
  rig.thumbBase.rotation.set(-t * 0.5, 0.55 * side, 0.8 * side, 'XYZ');
  rig.thumb[0]!.rotation.y = -t * 1.3 * side;
  rig.thumb[1]!.rotation.x = -t * 0.9;
}

/** de qual parte da mão é uma sonda (dedos na ordem do indicador ao mindinho) */
export type ProbePart = 'palm' | 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export interface Probe {
  part: ProbePart;
  /** falange (0 base, 1 meio, 2 ponta; na palma, o número da esfera) */
  seg: number;
  /** centro no espaço da mão e o raio da superfície ali */
  at: THREE.Vector3;
  r: number;
}
const FINGER_PART: ProbePart[] = ['index', 'middle', 'ring', 'pinky'];
/** quantas esferas por falange, ao longo do eixo da cápsula */
const PROBES_PER_SEG = 4;

/**
 * Esferas que cobrem a mão nesta pose (espaço da mão): as falanges e o polegar pelo eixo das cápsulas, a palma por uma
 * grade de esferas com a meia espessura do elipsoide em cada ponto. Servem para medir contato com a arma (entrar na
 * malha ou ficar flutuando) sem olhar a malha da mão.
 */
export function handProbes(
  side: 1 | -1,
  c: number,
  t = c * 0.8,
  ix = c,
  off: FingerOffsets = NO_OFFSETS,
  only?: ProbePart,
): Probe[] {
  let rig = rigs.get(side);
  if (!rig) rigs.set(side, (rig = buildRig(side)));
  poseRig(rig, side, c, t, ix, off);
  rig.root.updateMatrixWorld(true);
  const out: Probe[] = [];
  const seg = (part: ProbePart, i: number, j: THREE.Object3D, len: number, r: number) => {
    if (only && only !== part) return;
    const half = Math.max(0, len - R * 1.4) / 2;
    for (let k = 0; k < PROBES_PER_SEG; k++) {
      const z = -len / 2 + half * (-1 + (2 * k) / (PROBES_PER_SEG - 1));
      out.push({ part, seg: i, at: new THREE.Vector3(0, 0, z).applyMatrix4(j.matrixWorld), r });
    }
  };
  rig.joints.forEach((chain, f) =>
    chain.forEach((j, i) => seg(FINGER_PART[f]!, i, j, FINGERS[f]!.len[i]!, R * (1 - i * 0.08))),
  );
  rig.thumb.forEach((j, i) => seg('thumb', i, j, THUMB[i]!, R * 1.15));
  // palma: elipsoide de raios (0,043; 0,017; 0,05) em (0, 0, −0,046)
  if (only && only !== 'palm') return out;
  let n = 0;
  for (let ax = -0.75; ax <= 0.751; ax += 0.25)
    for (let az = -0.75; az <= 0.751; az += 0.25) {
      const k = 1 - ax * ax - az * az;
      if (k < 0.15) continue;
      const r = 0.017 * Math.sqrt(k);
      out.push({ part: 'palm', seg: n++, at: new THREE.Vector3(ax * (0.043 - r), 0, -0.046 + az * (0.05 - r)), r });
    }
  return out;
}

const rigs = new Map<number, Rig>();
const cache = new Map<string, { geo: THREE.BufferGeometry; refs: number }>();
const M = new THREE.Matrix4();

/** a geometria juntada da mão nesta pose (do cache, ou montada agora) */
function handGeometry(
  side: 1 | -1,
  c: number,
  t: number,
  ix: number,
  off: FingerOffsets,
): { key: string; geo: THREE.BufferGeometry } {
  const key = `${side}:${c.toFixed(2)}:${t.toFixed(2)}:${ix.toFixed(2)}:${off.map((o) => o.toFixed(2)).join(',')}`;
  const hit = cache.get(key);
  if (hit) {
    // a mais usada por último vai para o fim (a primeira do mapa é a mais antiga)
    cache.delete(key);
    cache.set(key, hit);
    return { key, geo: hit.geo };
  }
  let rig = rigs.get(side);
  if (!rig) rigs.set(side, (rig = buildRig(side)));
  poseRig(rig, side, c, t, ix, off);
  rig.root.updateMatrixWorld(true);
  const parts = rig.pieces.map((p) => p.geo.clone().applyMatrix4(M.copy(p.at.matrixWorld)));
  const geo = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  cache.set(key, { geo, refs: 0 });
  // poda: sai a mais antiga que ninguém usa
  if (cache.size > CACHE_MAX)
    for (const [k, v] of cache) {
      if (v.refs > 0 || k === key) continue;
      v.geo.dispose();
      cache.delete(k);
      if (cache.size <= CACHE_MAX) break;
    }
  return { key, geo };
}

const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) / STEP) * STEP;
const qOff = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) / OFF_STEP) * OFF_STEP;
const OFF_Q: [number, number, number, number, number] = [0, 0, 0, 0, 0];

export function makeHand(color: THREE.ColorRepresentation, side: 1 | -1): Hand {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.castShadow = false;
  root.add(mesh);
  let key: string | null = null;
  const hand: Hand = {
    root,
    setCurl(c, t = c * 0.8, ix = c, off = NO_OFFSETS) {
      for (let i = 0; i < 5; i++) OFF_Q[i] = qOff(off[i] ?? 0);
      const g = handGeometry(side, q(c), q(t), q(ix), OFF_Q);
      if (g.key === key) return;
      if (key) {
        const old = cache.get(key);
        if (old) old.refs--;
      } else mesh.geometry.dispose();
      key = g.key;
      cache.get(key)!.refs++;
      mesh.geometry = g.geo;
    },
    dispose() {
      if (key) {
        const old = cache.get(key);
        if (old) old.refs--;
        key = null;
      }
      mat.dispose();
    },
  };
  hand.setCurl(0.2);
  return hand;
}
