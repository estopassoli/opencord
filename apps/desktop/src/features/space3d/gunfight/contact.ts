/**
 * Encaixe da mão na arma: a palma encosta na superfície e cada dedo fecha até tocar nela, sem entrar. Antes os dedos
 * fechavam todos no mesmo tanto, e em quase toda arma as pontas entravam 1–2 cm no punho, no guarda-mão e no pente.
 *
 * Como mede: a mão vira esferas (`handProbes`: as falanges pelo eixo das cápsulas e a palma por uma grade) e a arma
 * vira uma sopa de triângulos no espaço dela. A distância de cada esfera até o triângulo mais perto diz se encosta
 * (≤ raio). Força bruta com corte por esfera envolvente de cada triângulo, só dos triângulos perto da mão.
 *
 * Como resolve (uma vez por arma e pegada, em `setGun`, guardado no cache): a palma vem de fora para dentro pela
 * normal dela até encostar; depois cada dedo fecha de aberto até a primeira falange tocar (passo grosso e bissecção
 * no fim). Como sempre parte de fora, não precisa saber o que é "dentro" da malha (os modelos são ocos).
 */
import * as THREE from 'three';
import { handProbes, type FingerOffsets, type ProbePart } from '../hand';

/** triângulos (9 números cada), o centro e o raio da esfera envolvente de cada um */
export interface Soup {
  tris: Float32Array;
  cen: Float32Array;
  rad: Float32Array;
  n: number;
  /** grade de 1 cm: célula → triângulos que passam por ela (para a busca perto de um ponto) */
  grid: Map<number, number[]>;
  /** marca de visita por triângulo (para não medir o mesmo duas vezes numa busca) */
  stamp: Uint32Array;
}

const CELL = 0.01;
const cellKey = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
let visit = 0;

/** obstáculos extras: esferas (a outra mão, na pistola com as duas mãos) */
export interface Sphere {
  at: THREE.Vector3;
  r: number;
}

const V = new THREE.Vector3();
const M = new THREE.Matrix4();
const INV = new THREE.Matrix4();

/**
 * Os triângulos visíveis da arma no espaço dela (`root`), com os ossos como estão agora. `near` (centro e raio, no
 * espaço da arma) deixa só os triângulos perto de um ponto (a mão); `under`, só as malhas dentro de uma peça;
 * `skip`, tira uma peça (osso ou grupo: o gatilho, que o indicador deve tocar).
 */
export function soupOf(
  root: THREE.Object3D,
  near?: { at: THREE.Vector3; r: number },
  under?: THREE.Object3D,
  skip?: THREE.Object3D,
): Soup {
  root.updateMatrixWorld(true);
  INV.copy(root.matrixWorld).invert();
  const out: number[] = [];
  const p: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !visibleFrom(o, root)) return;
    if (under && !isUnder(o, under)) return;
    if (skip && isUnder(o, skip)) return;
    const geo = o.geometry as THREE.BufferGeometry;
    // osso a tirar: os triângulos presos a ele (peso ≥ 0,5 nos três pontos)
    const bone = skip && o instanceof THREE.SkinnedMesh ? o.skeleton.bones.indexOf(skip as THREE.Bone) : -1;
    const si = bone >= 0 ? geo.getAttribute('skinIndex') : undefined;
    const sw = bone >= 0 ? geo.getAttribute('skinWeight') : undefined;
    const onBone = (i: number) => {
      if (!si || !sw) return false;
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone) w += sw.getComponent(i, k);
      return w >= 0.5;
    };
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    M.multiplyMatrices(INV, o.matrixWorld);
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const gr of groups) {
      // material único vale para todos os grupos (como o three desenha)
      const mat = Array.isArray(o.material) ? mats[gr.materialIndex ?? 0] : o.material;
      if (!mat?.visible) continue;
      const end = Math.min(count, gr.start + gr.count);
      for (let t = gr.start; t + 2 < end; t += 3) {
        if (bone >= 0 && [0, 1, 2].every((k) => onBone(idx ? idx.getX(t + k) : t + k))) continue;
        for (let k = 0; k < 3; k++) o.getVertexPosition(idx ? idx.getX(t + k) : t + k, p[k]!).applyMatrix4(M);
        if (near) {
          // centro do triângulo longe demais da mão: fora
          V.copy(p[0]).add(p[1]).add(p[2]).divideScalar(3);
          const rr = Math.max(V.distanceTo(p[0]), V.distanceTo(p[1]), V.distanceTo(p[2]));
          if (V.distanceTo(near.at) - rr > near.r) continue;
        }
        for (const v of p) out.push(v.x, v.y, v.z);
      }
    }
  });
  return toSoup(out);
}

