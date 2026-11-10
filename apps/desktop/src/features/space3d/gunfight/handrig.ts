/**
 * A mão dos braços da primeira pessoa (`assets/arms.glb`, ADR-0060): as poses dos dedos (dados, por junta) e as esferas
 * que medem o contato com a arma. A mesma função de pose (`poseFingers`) põe os ossos de verdade (os da malha com pele)
 * e os de uma cópia sem malha montada a partir de `armsrig.ts`: o encaixe medido é o que se vê.
 *
 * Espaço da mão: pulso na origem, dedos para −z, palma para −y, dorso para +y; na direita (`side` 1) o indicador e o
 * polegar em −x, na esquerda espelhado.
 *
 * Parâmetros de pose, como nas pegadas: `c` (médio, anelar e mindinho; 0 aberta a 1 punho fechado), `t` (polegar: 0
 * aberto ao lado do indicador, 1 cruzando por cima dos dedos), `ix` (indicador; mais aberto que os outros vira dedo de
 * gatilho: a base quase reta e o meio dobrado) e `off` (acerto de cada dedo, medido no encaixe).
 */
import * as THREE from 'three';
import { ARM_RIG, type ArmBoneRest, type ArmSideRest } from './armsrig';

/**
 * acerto de cada dedo em cima do fechamento: indicador, médio, anelar, mindinho e polegar; o sexto (opcional) abre o
 * polegar para o lado da palma (`HAND_POSE.thumbAbduct`, 0 a ~1): o polegar sobe pela lateral do guarda-mão no apoio
 */
export type FingerOffsets = readonly [number, number, number, number, number, number?];
const NO_OFFSETS: FingerOffsets = [0, 0, 0, 0, 0];

export type ProbePart = 'palm' | 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export interface Probe {
  part: ProbePart;
  /** falange (0 base, 1 meio, 2 ponta; na palma, o número da esfera) */
  seg: number;
  /** centro no espaço da mão e o raio da superfície ali */
  at: THREE.Vector3;
  r: number;
}

export const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'] as const;

/**
 * Pose de mão escrita à mão (rad, em cima do descanso do modelo). Cada dedo: quanto o metacarpo, a base, o meio e a
 * ponta dobram com o dedo todo fechado (`curl` = 1), e o quanto ele abre para o lado. O fechamento cresce do
 * indicador para o mindinho (o punho de verdade "rola" para o mindinho) e o metacarpo do anelar e do mindinho desce um
 * pouco (a palma faz concha).
 */
export interface HandPoseData {
  /** por dedo (indicador→mindinho): [metacarpo, base, meio, ponta] no fechado */
  bend: readonly (readonly [number, number, number, number])[];
  /** quanto cada dedo fecha a mais que o `curl` pedido (o mindinho fecha antes) */
  lead: readonly [number, number, number, number];
  /** abertura lateral de cada dedo com a mão aberta e com ela fechada (rad, para o lado do mindinho +) */
  spread: readonly [number, number, number, number];
  /** o indicador de gatilho: base, meio, ponta, e quanto a base abre para o lado do polegar */
  trigger: readonly [number, number, number];
  triggerSplay: number;
  /** polegar aberto (`t` 0) e cruzando os dedos (`t` 1): giro XYZ de cada um dos 3 ossos */
  thumbOpen: readonly (readonly [number, number, number])[];
  thumbClosed: readonly (readonly [number, number, number])[];
  /**
   * o polegar aberto para o lado da palma (por unidade do sexto acerto), somado em cima do giro dele: com a mão por
   * baixo do guarda-mão, ele sobe pela lateral esquerda (sem isso ele ficava deitado embaixo, entrando no guarda-mão)
   */
  thumbAbduct: readonly (readonly [number, number, number])[];
}