function isUnder(o: THREE.Object3D, top: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === top) return true;
  return false;
}

function visibleFrom(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== root.parent; p = p.parent) if (!p.visible) return false;
  return true;
}

/** sopa a partir de uma lista de vértices (9 por triângulo) */
export function toSoup(list: ArrayLike<number>): Soup {
  const n = Math.floor(list.length / 9);
  const tris = new Float32Array(list);
  const cen = new Float32Array(n * 3);
  const rad = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const cx = (tris[o]! + tris[o + 3]! + tris[o + 6]!) / 3;
    const cy = (tris[o + 1]! + tris[o + 4]! + tris[o + 7]!) / 3;
    const cz = (tris[o + 2]! + tris[o + 5]! + tris[o + 8]!) / 3;
    cen[t * 3] = cx;
    cen[t * 3 + 1] = cy;
    cen[t * 3 + 2] = cz;
    let r = 0;
    for (let k = 0; k < 3; k++)
      r = Math.max(r, Math.hypot(tris[o + k * 3]! - cx, tris[o + k * 3 + 1]! - cy, tris[o + k * 3 + 2]! - cz));
    rad[t] = r;
  }
  const grid = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(tris[o + k]!, tris[o + 3 + k]!, tris[o + 6 + k]!) / CELL));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(tris[o + k]!, tris[o + 3 + k]!, tris[o + 6 + k]!) / CELL));
    for (let x = lo[0]!; x <= hi[0]!; x++)
      for (let y = lo[1]!; y <= hi[1]!; y++)
        for (let z = lo[2]!; z <= hi[2]!; z++) {
          const key = cellKey(x, y, z);
          const list = grid.get(key);
          if (list) list.push(t);
          else grid.set(key, [t]);
        }
  }
  return { tris, cen, rad, n, grid, stamp: new Uint32Array(n) };
}

/** distância² de um ponto ao triângulo `t` da sopa (ponto mais perto, Ericson) */
function dist2(px: number, py: number, pz: number, T: Float32Array, o: number): number {
  const ax = T[o]!;
  const ay = T[o + 1]!;
  const az = T[o + 2]!;
  const abx = T[o + 3]! - ax;
  const aby = T[o + 4]! - ay;
  const abz = T[o + 5]! - az;
  const acx = T[o + 6]! - ax;
  const acy = T[o + 7]! - ay;
  const acz = T[o + 8]! - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let qx = ax;
  let qy = ay;
  let qz = az;
  if (d1 > 0 || d2 > 0) {
    const bpx = apx - abx;
    const bpy = apy - aby;
    const bpz = apz - abz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = apx - acx;
    const cpy = apy - acy;
    const cpz = apz - acz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    let v = 0;
    let w = 0;
    if (d3 >= 0 && d4 <= d3) v = 1;
    else if (d6 >= 0 && d5 <= d6) w = 1;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) v = d1 / (d1 - d3);
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) w = d2 / (d2 - d6);
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      v = 1 - w;
    } else {
      const den = 1 / (va + vb + vc);
      v = vb * den;
      w = vc * den;
    }
    qx = ax + abx * v + acx * w;
    qy = ay + aby * v + acy * w;
    qz = az + abz * v + acz * w;
  }
  const dx = px - qx;
  const dy = py - qy;
  const dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}

/** a distância do ponto até a superfície (sem sinal), ou `max` se nada estiver mais perto que isso */
export function surfaceDist(s: Soup, p: THREE.Vector3, max: number): number {
  let best = max * max;
  // perto: só as células da grade em volta do ponto
  if (max <= 0.05) {
    visit = (visit + 1) >>> 0;
    if (visit === 0) s.stamp.fill(0);
    const x0 = Math.floor((p.x - max) / CELL);
    const x1 = Math.floor((p.x + max) / CELL);
    const y0 = Math.floor((p.y - max) / CELL);
    const y1 = Math.floor((p.y + max) / CELL);
    const z0 = Math.floor((p.z - max) / CELL);
    const z1 = Math.floor((p.z + max) / CELL);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const list = s.grid.get(cellKey(x, y, z));
          if (!list) continue;
          for (const t of list) {
            if (s.stamp[t] === visit) continue;
            s.stamp[t] = visit;
            const d = dist2(p.x, p.y, p.z, s.tris, t * 9);
            if (d < best) best = d;
          }
        }
    return Math.sqrt(best);
  }
  for (let t = 0; t < s.n; t++) {
    const dx = p.x - s.cen[t * 3]!;
    const dy = p.y - s.cen[t * 3 + 1]!;
    const dz = p.z - s.cen[t * 3 + 2]!;
    const lim = Math.sqrt(best) + s.rad[t]!;
    if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
    const d = dist2(p.x, p.y, p.z, s.tris, t * 9);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** a menor folga (distância − raio) entre as esferas e a arma (e os obstáculos), em `max` no máximo */
export function clearance(
  s: Soup,
  extra: readonly Sphere[],
  probes: { at: THREE.Vector3; r: number }[],
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  max = 0.02,
): number {
  let gap = max;
  for (const pr of probes) {
    V.copy(pr.at).applyQuaternion(quat).add(pos);
    gap = Math.min(gap, surfaceDist(s, V, pr.r + gap) - pr.r);
    for (const e of extra) gap = Math.min(gap, V.distanceTo(e.at) - e.r - pr.r);
  }
  return gap;
}

export interface FitOpts {
  /** a palma vem pela normal dela até encostar (senão fica onde a pegada pôs) */
  palm?: boolean;
  /** quanto a palma pode ir além da pegada, para dentro (m) e para fora */
  palmIn?: number;
  palmOut?: number;
  /** dedos que fecham até encostar (os outros ficam no curl da pegada) */
  fingers?: readonly ProbePart[];
  /** o maior fechamento de cada dedo (sem encostar em nada, ele para aqui) */
  maxCurl?: number;
  /** teto por dedo (0: não fecha além da pegada, só abre se encostar — o indicador no gatilho) */
  cap?: Partial<Record<ProbePart, number>>;
  /** folga que sobra entre o dedo e a superfície (m) */
  skin?: number;
  /** obstáculos extras (esferas no espaço da arma) */
  extra?: readonly Sphere[];
}

export interface Fit {
  /** pulso (espaço da arma), já com a palma encostada */
  pos: THREE.Vector3;
  /** acerto de cada dedo em cima do curl da pegada (indicador, médio, anelar, mindinho, polegar) */
  offsets: FingerOffsets;
}

const PART_INDEX: Partial<Record<ProbePart, number>> = { index: 0, middle: 1, ring: 2, pinky: 3, thumb: 4 };
const N = new THREE.Vector3();

/**
 * Encaixa a mão (`side`, no `pos`/`quat` da pegada, com os dedos em `curl` = [dedos, polegar, indicador]) na arma.
 * Os curls de base são os valores já arredondados que a mão vai usar (o acerto é medido em cima deles).
 */
export function fitHand(
  soup: Soup,
  side: 1 | -1,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
  curl: readonly [number, number, number],
  o: FitOpts = {},
): Fit {
  const extra = o.extra ?? [];
  const skin = o.skin ?? 0.0008;
  const out = pos.clone();
  const [c, t, ix] = curl;
  if (o.palm) {
    // palma: a normal dela é o −y da mão; vem de fora (dorso, +y) para dentro, de milímetro em milímetro
    const palm = handProbes(side, c, t, ix, undefined, 'palm');
    N.set(0, 1, 0).applyQuaternion(quat);
    const din = o.palmIn ?? 0.012;
    const dout = o.palmOut ?? 0.025;
    let best = Number.NaN;
    let touched = false;
    const at = new THREE.Vector3();
    for (let d = dout; d >= -din - 1e-9; d -= 0.001) {
      at.copy(pos).addScaledVector(N, d);
      if (clearance(soup, extra, palm, at, quat, 0.004) < skin) {
        touched = true;
        break;
      }
      best = d;
    }
    // nada encostou (ou já encostava bem por fora): fica onde a pegada pôs
    if (touched && Number.isFinite(best)) out.addScaledVector(N, best);
  }
  const offsets: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const maxCurl = o.maxCurl ?? 1;
  for (const f of o.fingers ?? []) {
    const fi = PART_INDEX[f];
    if (fi === undefined) continue;
    const base = fi === 0 ? ix : fi === 4 ? t : c;
    const off: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let skipBase = false;
    const free = (k: number) => {
      off[fi] = k - base;
      const pr = handProbes(side, c, t, ix, off, f).filter((p) => !skipBase || p.seg > 0);
      return clearance(soup, extra, pr, out, quat, 0.004) >= skin;
    };
    // a falange da base encosta em qualquer fechamento (o nó do dedo na lateral do punho): só as outras contam
    if (!free(base) && !free(0)) skipBase = true;
    // da pegada: livre, fecha até encostar; encostando (ou dentro), abre até soltar. Passo grosso e bissecção no fim
    // entre o último livre e o primeiro que encosta. (Partir de aberto parava o dedo no guarda-mato, esticado.)
    const top = Math.max(base, o.cap?.[f] ?? maxCurl);
    let lo: number;
    let hi: number;
    if (free(base)) {
      lo = base;
      hi = -1;
      for (let k = base + 0.05; k <= top + 1e-6; k += 0.05) {
        if (!free(Math.min(k, top))) {
          hi = Math.min(k, top);
          break;
        }
        lo = Math.min(k, top);
      }
      if (hi < 0) {
        offsets[fi] = lo - base;
        continue;
      }
    } else {
      hi = base;
      lo = -1;
      for (let k = base - 0.05; k >= -1e-6; k -= 0.05) {
        if (free(Math.max(0, k))) {
          lo = Math.max(0, k);
          break;
        }
        hi = Math.max(0, k);
      }
      if (lo < 0) {
        offsets[fi] = 0;
        continue;
      }
    }
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2;
      if (free(mid)) lo = mid;
      else hi = mid;
    }
    offsets[fi] = lo - base;
  }
  return { pos: out, offsets };
}