export const HAND_POSE: HandPoseData = {
  // `curl` 1 é a mão fechada em volta de um cabo de ~2,5 cm (punho de arma, cabo de faca), não o punho cerrado; o
  // cerrado fica perto de 1,6 (o acerto medido pode passar de 1). O anelar e o mindinho fecham mais na base e o
  // metacarpo deles desce (a palma faz concha): no punho do fuzil eles ficavam abertos, só a ponta encostando
  bend: [
    [0, 0.94, 1.04, 0.65],
    [0, 0.98, 1.07, 0.68],
    [0.15, 1.15, 1.0, 0.6],
    [0.3, 1.2, 0.95, 0.55],
  ],
  lead: [0, 0, 0.03, 0.06],
  spread: [-0.06, 0, 0.05, 0.1],
  trigger: [0.25, 1.35, 0.7],
  triggerSplay: 0.3,
  thumbOpen: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  thumbClosed: [
    [0.3, -1.22, -0.6],
    [0.6, -0.09, 0],
    [0.45, 0, 0],
  ],
  thumbAbduct: [
    [0, 0, -1],
    [0, 0, 0],
    [0, 0, 0],
  ],
};

/** o que a pose mexe: um osso por nome, com o giro de descanso */
export interface PoseTarget {
  bones: Map<string, THREE.Object3D>;
  rest: Map<string, THREE.Quaternion>;
}

const Q = new THREE.Quaternion();
const E = new THREE.Euler();
/**
 * Sinais por lado: o +x de cada osso fecha o dedo para a palma nos dois lados (o modelo é simétrico); os giros
 * laterais (abrir os dedos, o polegar cruzar) são espelhados na esquerda. As poses são escritas para a direita.
 */
const CURL_SIGN = { r: 1, l: 1 };
const SPREAD_SIGN = { r: 1, l: -1 };

function setBone(t: PoseTarget, name: string, x: number, y: number, z: number) {
  const b = t.bones.get(name);
  const r = t.rest.get(name);
  if (!b || !r) return;
  b.quaternion.copy(r).multiply(Q.setFromEuler(E.set(x, y, z, 'XYZ')));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** põe os dedos na pose (`c` dedos, `t` polegar, `ix` indicador e o acerto de cada um) */
export function poseFingers(
  target: PoseTarget,
  side: 1 | -1,
  c: number,
  t: number,
  ix = c,
  off: FingerOffsets = NO_OFFSETS,
  pose: HandPoseData = HAND_POSE,
) {
  const s = side > 0 ? 'r' : 'l';
  const k = CURL_SIGN[s];
  const sp = SPREAD_SIGN[s];
  // o indicador vira "dedo de gatilho" quando fica mais aberto que os outros
  const split = clamp01((c - ix) / 0.05);
  FINGER_NAMES.forEach((f, i) => {
    const raw = Math.max(0, (i === 0 ? ix : c) + off[i]!);
    const cf = Math.min(1.6, raw + pose.lead[i]! * clamp01(raw * 2));
    const b = pose.bend[i]!;
    const tr = i === 0 ? split : 0;
    const spread = pose.spread[i]! * (1 - 0.6 * clamp01(cf)) - (i === 0 ? pose.triggerSplay * tr : 0);
    setBone(target, 'palm_' + f, k * b[0] * cf, 0, 0);
    setBone(target, f + '1', k * cf * lerp(b[1], pose.trigger[0], tr), 0, sp * spread);
    setBone(target, f + '2', k * cf * lerp(b[2], pose.trigger[1], tr), 0, 0);
    setBone(target, f + '3', k * cf * lerp(b[3], pose.trigger[2], tr), 0, 0);
  });
  const tt = Math.max(0, Math.min(1.3, t + off[4]));
  const ab = off[5] ?? 0;
  for (let j = 0; j < 3; j++) {
    const o = pose.thumbOpen[j]!;
    const cl = pose.thumbClosed[j]!;
    const a = pose.thumbAbduct[j]!;
    setBone(
      target,
      'thumb' + (j + 1),
      (lerp(o[0], cl[0], tt) + a[0] * ab) * k,
      (lerp(o[1], cl[1], tt) + a[1] * ab) * sp,
      (lerp(o[2], cl[2], tt) + a[2] * ab) * sp,
    );
  }
}
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** uma cópia da mão sem malha (só juntas) a partir dos números do `armsrig`, no espaço da mão */
interface VirtualHand extends PoseTarget {
  root: THREE.Group;
  /** osso → descanso (para as esferas: sentido, tamanho e grossura) */
  info: Map<string, ArmBoneRest>;
}
const virtual = new Map<number, VirtualHand>();
function virtualHand(side: 1 | -1): VirtualHand {
  let v = virtual.get(side);
  if (v) return v;
  const data: ArmSideRest = side > 0 ? ARM_RIG.r : ARM_RIG.l;
  const root = new THREE.Group();
  const hand = new THREE.Object3D();
  hand.position.fromArray(data.hand.pos);
  hand.quaternion.fromArray(data.hand.quat);
  root.add(hand);
  const bones = new Map<string, THREE.Object3D>([['hand', hand]]);
  const rest = new Map<string, THREE.Quaternion>();
  const info = new Map<string, ArmBoneRest>();
  for (const b of data.bones) {
    const o = new THREE.Object3D();
    o.position.fromArray(b.pos);
    o.quaternion.fromArray(b.quat);
    bones.get(b.parent)?.add(o);
    bones.set(b.name, o);
    rest.set(b.name, o.quaternion.clone());
    info.set(b.name, b);
  }
  v = { root, bones, rest, info };
  virtual.set(side, v);
  return v;
}

/** quantas esferas por falange, ao longo do osso */
const PROBES_PER_SEG = 4;
const D = new THREE.Vector3();

/**
 * Esferas que cobrem a mão nesta pose (espaço da mão): as falanges pelo eixo de cada osso (com a grossura medida na
 * malha), a palma pela grade medida (o meio da espessura e a meia espessura em cada ponto) e a base do polegar (que
 * mexe com ele) junto da palma. Servem para medir o contato com a arma sem olhar a malha da mão.
 */
export function handProbes(
  side: 1 | -1,
  c: number,
  t = c * 0.8,
  ix = c,
  off: FingerOffsets = NO_OFFSETS,
  only?: ProbePart,
): Probe[] {
  const v = virtualHand(side);
  poseFingers(v, side, c, t, ix, off);
  v.root.updateMatrixWorld(true);
  const out: Probe[] = [];
  const seg = (part: ProbePart, i: number, name: string) => {
    if (only && only !== part) return;
    const o = v.bones.get(name);
    const b = v.info.get(name);
    if (!o || !b) return;
    D.fromArray(b.dir);
    // as esferas do meio do osso (as das juntas ficam com o osso vizinho)
    const half = Math.max(0, b.len - b.r * 1.4) / 2;
    for (let k = 0; k < PROBES_PER_SEG; k++) {
      const along = b.len / 2 + half * (-1 + (2 * k) / (PROBES_PER_SEG - 1));
      out.push({ part, seg: i, at: D.clone().multiplyScalar(along).applyMatrix4(o.matrixWorld), r: b.r });
    }
  };
  FINGER_NAMES.forEach((f) => [1, 2, 3].forEach((j) => seg(f, j - 1, f + j)));
  seg('thumb', 0, 'thumb2');
  seg('thumb', 1, 'thumb3');
  if (only && only !== 'palm') return out;
  const data = side > 0 ? ARM_RIG.r : ARM_RIG.l;
  let n = 0;
  for (const [x, y, z, r] of data.palm) out.push({ part: 'palm', seg: n++, at: new THREE.Vector3(x, y, z), r });
  // a base do polegar (o "músculo" dele na palma) mexe com o polegar
  const start = out.length;
  seg('palm', 0, 'thumb1');
  for (let i = start; i < out.length; i++) out[i]!.seg = n++;
  return out;
}

/**
 * Centro do vão dos dedos fechados (onde passa um cabo), no espaço da mão, com os dedos em `FIST_CURL`: no plano do
 * dedo médio, o centro do maior círculo que cabe dentro do laço formado pela palma e pelas três falanges dele. As
 * pegadas de cabo (facas, alavanca do ferrolho, punhos) encaixam o centro do cabo aqui.
 */
export const FIST_CURL = 0.95;
export const FIST_HOLE = fistHole(FIST_CURL);

export function fistHole(c: number): THREE.Vector3 {
  const pr = handProbes(1, c, 0.8, c);
  const mid = pr.filter((p) => p.part === 'middle');
  const x = mid.reduce((a, p) => a + p.at.x, 0) / Math.max(1, mid.length);
  const palm = pr.filter((p) => p.part === 'palm' && Math.abs(p.at.x - x) < 0.008).sort((a, b) => a.at.z - b.at.z);
  // o laço: do nó do dedo até a ponta pelas falanges, e de volta pela superfície da palma
  const ring = [...mid.map((p) => [p.at.y, p.at.z] as const), ...palm.map((p) => [p.at.y - p.r, p.at.z] as const)];
  const inside = (y: number, z: number) => {
    let w = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, zi] = ring[i]!;
      const [yj, zj] = ring[j]!;
      if (zi > z !== zj > z && y < ((yj - yi) * (z - zi)) / (zj - zi) + yi) w = !w;
    }
    return w;
  };
  const all = [...mid, ...palm];
  const best = new THREE.Vector3(x, -0.03, -0.08);
  let bd = -Infinity;
  for (let y = -0.07; y <= 0; y += 0.001)
    for (let z = -0.13; z <= 0; z += 0.001) {
      if (!inside(y, z)) continue;
      let d = Infinity;
      for (const p of all) d = Math.min(d, Math.hypot(p.at.y - y, p.at.z - z) - p.r);
      if (d > bd) {
        bd = d;
        best.set(x, y, z);
      }
    }
  return best;
}