/**
 * Medida (para testes e o medidor): a maior entrada (m) das esferas da mão na arma, por parte. Usa o número de voltas
 * (soma dos ângulos sólidos) para saber se o centro está dentro da malha — só vale para malhas fechadas.
 */
export function penetration(
  soup: Soup,
  probes: { part: ProbePart; at: THREE.Vector3; r: number }[],
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
): Partial<Record<ProbePart, number>> {
  const res: Partial<Record<ProbePart, number>> = {};
  for (const pr of probes) {
    V.copy(pr.at).applyQuaternion(quat).add(pos);
    const d = surfaceDist(soup, V, 1);
    const pen = pr.r - (inside(soup, V) ? -d : d);
    res[pr.part] = Math.max(res[pr.part] ?? -Infinity, pen);
  }
  return res;
}

/** o ponto está dentro da malha (número de voltas > 0,5) */
export function inside(s: Soup, p: THREE.Vector3): boolean {
  let w = 0;
  const T = s.tris;
  for (let t = 0; t < s.n; t++) {
    const o = t * 9;
    const ax = T[o]! - p.x;
    const ay = T[o + 1]! - p.y;
    const az = T[o + 2]! - p.z;
    const bx = T[o + 3]! - p.x;
    const by = T[o + 4]! - p.y;
    const bz = T[o + 5]! - p.z;
    const cx = T[o + 6]! - p.x;
    const cy = T[o + 7]! - p.y;
    const cz = T[o + 8]! - p.z;
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    const lc = Math.hypot(cx, cy, cz);
    const num = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la;
    w += 2 * Math.atan2(num, den + (cx * ax + cy * ay + cz * az) * lb);
  }
  return Math.abs(w / (4 * Math.PI)) > 0.5;
}