/**
 * O centro de um punho de arma (≈ 2,6 × 3,5 cm) em relação à mão: a palma encostada na lateral dele (meia largura
 * abaixo da palma) e os nós dos dedos na frente (o centro ~1 cm atrás do vão do punho fechado), para os dedos darem a volta na frente
 * e subirem pelo outro lado. No vão do punho fechado (`FIST_HOLE`, embaixo dos nós) o punho não cabe.
 */
export const GRIP_HOLE = FIST_HOLE.clone().add(new THREE.Vector3(0, 0, 0.012));

/**
 * Karambit nesta mão (espaço da faca: pulso e giro; `index` = fechamento do indicador). Medida em cima das juntas da
 * mão, não chutada: o cabo passa pelo vão de cada dedo fechado (médio, anelar e mindinho; o vão vai ~38° na diagonal da
 * palma, do indicador para o pulso, como numa mão de verdade), a palma encosta na lateral direita do cabo e a falange do
 * meio do indicador atravessa a argola (o modelo, em `models.ts`, tem a argola e os encaixes onde esta mão os põe). O
 * encaixe medido (`contact.ts`) fecha cada dedo até encostar e abre o indicador se ele tocar a argola.
 */
export const KARAMBIT_ARM = {
  pos: [0.0231, -0.0177, 0.0485] as THREE.Vector3Tuple,
  quat: [0.2816, 0.1769, -0.6763, 0.6572] as [number, number, number, number],
  index: 0.97,
  /**
   * o médio fica neste fechamento, sem encaixe: nesta mão os dedos fechados convergem para o indicador e o médio cruza
   * a frente da argola; o encaixe o deixava esticado para cima (parecia apontar), fechado ele passa rente à argola
   */
  middle: 0.95,
};

/**
 * Kukri nesta mão (espaço da faca: pulso e giro), em martelo, medida com as esferas da mão: o cabo (2,6 cm) cruza a
 * palma na diagonal (~26°) logo atrás da guarda, a palma encosta na lateral direita, os quatro dedos fecham por baixo
 * (o lado do fio) até encostar e as pontas deitam na lateral esquerda; o polegar dá a volta por cima e deita sobre o
 * indicador e o médio (`thumb`: fechamento e quanto ele abre para o lado da palma, para passar por cima dos dedos).
 */
export const KUKRI_ARM = {
  pos: [0.032, 0.0618, 0.0318] as THREE.Vector3Tuple,
  quat: [0.3758, 0.3758, 0.599, -0.599] as [number, number, number, number],
  thumb: [0.6, 0.45] as const,
};

/**
 * Baioneta nesta mão, em martelo (espaço da faca: pulso e giro; `curl` = indicador, médio, anelar, mindinho e polegar).
 * Medida em cima das juntas da mão (busca no espelho da primeira pessoa, com o encaixe de `contact.ts` fechando cada
 * dedo até encostar): o cabo atravessa o punho na diagonal da palma, do indicador (encostado atrás da guarda) para o
 * mindinho, os quatro dedos dão a volta nele, o polegar fecha por cima do indicador e do médio, a palma encosta sem
 * entrar, o fio para o lado dos nós dos dedos e o dorso (com a argola) para o lado do pulso.
 */
export const BAYONET_ARM = {
  pos: [0.0243, 0.0604, 0.002] as THREE.Vector3Tuple,
  quat: [-0.3996, -0.4784, -0.54, 0.5656] as [number, number, number, number],
  curl: [1.01, 1.12, 1.08, 0.84, 0.6] as const,
  /** o polegar aberto para o lado da palma (fechado reto, ele atravessava o cabo): deita na face de fora, por cima do indicador */
  thumbUp: 0.45,
};

/**
 * Balisong aberta nesta mão (espaço da faca: pulso e giro). Medida nas esferas da mão (`contact.ts`), não chutada: os
 * dois cabos juntos (3,2 × 0,9 cm) passam pelo vão de cada dedo fechado, a palma encosta no lado direito deles, médio,
 * anelar e mindinho dão a volta por baixo (o lado do cabo de morder) e as pontas encostam no lado esquerdo; o indicador
 * fecha logo atrás dos pinos (nada da mão passa à frente de z = −0,053, onde começa a lâmina) e o polegar deita por
 * cima, do lado esquerdo. Fecham partindo de abertos até encostar (o encaixe do `setGun`): médio ~1,28, anelar ~1,18,
 * mindinho ~1,03, indicador ~1,02.
 */
export const BALISONG_ARM = {
  pos: [0.0172, 0.0522, 0.0329] as THREE.Vector3Tuple,
  quat: [0.2915, 0.3664, 0.5862, -0.6611] as [number, number, number, number],
};

/**
 * Bowie em martelo nesta mão (espaço da faca: pulso e giro; `curl` = indicador, médio, anelar, mindinho, polegar e o
 * quanto o polegar abre para o lado da palma). Medida em cima das juntas da mão, não chutada: o cabo (1,6 × 4 cm)
 * atravessa a mão fechada logo atrás da guarda, a palma encostada na lateral direita, as falanges de baixo passando
 * por baixo do fio do cabo e as do meio e as pontas encostadas na lateral esquerda; o polegar fecha por cima do
 * indicador. Cada dedo fechado até encostar no cabo (`contact.ts`), sem entrar; o pulso cai um pouco para o lado do
 * mindinho, como numa mão de verdade. Com o encaixe genérico (dedos partindo abertos), o primeiro toque parava os dedos
 * abertos, pendurados ao lado do cabo.
 */
export const BOWIE_ARM = {
  pos: [0.0272, 0.0634, -0.0143] as THREE.Vector3Tuple,
  quat: [0.4053, 0.4611, 0.5361, -0.5794] as [number, number, number, number],
  curl: [0.96, 1.13, 1.01, 0.63, 0.6, 0.55] as const,
};

/** a mão dos braços para as pegadas (`grips.ts`) */
export const ARM_HAND_FIT = {
  hole: FIST_HOLE,
  curl: FIST_CURL,
  grip: GRIP_HOLE,
  clamp: 0.005,
  ring: { row: 0.022, back: 0.023 },
  karambit: KARAMBIT_ARM,
  kukri: KUKRI_ARM,
  bayonet: BAYONET_ARM,
  balisong: BALISONG_ARM,
  bowie: BOWIE_ARM,
  vgripTilt: 0.5,
  clampYaw: 0.45,
  clampRoll: 0.15,
  clampThumb: 0.3,
  clampThumbUp: 0.9,
};

/** o descanso do osso da mão no espaço da mão (para pôr o osso de verdade onde a pegada põe a mão) */
export function handBoneRest(side: 1 | -1): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const d = side > 0 ? ARM_RIG.r : ARM_RIG.l;
  return { pos: new THREE.Vector3().fromArray(d.hand.pos), quat: new THREE.Quaternion().fromArray(d.hand.quat) };
}
