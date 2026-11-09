/**
 * Modelos das armas do gunfight. Sete vêm do pacote "Ultimate Low Poly Guns" (Pichuliru, modelos de TastyTony,
 * CC-BY 4.0; convertidos para .glb com o Blender, com o esqueleto do carregador, do ferrolho e do gatilho). A M200, a
 * Desert Eagle, o Karambit e a baioneta não existem nesse pacote: são feitos aqui, em código, no mesmo estilo.
 *
 * Todo modelo sai padronizado: frente em −z, cima em +y, origem no punho (onde a mão de atirar segura), em metros de
 * arma real. As peças que mexem (pente, ferrolho, ferrolho da pistola, alavanca) vêm com um jeito de deslocá-las no
 * espaço da arma (`move`).
 */
import type { GunId } from '@opencord/contracts';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import ak47Url from '../assets/guns/ak47.glb?url';
import kar98kUrl from '../assets/guns/kar98k.glb?url';
import l115Url from '../assets/guns/l115.glb?url';
import m4Url from '../assets/guns/m4.glb?url';
import m9Url from '../assets/guns/m9.glb?url';
import mp5Url from '../assets/guns/mp5.glb?url';
import mp7Url from '../assets/guns/mp7.glb?url';

export type PartName = 'mag' | 'bolt' | 'slide' | 'charge' | 'boltRot' | 'blade' | 'trigger';

/** uma peça que mexe: deslocar (no espaço da arma) e girar em volta do eixo z da arma (o ferrolho do sniper) */
export interface Part {
  obj: THREE.Object3D;
  rest: THREE.Vector3;
  restQ: THREE.Quaternion;
  /** rotação do espaço da arma para o espaço do pai da peça */
  toParent: THREE.Quaternion;
}

export interface GunModel {
  id: GunId;
  root: THREE.Object3D;
  parts: Partial<Record<PartName, Part>>;
  /** pontos no espaço da arma: cano (saída), linha de mira (olho ao mirar) e mão de apoio */
  muzzle: THREE.Vector3;
  sight: THREE.Vector3;
  /** mira de ferro: quanto a arma inclina mirando para a massa ficar na linha do furo de trás (rad) */
  sightPitch?: number;
  support: THREE.Vector3;
  /** meia largura do guarda-mão no apoio (m): a mão de apoio fecha mais no fino */
  supportW?: number;
  /**
   * Os cartuchos do pente (material próprio deste modelo). Os modelos são ocos: com o pente no lugar, os cartuchos de
   * cima apareciam pela caixa da culatra (dourados no meio da tela ao mirar). Ficam escondidos; o viewmodel mostra
   * quando o pente sai do lugar na recarga.
   */
  rounds?: THREE.Material;
  /** centro do cabo (facas) ou do punho (armas de fogo): a mão fecha em volta dele, pela medida do modelo */
  handle?: THREE.Vector3;
  length: number;
  /** a ponta do cano no eixo do furo (onde a peça da boca rosqueia); sem isso, `muzzle` */
  bore?: THREE.Vector3;
  /**
   * Acessórios montados (`attachmodels.ts`): a chave da montagem, o vidro com retículo das miras (a primeira pessoa
   * põe o ponto onde a linha do olho cruza o vidro), a empunhadura sob o cano (a mão de apoio vai nela) e quanto o
   * carregador estendido desce abaixo do pente.
   */
  buildKey?: string;
  /** a alça e a massa que dobram (M4, MP7): escondidas quando há uma mira montada */
  irons?: THREE.Material;
  reticles?: Reticle[];
  foregrip?: { kind: 'vertical' | 'angled'; at: THREE.Vector3; h: number };
  magExt?: number;
}

/** o vidro de uma mira com retículo aceso (ponto vermelho, reflexa mini, ponto de pistola) */
export interface Reticle {
  mesh: THREE.Mesh;
  uniforms: { uDot: { value: THREE.Vector2 }; uDist: { value: number } };
}

/**
 * Mão de apoio: que fração do caminho do punho até a boca (meio do guarda-mão). Fuzil no meio do guarda-mão; sniper
 * e Kar98k na ponta da coronha de madeira, por baixo; submetralhadora bem à frente.
 */
const SUPPORT_AT: Partial<Record<GunId, number>> = {
  m4: 0.48,
  ak47: 0.44,
  l115: 0.3,
  kar98k: 0.3,
  mp7: 0.7,
  mp5: 0.7,
};

/**
 * Linha de mira das armas de mira de ferro: a massa é o ponto mais alto da arma à frente desta fração do caminho do
 * punho até a boca. A MP7 é curta: a massa fica a ~55% (z −0,14 m) e escapava da fatia padrão (o ponto ia para o topo
 * do cano, 2 cm abaixo, e a massa aparecia ~90 px acima do centro da tela mirando).
 */
const SIGHT_AT: Partial<Record<GunId, number>> = {
  mp7: 0.45,
};

/**
 * Mira de ferro medida no modelo (raios ao longo do cano em x = 0): [altura, z] do centro da alça/furo de trás e da
 * ponta da massa. A linha passa pelos dois (a arma inclina o pouquinho que falta) e o furo de trás fica centrado na
 * tela com a massa dentro dele. Sem entrada aqui, vale a busca pela massa (`SIGHT_AT`).
 */
const IRON: Partial<Record<GunId, { rear: [number, number]; front: [number, number] }>> = {
  m4: { rear: [0.145, 0.02], front: [0.14, -0.42] },
  ak47: { rear: [0.107, -0.2], front: [0.106, -0.54] },
  mp7: { rear: [0.1255, 0.09], front: [0.1255, -0.14] },
  mp5: { rear: [0.139, 0.04], front: [0.139, -0.31] },
  kar98k: { rear: [0.102, -0.27], front: [0.102, -0.77] },
};

interface Template {
  scene: THREE.Object3D;
  build: () => GunModel;
}

const FILE: Partial<Record<GunId, string>> = {
  m4: m4Url,
  ak47: ak47Url,
  mp7: mp7Url,
  mp5: mp5Url,
  l115: l115Url,
  kar98k: kar98kUrl,
  m9: m9Url,
};

/** nome do osso no arquivo → peça */
const BONE_PART: Record<string, PartName> = {
  mag: 'mag',
  bolt: 'bolt',
  boltmove: 'bolt',
  slide: 'slide',
  charginghandle: 'charge',
  bolthandle: 'charge',
  boltrotate: 'boltRot',
  trigger: 'trigger',
};

const templates = new Map<GunId, Template>();
let loading: Promise<void> | null = null;

/** carrega tudo uma vez (as chamadas seguintes esperam a mesma promessa) */
export function loadGuns(): Promise<void> {
  loading ??= (async () => {
    const loader = new GLTFLoader();
    const files = await Promise.all(
      (Object.entries(FILE) as [GunId, string][]).map(async ([id, url]) => [id, await loader.loadAsync(url)] as const),
    );
    const scenes = new Map(files.map(([id, g]) => [id, g.scene]));
    const kar = scenes.get('kar98k');
    if (kar) darkenWood(kar);
    for (const scene of scenes.values()) splitRounds(scene);
    for (const [id, scene] of scenes) {
      if (FOLD[id]) splitIrons(id, scene);
      templates.set(id, { scene, build: () => fromFile(id, scene) });
    }
    templates.set('m200', { scene: new THREE.Group(), build: m200 });
    templates.set('deagle', { scene: new THREE.Group(), build: deagle });
    templates.set('karambit', { scene: new THREE.Group(), build: () => knife('karambit') });
    templates.set('bayonet', { scene: new THREE.Group(), build: () => knife('bayonet') });
  })();
  return loading;
}

/**
 * A madeira da Kar98k tem quase a cor da pele: a mão sumia na coronha (no quadril e no ferrolho). Escurece 25% só os
 * materiais de madeira (tons de laranja/vermelho), uma vez no carregamento (as cópias da arma usam os mesmos).
 */
function darkenWood(scene: THREE.Object3D) {
  const hsl = { h: 0, s: 0, l: 0 };
  const done = new Set<THREE.Material>();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof THREE.MeshStandardMaterial) || done.has(m)) continue;
      done.add(m);
      m.color.getHSL(hsl);
      if (hsl.s > 0.2 && (hsl.h < 0.12 || hsl.h > 0.95)) m.color.multiplyScalar(0.75);
    }
  });
}

/** ossos que levam os cartuchos (o pente, e o cartucho na câmara da MP5, preso ao osso neutro) */
const ROUND_BONES = new Set(['mag', 'bullet', 'bullets', 'neutral_bone']);
/** nome do material dos cartuchos (o segundo da malha), para cada cópia da arma achar e trocar pelo seu */
const ROUNDS = 'gf-rounds';

/**
 * Separa os triângulos dos cartuchos (cor de latão na paleta do modelo, presos ao pente) num segundo grupo da malha,
 * com material próprio escondido. Uma vez por arquivo, no carregamento (as cópias usam a mesma geometria).
 */
function splitRounds(scene: THREE.Object3D) {
  scene.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    const geo = o.geometry;
    const index = geo.index;
    const uv = geo.getAttribute('uv');
    const si = geo.getAttribute('skinIndex');
    const sw = geo.getAttribute('skinWeight');
    const tex = texels(o.material.map);
    if (!index || !uv || !si || !sw || !tex || geo.groups.length) return;
    const flip = o.material.map?.flipY ?? false;
    const brass = (i: number) => {
      let bone = 0;
      let best = -1;
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c);
        if (w > best) {
          best = w;
          bone = si.getComponent(i, c);
        }
      }
      if (!ROUND_BONES.has(o.skeleton.bones[bone]?.name ?? '')) return false;
      const u = uv.getX(i) - Math.floor(uv.getX(i));
      let v = uv.getY(i) - Math.floor(uv.getY(i));
      if (flip) v = 1 - v;
      const k = (Math.min(tex.h - 1, Math.floor(v * tex.h)) * tex.w + Math.min(tex.w - 1, Math.floor(u * tex.w))) * 4;
      const r = tex.data[k]!;
      const g = tex.data[k + 1]!;
      const b = tex.data[k + 2]!;
      // latão: vermelho e verde altos, azul baixo
      return r > 150 && g > 100 && b < 110 && r - b > 80;
    };
    const keep: number[] = [];
    const rounds: number[] = [];
    for (let t = 0; t + 2 < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      (brass(a) && brass(b) && brass(c) ? rounds : keep).push(a, b, c);
    }
    if (!rounds.length) return;
    const arr = index.array.slice();
    arr.set(keep, 0);
    arr.set(rounds, keep.length);
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
    geo.clearGroups();
    geo.addGroup(0, keep.length, 0);
    geo.addGroup(keep.length, rounds.length, 1);
    const hidden = o.material.clone();
    hidden.name = ROUNDS;
    hidden.visible = false;
    o.material = [o.material, hidden];
  });
}

/** nome do material da alça e da massa que dobram (o terceiro da malha) */
const IRONS = 'gf-irons';

/**
 * A alça e a massa das armas de mira de ferro dobrável (espaço da arma, caixas [min, max] de x, y, z): com uma mira
 * montada elas deitam (somem), senão a alça alta da M4 ficava na frente do ponto vermelho.
 */
const FOLD: Partial<Record<GunId, [THREE.Vector3Tuple, THREE.Vector3Tuple][]>> = {
  m4: [
    [
      [-0.04, 0.113, -0.035],
      [0.04, 0.2, 0.055],
    ],
    [
      [-0.04, 0.08, -0.45],
      [0.04, 0.2, -0.372],
    ],
  ],
  mp7: [
    [
      [-0.04, 0.0985, 0.06],
      [0.04, 0.2, 0.12],
    ],
    [
      [-0.04, 0.0985, -0.17],
      [0.04, 0.2, -0.11],
    ],
  ],
};

/**
 * Separa os triângulos da alça e da massa (dentro das caixas de `FOLD`, no espaço da arma) num terceiro grupo da
 * malha, com material próprio. Uma vez por arquivo, no carregamento: mede numa cópia montada como o `fromFile` (a
 * geometria é a mesma do arquivo) e troca o índice e os materiais do original.
 */
function splitIrons(id: GunId, scene: THREE.Object3D) {
  const boxes = (FOLD[id] ?? []).map(([a, b]) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b)));
  const probe = fromFile(id, scene);
  probe.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(probe.root.matrixWorld).invert();
  const copies: THREE.Mesh[] = [];
  const originals: THREE.Mesh[] = [];
  probe.root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) copies.push(o);
  });
  scene.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) originals.push(o);
  });
  const v = new THREE.Vector3();
  copies.forEach((o, n) => {
    const orig = originals[n];
    const geo = o.geometry;
    const index = geo.index;
    if (!orig || orig.geometry !== geo || !index) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const keepGroup = geo.groups[0] ?? { start: 0, count: index.count, materialIndex: 0 };
    const rest = geo.groups[1];
    const inside = (i: number) => {
      o.getVertexPosition(i, v).applyMatrix4(m);
      return boxes.some((b) => b.containsPoint(v));
    };
    const keep: number[] = [];
    const iron: number[] = [];
    for (let t = keepGroup.start; t + 2 < keepGroup.start + keepGroup.count; t += 3) {
      const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      (tri.every(inside) ? iron : keep).push(...tri);
    }
    if (!iron.length) return;
    const roundsIdx: number[] = [];
    if (rest) for (let t = rest.start; t < rest.start + rest.count; t++) roundsIdx.push(index.getX(t));
    const arr = index.array.slice();
    arr.set(keep, 0);
    arr.set(roundsIdx, keep.length);
    arr.set(iron, keep.length + roundsIdx.length);
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
    geo.clearGroups();
    geo.addGroup(0, keep.length, 0);
    geo.addGroup(keep.length, roundsIdx.length, 1);
    geo.addGroup(keep.length + roundsIdx.length, iron.length, 2);
    const mats = Array.isArray(orig.material) ? orig.material : [orig.material];
    const main = mats[0]!;
    let hidden = mats[1];
    if (!hidden) {
      hidden = main.clone();
      hidden.name = ROUNDS;
      hidden.visible = false;
    }
    const ironMat = main.clone();
    ironMat.name = IRONS;
    orig.material = [main, hidden, ironMat];
  });
  // a cópia da medida (os materiais próprios e os esqueletos dela; a geometria é a do arquivo e fica)
  disposeGun(probe);
}

/** os pixels da textura (paleta pequena do modelo), ou nada fora do navegador */
function texels(map: THREE.Texture | null): { data: Uint8ClampedArray; w: number; h: number } | null {
  const img: unknown = map?.image;
  if (typeof document === 'undefined' || !img || typeof img !== 'object') return null;
  const w = 'width' in img && typeof img.width === 'number' ? img.width : 0;
  const h = 'height' in img && typeof img.height === 'number' ? img.height : 0;
  if (!w || !h || w * h > 1024 * 1024) return null;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    if (!x) return null;
    x.drawImage(img as CanvasImageSource, 0, 0);
    return { data: x.getImageData(0, 0, w, h).data, w, h };
  } catch {
    return null;
  }
}

export function gunsReady(): boolean {
  return templates.size > 0;
}

/** um modelo novo da arma (cada boneco e a visão em primeira pessoa têm o seu) */
export function makeGun(id: GunId): GunModel | null {
  return templates.get(id)?.build() ?? null;
}

function part(obj: THREE.Object3D, root: THREE.Object3D): Part {
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  const parentQ = obj.parent ? obj.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  return {
    obj,
    rest: obj.position.clone(),
    restQ: obj.quaternion.clone(),
    toParent: parentQ.invert().multiply(rootQ),
  };
}

/** desloca a peça `d` metros (espaço da arma) e gira `rot` rad em volta do eixo do cano */
export function movePart(p: Part | undefined, d: THREE.Vector3, rot = 0) {
  if (!p) return;
  p.obj.position.copy(p.rest).add(TMP.copy(d).applyQuaternion(p.toParent));
  p.obj.quaternion.copy(p.restQ);
  if (rot) p.obj.quaternion.premultiply(TQ.setFromAxisAngle(AXIS.copy(Z).applyQuaternion(p.toParent), rot));
}
const TMP = new THREE.Vector3();
const TQ = new THREE.Quaternion();
const AXIS = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Arma do arquivo: o cano aponta para +x no arquivo; gira para −z e põe a origem no gatilho. A mira fica no alto da
 * arma acima do gatilho, a mão de apoio a 60% do caminho até o cano, embaixo.
 */
function fromFile(id: GunId, scene: THREE.Object3D): GunModel {
  const src = SkeletonUtils.clone(scene);
  src.rotation.y = Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(src);
  holder.updateMatrixWorld(true);
  let trigger: THREE.Vector3 | null = null;
  const bones: [string, THREE.Object3D][] = [];
  let rounds: THREE.Material | undefined;
  let irons: THREE.Material | undefined;
  src.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      // cartuchos: cada cópia tem o seu material (escondido; a recarga mostra só nesta arma)
      if (Array.isArray(o.material) && o.material[1]?.name === ROUNDS) {
        rounds = own(o.material[1].clone());
        // a mira de ferro que dobra (terceiro grupo): material próprio, para esconder com uma mira montada
        const iron = o.material[2]?.name === IRONS ? own(o.material[2].clone()) : null;
        o.material = iron ? [o.material[0]!, rounds, iron] : [o.material[0]!, rounds];
        if (iron) irons = iron;
      }
      // malha com esqueleto: a esfera de corte do three é calculada uma vez, com os ossos de antes de mover a arma, e
      // fica errada (a arma sumia no boneco). Só ela fica sem corte; as peças sem esqueleto são cortadas normalmente
      if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
    }
    const n = o.name.toLowerCase();
    if (n === 'trigger') trigger = o.getWorldPosition(new THREE.Vector3());
    if (BONE_PART[n] && !bones.some(([k]) => k === n)) bones.push([n, o]);
  });
  const box = new THREE.Box3().setFromObject(src);
  const grip = trigger ?? new THREE.Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z - 0.2);
  // a origem vai para o punho (um pouco abaixo e atrás do gatilho)
  src.position.sub(new THREE.Vector3(grip.x, grip.y - 0.03, grip.z + 0.02));
  holder.updateMatrixWorld(true);
  box.setFromObject(src);
  const parts: GunModel['parts'] = {};
  for (const [n, o] of bones) {
    const k = BONE_PART[n]!;
    if (!parts[k]) parts[k] = part(o, holder);
  }
  const muzzle = new THREE.Vector3(0, (box.max.y + box.min.y) / 2 + 0.02, box.min.z);
  // eixo do cano: a altura dos pontos da metade da frente (só o cano e o guarda-mão; nada de pente ou coronha)
  const axisY = barrelAxis(holder, box.min.z) ?? muzzle.y;
  const bore = new THREE.Vector3(0, BORE_Y[id] ?? tipAxis(holder, box.min.z) ?? axisY, box.min.z);
  // linha de mira: na mira de ferro, o topo da massa (o ponto mais alto da parte da frente da arma: a ponta dela fica
  // no centro da tela, onde a bala vai); na luneta, o eixo óptico (o centro do tubo, um pouco abaixo do topo)
  const scoped = id === 'l115' || id === 'm200';
  const iron = IRON[id];
  const sight = new THREE.Vector3(
    0,
    scoped ? box.max.y - 0.025 : (iron?.rear[0] ?? frontTop(holder, box.min.z * (SIGHT_AT[id] ?? 0.6)) ?? box.max.y),
    -0.05,
  );
  // inclinação que põe a massa na linha do furo de trás (positiva: a boca sobe)
  const sightPitch = iron ? Math.atan2(iron.rear[0] - iron.front[0], iron.rear[1] - iron.front[1]) : 0;
  // mão de apoio: o ponto da arma (`SUPPORT_AT`). A altura é a da primeira superfície de baixo para cima no meio da
  // arma naquela fatia (a palma encosta nela), só se estiver perto do eixo do cano — senão logo abaixo do cano
  const sz = box.min.z * (SUPPORT_AT[id] ?? 0.6);
  const under = bottomUnder(holder, sz, axisY);
  const support = new THREE.Vector3(0, under ?? axisY - 0.02, sz);
  const supportW = halfWidthAt(holder, sz, support.y);
  if (id === 'm9') {
    // pistola: as duas mãos no punho
    support.set(0.01, -0.02, 0.02);
  }
  return {
    id,
    root: holder,
    parts,
    muzzle,
    sight,
    ...(sightPitch ? { sightPitch } : {}),
    support,
    ...(supportW ? { supportW } : {}),
    ...(rounds ? { rounds } : {}),
    ...(irons ? { irons } : {}),
    length: box.max.z - box.min.z,
    bore,
  };
}

/** Altura do eixo do furo na boca onde a medida da ponta erra: na Kar98k a massa fica bem na ponta do cano. */
const BORE_Y: Partial<Record<GunId, number>> = { kar98k: 0.066 };

/**
 * O eixo do furo bem na ponta (os últimos 1,5 cm, no meio da arma): onde a peça da boca rosqueia. O `barrelAxis`
 * (12 cm) pegava a massa da MP7, da MP5 e da AK e subia a peça acima do cano.
 */
function tipAxis(root: THREE.Object3D, front: number): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  eachPoint(root, (p) => {
    if (p.z > front + 0.015 || Math.abs(p.x) > 0.03) return;
    lo = Math.min(lo, p.y);
    hi = Math.max(hi, p.y);
  });
  return Number.isFinite(lo) ? (lo + hi) / 2 : null;
}

/** cada ponto das malhas da arma (no espaço da arma) */
function eachPoint(root: THREE.Object3D, fn: (p: THREE.Vector3) => void) {
  root.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) fn(p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
}

/** altura do eixo do cano: o meio dos pontos perto da boca (os últimos 12 cm) */
function barrelAxis(root: THREE.Object3D, front: number): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  eachPoint(root, (p) => {
    if (p.z > front + 0.12 || Math.abs(p.x) > 0.05) return;
    lo = Math.min(lo, p.y);
    hi = Math.max(hi, p.y);
  });
  return Number.isFinite(lo) ? (lo + hi) / 2 : null;
}

/** o topo da parte da frente da arma (z < `front`): a ponta da massa da mira de ferro */
function frontTop(root: THREE.Object3D, front: number): number | null {
  let max = -Infinity;
  eachPoint(root, (p) => {
    if (p.z < front && Math.abs(p.x) < 0.03 && p.y > max) max = p.y;
  });
  return Number.isFinite(max) ? max : null;
}

/**
 * A primeira superfície da arma de baixo para cima no meio dela (x = 0), na fatia `z`: o fundo do guarda-mão, onde a
 * palma encosta (um raio contra os triângulos: os vértices de uma fatia pegam pontos da lateral e erravam ~2 cm).
 * Só vale perto do eixo do cano (no máximo `BOTTOM_MAX` abaixo: pente, bipé e coronha funda não contam).
 */
function bottomUnder(root: THREE.Object3D, z: number, axisY: number): number | null {
  root.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, axisY - BOTTOM_MAX, z), new THREE.Vector3(0, 1, 0), 0, 0.2);
  const hit = ray.intersectObject(root, true)[0];
  return hit && hit.point.y <= axisY + 0.01 ? root.worldToLocal(hit.point.clone()).y : null;
}
const BOTTOM_MAX = 0.07;

/** meia largura da arma na fatia `z`, nos 4 cm acima de `y` (o guarda-mão onde os dedos fecham) */
function halfWidthAt(root: THREE.Object3D, z: number, y: number): number | null {
  let w = 0;
  eachPoint(root, (p) => {
    if (Math.abs(p.z - z) < 0.015 && p.y >= y && p.y <= y + 0.04) w = Math.max(w, Math.abs(p.x));
  });
  return w > 0 ? w : null;
}

/**
 * Centro (espaço da arma, parada) do que se vê de uma peça: na peça com esqueleto, os vértices presos ao osso dela
 * (a origem do osso fica longe da alavanca que se vê); na peça comum, a caixa da malha.
 */
export function partCenter(g: GunModel, p: Part): THREE.Vector3 | null {
  return partBox(g, p)?.getCenter(new THREE.Vector3()) ?? null;
}

/** a caixa de uma peça (no espaço da arma): os pontos da malha presos ao osso dela, ou a própria malha */
export function partBox(g: GunModel, p: Part): THREE.Box3 | null {
  g.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  g.root.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const bi = o.skeleton.bones.indexOf(p.obj as THREE.Bone);
    if (bi < 0) return;
    const idx = o.geometry.getAttribute('skinIndex');
    const wt = o.geometry.getAttribute('skinWeight');
    if (!idx || !wt) return;
    for (let i = 0; i < idx.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === bi) w += wt.getComponent(i, k);
      if (w < 0.5) continue;
      o.getVertexPosition(i, v);
      box.expandByPoint(v.applyMatrix4(o.matrixWorld).applyMatrix4(inv));
    }
  });
  if (box.isEmpty() && !(p.obj instanceof THREE.Bone)) {
    box.setFromObject(p.obj);
    if (!box.isEmpty()) box.applyMatrix4(inv);
  } else if (p.obj instanceof THREE.Bone) {
    // acessório preso ao osso (o carregador estendido): conta junto (a mão e a palma encostam nele)
    const extra = new THREE.Box3();
    p.obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.att) extra.expandByObject(o);
    });
    if (!extra.isEmpty()) box.union(extra.applyMatrix4(inv));
  }
  return box.isEmpty() ? null : box;
}

/** libera a textura dos ossos de cada esqueleto (o three cria uma por esqueleto; cada cópia tem o seu) */
export function disposeSkeletons(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
  });
}

/** material feito aqui (é do modelo: `disposeGun` libera) */
export const mat = (color: number, rough = 0.6, metal = 0.3) =>
  own(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
export function own<M extends THREE.Material>(m: M): M {
  m.userData.own = true;
  return m;
}

export function meshG(geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  return mesh(geo, m, 0, 0, 0);
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.userData.own = true;
  return o;
}

/** peças de um modelo feito em código, juntadas por material numa malha só (menos chamadas de desenho por arma) */
export class Kit {
  private readonly geos = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, m: THREE.Material): this {
    const list = this.geos.get(m) ?? [];
    // as geometrias prontas do three têm índice e a extrusão não: todas sem índice para poder juntar
    list.push(geo.index ? geo.toNonIndexed() : geo);
    if (geo.index) geo.dispose();
    this.geos.set(m, list);
    return this;
  }
  /** caixa centrada em (x, y, z) */
  box(m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): this {
    return this.add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), m);
  }
  /** cilindro deitado ao longo de z, de `z0` (trás) a `z1` (frente), raio `r0` atrás e `r1` na frente */
  tube(m: THREE.Material, r0: number, r1: number, z0: number, z1: number, x: number, y: number, seg = 12): this {
    const geo = new THREE.CylinderGeometry(r1, r0, Math.abs(z0 - z1), seg).rotateX(-Math.PI / 2);
    return this.add(geo.translate(x, y, (z0 + z1) / 2), m);
  }
  /** cilindro entre dois pontos quaisquer */
  rod(m: THREE.Material, r: number, a: THREE.Vector3, b: THREE.Vector3, seg = 8): this {
    const d = b.clone().sub(a);
    const geo = new THREE.CylinderGeometry(r, r, d.length(), seg);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    return this.add(geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), m);
  }
  /** perfil de lado (pontos [z, y] da arma) com a largura `w` em x, centrado em `x` */
  side(m: THREE.Material, pts: [number, number][], w: number, x = 0, hole?: [number, number][]): this {
    const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
    if (hole) sh.holes.push(new THREE.Path(hole.map(([z, y]) => new THREE.Vector2(-z, y))));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
    // o x do perfil vira −z da arma e a espessura vira x
    return this.add(
      geo
        .translate(0, 0, -w / 2)
        .rotateY(Math.PI / 2)
        .translate(x, 0, 0),
      m,
    );
  }
  /** perfil de frente (pontos [x, y]) puxado ao longo de z, de `z0` (trás) a `z1` (frente) */
  front(m: THREE.Material, sh: THREE.Shape, z0: number, z1: number): this {
    const geo = new THREE.ExtrudeGeometry(sh, { depth: z0 - z1, bevelEnabled: false, curveSegments: 4 });
    return this.add(geo.translate(0, 0, z1), m);
  }
  /** põe uma malha por material no grupo */
  bake(into: THREE.Object3D) {
    for (const [m, list] of this.geos) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (geo) into.add(meshG(geo, m));
    }
    this.geos.clear();
  }
}

/** perfil de frente: retângulo de `w` × (`y0`..`y1`) com os cantos de cima chanfrados em `c` e os de baixo em `cb` */
export function chamfered(w: number, y0: number, y1: number, c: number, cb = c): THREE.Shape {
  const h = w / 2;
  return new THREE.Shape([
    new THREE.Vector2(-h + cb, y0),
    new THREE.Vector2(h - cb, y0),
    new THREE.Vector2(h, y0 + cb),
    new THREE.Vector2(h, y1 - c),
    new THREE.Vector2(h - c, y1),
    new THREE.Vector2(-h + c, y1),
    new THREE.Vector2(-h, y1 - c),
    new THREE.Vector2(-h, y0 + cb),
  ]);
}

/**
 * CheyTac M200 Intervention, feita em código: cano canelado solto dentro do tubo do guarda-mão (com recortes e o trilho
 * em cima, do fim da culatra até a ponta), freio de boca grande, culatra de topo plano, luneta longa nos anéis, pente
 * na frente do guarda-mato, punho em pé, coronha retrátil de esqueleto (duas hastes, apoio de rosto e soleira) e bipé
 * dobrado sob o cano. Origem no punho, cano em −z, em metros (~1,35 m, como a L115 no jogo).
 */
function m200(): GunModel {
  const root = new THREE.Group();
  const body = mat(0x33363a, 0.5, 0.55);
  const steel = mat(0x232528, 0.42, 0.65);
  const black = mat(0x141516, 0.85, 0.1);
  const hole = mat(0x08090a, 0.9, 0.1);
  const glass = mat(0x1d2a3a, 0.12, 0.9);
  const brass = mat(0xb08a3e, 0.35, 0.8);
  brass.visible = false;
  /** altura do eixo do cano e do eixo óptico da luneta */
  const BORE = 0.076;
  const OPT = 0.155;
  const MUZZLE = -0.952;
  const k = new Kit();

  // culatra: topo plano, cantos chanfrados, da coronha (z 0,075) até o tubo do guarda-mão
  k.front(body, chamfered(0.054, 0.035, 0.108, 0.008, 0.005), 0.075, -0.215);
  // janela de ejeção e o rasgo da alavanca do ferrolho, do lado direito
  k.box(hole, 0.002, 0.02, 0.078, 0.0272, 0.087, -0.085);
  k.box(hole, 0.002, 0.03, 0.022, 0.0272, 0.077, 0.004);
  // poço do pente (embaixo da culatra) e o retém na frente dele
  k.front(body, chamfered(0.04, 0.018, 0.04, 0.003), -0.062, -0.16);
  k.box(steel, 0.016, 0.01, 0.008, 0, 0.016, -0.162);
  // trilho de cima, da traseira da culatra até a ponta do guarda-mão, com as fendas (passo de 1 cm)
  k.box(body, 0.026, 0.004, 0.71, 0, 0.11, -0.285);
  k.box(steel, 0.021, 0.007, 0.71, 0, 0.1155, -0.285);
  for (let z = 0.06; z > -0.635; z -= 0.01) k.box(hole, 0.0215, 0.004, 0.0045, 0, 0.1165, z);

  // tubo do guarda-mão (oito faces, livre do cano), com os recortes compridos dos lados e embaixo
  const HG0 = -0.215;
  const HG1 = -0.64;
  const tube = new THREE.CylinderGeometry(0.033, 0.033, HG0 - HG1, 8).rotateX(-Math.PI / 2).rotateZ(Math.PI / 8);
  k.add(tube.translate(0, BORE, (HG0 + HG1) / 2), body);
  const flat = 0.033 * Math.cos(Math.PI / 8);
  for (const z of [-0.275, -0.37, -0.465, -0.56]) {
    for (const sx of [1, -1]) k.box(hole, 0.003, 0.012, 0.075, sx * flat, BORE, z);
    k.box(hole, 0.01, 0.003, 0.075, 0, BORE - flat, z);
  }
  // anel da ponta do guarda-mão
  k.tube(steel, 0.0345, 0.0345, HG1 + 0.012, HG1, 0, BORE, 8);
  // trilhos curtos dos lados, na frente (onde se prende acessório)
  for (const sx of [1, -1]) k.box(steel, 0.006, 0.014, 0.08, sx * (flat + 0.003), BORE, HG1 + 0.06);

  // cano canelado (seis caneluras), da culatra até o freio
  const fl = new THREE.Shape();
  const N = 36;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = i % 6 === 2 || i % 6 === 3 ? 0.0128 : 0.0158;
    const p = new THREE.Vector2(Math.cos(a) * r, BORE + Math.sin(a) * r);
    if (i === 0) fl.moveTo(p.x, p.y);
    else fl.lineTo(p.x, p.y);
  }
  k.front(steel, fl, -0.2, -0.862);
  // freio de boca: bloco grande de oito faces, com as janelas dos lados e a boca na frente
  k.tube(steel, 0.0175, 0.0175, -0.855, -0.866, 0, BORE, 12);
  k.add(
    new THREE.CylinderGeometry(0.024, 0.024, 0.088, 8)
      .rotateX(-Math.PI / 2)
      .rotateZ(Math.PI / 8)
      .translate(0, BORE, -0.906),
    body,
  );
  for (const z of [-0.88, -0.903, -0.926])
    for (const sx of [1, -1]) k.box(hole, 0.004, 0.026, 0.011, sx * 0.0222, BORE, z);
  k.tube(hole, 0.009, 0.009, -0.948, MUZZLE, 0, BORE, 10);

  // bipé dobrado para a frente, por baixo do cano: articulação na ponta do guarda-mão e as duas pernas
  k.box(steel, 0.034, 0.014, 0.03, 0, BORE - flat - 0.006, HG1 + 0.02);
  for (const sx of [1, -1]) {
    const a = new THREE.Vector3(sx * 0.012, BORE - flat - 0.01, HG1 + 0.01);
    const b = new THREE.Vector3(sx * 0.012, BORE - flat - 0.008, -0.83);
    k.rod(steel, 0.0065, a, b);
    k.box(black, 0.012, 0.012, 0.022, b.x, b.y, b.z + 0.004);
  }

  // punho em pé (borracha), guarda-mato e a base do punho na culatra
  k.side(
    black,
    [
      [0.026, 0.036],
      [0.032, -0.02],
      [0.045, -0.1],
      [0.05, -0.11],
      [0.088, -0.11],
      [0.091, -0.1],
      [0.078, -0.02],
      [0.074, 0.036],
    ],
    0.03,
  );
  k.side(
    body,
    [
      [-0.066, 0.036],
      [-0.064, 0.006],
      [-0.052, -0.008],
      [0.034, -0.008],
      [0.034, 0.036],
    ],
    0.014,
    0,
    [
      [-0.058, 0.034],
      [-0.057, 0.008],
      [-0.049, 0.0],
      [0.024, 0.0],
      [0.024, 0.034],
    ],
  );

  // coronha retrátil: bloco de encaixe, duas hastes até a soleira, apoio de rosto e o monopé dobrado
  k.front(body, chamfered(0.046, 0.026, 0.102, 0.008, 0.004), 0.165, 0.075);
  k.tube(steel, 0.011, 0.011, 0.385, 0.165, 0, 0.086, 10);
  k.rod(steel, 0.0095, new THREE.Vector3(0, 0.036, 0.16), new THREE.Vector3(0, -0.036, 0.38), 10);
  k.side(
    body,
    [
      [0.37, 0.112],
      [0.37, -0.072],
      [0.388, -0.076],
      [0.388, 0.116],
    ],
    0.036,
  );
  k.side(
    black,
    [
      [0.388, 0.12],
      [0.388, -0.08],
      [0.408, -0.074],
      [0.411, 0.02],
      [0.408, 0.114],
    ],
    0.042,
  );
  // apoio de rosto em cima da haste, com os dois pinos de ajuste
  k.side(
    black,
    [
      [0.19, 0.095],
      [0.205, 0.122],
      [0.335, 0.124],
      [0.345, 0.095],
    ],
    0.032,
  );
  for (const z of [0.215, 0.315]) k.tube(steel, 0.006, 0.006, z + 0.006, z - 0.006, 0, 0.098, 6);
  k.rod(steel, 0.006, new THREE.Vector3(0, -0.012, 0.3), new THREE.Vector3(0, -0.07, 0.31), 6);
  k.box(black, 0.02, 0.008, 0.024, 0, -0.074, 0.31);

  // luneta: tubo longo, sino da objetiva grande, ocular, torres em cima e dos lados, nos dois anéis do trilho
  k.tube(steel, 0.016, 0.016, 0.06, -0.215, 0, OPT, 16);
  k.tube(steel, 0.016, 0.0285, -0.215, -0.262, 0, OPT, 16);
  k.tube(steel, 0.0285, 0.0285, -0.262, -0.33, 0, OPT, 16);
  k.tube(black, 0.029, 0.029, -0.318, -0.332, 0, OPT, 16);
  k.add(new THREE.CircleGeometry(0.025, 16).rotateY(Math.PI).translate(0, OPT, -0.3325), glass);
  k.tube(steel, 0.017, 0.0205, 0.06, 0.075, 0, OPT, 16);
  k.tube(black, 0.0205, 0.0205, 0.075, 0.098, 0, OPT, 16);
  k.add(new THREE.CircleGeometry(0.016, 16).translate(0, OPT, 0.0985), glass);
  k.tube(steel, 0.0195, 0.0195, -0.045, -0.105, 0, OPT, 12);
  k.add(new THREE.CylinderGeometry(0.0115, 0.0115, 0.026, 12).translate(0, OPT + 0.029, -0.075), steel);
  k.add(new THREE.CylinderGeometry(0.0125, 0.0125, 0.008, 12).translate(0, OPT + 0.044, -0.075), black);
  k.add(new THREE.CylinderGeometry(0.0115, 0.0115, 0.024, 12).rotateZ(Math.PI / 2).translate(0.03, OPT, -0.075), steel);
  k.add(new THREE.CylinderGeometry(0.014, 0.014, 0.014, 12).rotateZ(Math.PI / 2).translate(-0.027, OPT, -0.075), black);
  for (const z of [0.01, -0.17]) {
    k.add(new THREE.TorusGeometry(0.0195, 0.0045, 6, 16).translate(0, OPT, z), body);
    k.box(body, 0.014, 0.014, 0.018, 0, OPT - 0.028, z);
    k.box(body, 0.032, 0.008, 0.022, 0, 0.123, z);
    k.box(steel, 0.006, 0.006, 0.01, 0.019, 0.123, z);
  }
  k.bake(root);

  // ferrolho: corpo e alavanca giram juntos (em volta do eixo do ferrolho) e correm para trás; a capa de trás só corre
  const boltRot = new THREE.Group();
  boltRot.position.set(0, 0.082, -0.065);
  new Kit()
    .tube(steel, 0.011, 0.011, 0.14, -0.105, 0, 0, 10)
    .rod(steel, 0.0045, new THREE.Vector3(0.008, -0.002, 0.068), new THREE.Vector3(0.04, -0.024, 0.071))
    .add(new THREE.SphereGeometry(0.0105, 10, 8).translate(0.045, -0.027, 0.072), black)
    .bake(boltRot);
  root.add(boltRot);
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.082, 0.085);
  new Kit().tube(steel, 0.0125, 0.012, 0.012, -0.01, 0, 0, 10).box(body, 0.006, 0.01, 0.012, 0, 0.012, 0.0).bake(bolt);
  root.add(bolt);
  // gatilho (corre um pouco para trás ao atirar)
  const trigger = new THREE.Group();
  trigger.position.set(0, 0.03, -0.02);
  new Kit()
    .side(
      steel,
      [
        [-0.005, 0.004],
        [0.003, 0.004],
        [0.001, -0.01],
        [0.005, -0.024],
        [-0.001, -0.024],
        [-0.004, -0.01],
      ],
      0.006,
    )
    .bake(trigger);
  root.add(trigger);
  // pente: caixa com a base mais larga; os cartuchos de cima só aparecem com ele fora do lugar
  const mag = new THREE.Group();
  mag.position.set(0, 0.04, -0.11);
  const mk = new Kit()
    .box(body, 0.03, 0.104, 0.08, 0, -0.054, 0)
    .box(black, 0.034, 0.01, 0.086, 0, -0.109, 0.0)
    .box(hole, 0.031, 0.05, 0.004, 0, -0.06, -0.025)
    .box(hole, 0.031, 0.05, 0.004, 0, -0.06, 0.025);
  for (const x of [-0.006, 0.006]) {
    mk.tube(brass, 0.0065, 0.0065, 0.036, -0.022, x, 0.004, 8);
    mk.tube(steel, 0.0055, 0.0015, -0.022, -0.044, x, 0.004, 8);
  }
  mk.bake(mag);
  root.add(mag);
  root.traverse((o) => (o.castShadow = true));
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  return {
    id: 'm200',
    root,
    parts: {
      boltRot: part(boltRot, root),
      bolt: part(bolt, root),
      trigger: part(trigger, root),
      mag: part(mag, root),
    },
    muzzle: new THREE.Vector3(0, BORE, MUZZLE),
    bore: new THREE.Vector3(0, BORE, MUZZLE),
    // eixo óptico: o centro do tubo da luneta
    sight: new THREE.Vector3(0, OPT, -0.05),
    // mão de apoio por baixo do tubo do guarda-mão, logo na frente da culatra
    support: new THREE.Vector3(0, BORE - flat, -0.3),
    supportW: 0.024,
    rounds: brass,
    length: box.max.z - box.min.z,
  };
}

/**
 * Desert Eagle: cano fixo de perfil triangular (estreito em cima, com o trilho) por todo o comprimento, ferrolho alto
 * atrás com a frente chanfrada, as ranhuras, a janela de ejeção à direita e a trava ambidestra; cão externo,
 * guarda-mato grande e redondo, punho grosso com placas e o pé do carregador. Só o ferrolho recua no tiro (como na
 * de verdade); o carregador sai para a recarga. Origem no punho, cano em −z.
 */
function deagle(): GunModel {
  const root = new THREE.Group();
  const steel = mat(0x8e9296, 0.35, 0.85);
  const dark = mat(0x26272a, 0.5, 0.5);
  const grip = mat(0x1c1c1e, 0.85, 0.05);
  const hole = mat(0x0b0b0c, 0.9, 0.1);
  /** altura do eixo do cano, da linha de mira (fundo do entalhe de trás = topo da massa) e da boca */
  const BORE = 0.066;
  const SIGHT = 0.1;
  const MUZZLE = -0.218;

  const k = new Kit();
  // cano: perfil de frente triangular (largo embaixo, estreito em cima), da boca até dentro do ferrolho
  const tri = new THREE.Shape([
    new THREE.Vector2(-0.0155, 0.048),
    new THREE.Vector2(0.0155, 0.048),
    new THREE.Vector2(0.0155, 0.064),
    new THREE.Vector2(0.006, 0.088),
    new THREE.Vector2(-0.006, 0.088),
    new THREE.Vector2(-0.0155, 0.064),
  ]);
  k.front(steel, tri, -0.04, MUZZLE);
  // boca e o trilho de cima, com as fendas, até a massa
  k.tube(hole, 0.0062, 0.0062, MUZZLE + 0.004, MUZZLE - 0.0005, 0, BORE, 10);
  k.box(steel, 0.01, 0.006, 0.13, 0, 0.091, -0.135);
  for (let z = -0.08; z > -0.195; z -= 0.012) k.box(hole, 0.0105, 0.0025, 0.004, 0, 0.0925, z);
  // massa (pequena, em cima da ponta do trilho)
  k.side(
    dark,
    [
      [-0.205, 0.094],
      [-0.2, SIGHT],
      [-0.19, SIGHT],
      [-0.188, 0.094],
    ],
    0.004,
  );
  // armação: por baixo do cano até perto da boca, com a ponta chanfrada, e o rabo de andorinha atrás
  k.side(
    dark,
    [
      [-0.212, 0.049],
      [-0.205, 0.03],
      [-0.07, 0.022],
      [0.05, 0.022],
      [0.07, 0.035],
      [0.075, 0.05],
      [0.06, 0.05],
    ],
    0.03,
  );
  // guarda-mato grande e redondo, na frente do punho
  k.side(
    dark,
    [
      [-0.062, 0.024],
      [-0.074, 0.002],
      [-0.07, -0.022],
      [-0.054, -0.036],
      [0.006, -0.034],
      [0.012, 0.024],
    ],
    0.012,
    0,
    [
      [-0.057, 0.02],
      [-0.065, 0.002],
      [-0.062, -0.018],
      [-0.05, -0.027],
      [0.002, -0.026],
      [0.005, 0.02],
    ],
  );
  // gatilho
  k.side(
    steel,
    [
      [-0.034, 0.022],
      [-0.026, 0.022],
      [-0.028, 0.006],
      [-0.022, -0.012],
      [-0.028, -0.012],
      [-0.034, 0.004],
    ],
    0.006,
  );
  // punho grosso inclinado (armação de aço) e as placas de borracha dos dois lados
  const handle: [number, number][] = [
    [-0.004, 0.024],
    [0.018, -0.112],
    [0.072, -0.112],
    [0.058, 0.024],
  ];
  k.side(dark, handle, 0.03);
  k.side(
    grip,
    [
      [0.004, 0.012],
      [0.022, -0.1],
      [0.064, -0.1],
      [0.052, 0.012],
    ],
    0.036,
  );
  // cão externo (com a espora) atrás do ferrolho
  k.side(
    dark,
    [
      [0.056, 0.05],
      [0.062, 0.084],
      [0.074, 0.088],
      [0.072, 0.078],
      [0.066, 0.05],
    ],
    0.008,
  );
  k.bake(root);

  // ferrolho alto: lado com a frente chanfrada, tampa de cima mais estreita (o chanfro de cima), ranhuras atrás,
  // janela de ejeção à direita, trava ambidestra e a alça de mira com o entalhe
  const slide = new THREE.Group();
  const sk = new Kit()
    .side(
      steel,
      [
        [-0.098, 0.048],
        [-0.072, 0.088],
        [0.056, 0.088],
        [0.058, 0.048],
      ],
      0.032,
    )
    .side(
      steel,
      [
        [-0.07, 0.088],
        [-0.066, 0.094],
        [0.052, 0.094],
        [0.055, 0.088],
      ],
      0.022,
    )
    .box(hole, 0.0015, 0.014, 0.034, 0.0162, 0.078, -0.03)
    .box(dark, 0.042, 0.008, 0.014, 0, 0.074, 0.046)
    .box(dark, 0.004, 0.012, 0.01, 0.0055, SIGHT, 0.046)
    .box(dark, 0.004, 0.012, 0.01, -0.0055, SIGHT, 0.046)
    .box(dark, 0.016, 0.006, 0.01, 0, SIGHT - 0.003, 0.046);
  for (let i = 0; i < 7; i++)
    for (const sx of [1, -1]) sk.box(hole, 0.0012, 0.03, 0.0025, sx * 0.0162, 0.068, 0.012 + i * 0.0055);
  sk.bake(slide);
  root.add(slide);

  // carregador: corpo dentro do punho (inclinado como ele) e o pé embaixo
  const magazine = new THREE.Group();
  magazine.position.set(0, -0.06, 0.035);
  new Kit()
    .add(new THREE.BoxGeometry(0.022, 0.1, 0.034).rotateX(-0.16), dark)
    .box(grip, 0.034, 0.01, 0.058, 0, -0.056, 0.008)
    .bake(magazine);
  root.add(magazine);
  root.traverse((o) => (o.castShadow = true));
  const parts: GunModel['parts'] = { slide: part(slide, root), mag: part(magazine, root) };
  return {
    id: 'deagle',
    root,
    parts,
    muzzle: new THREE.Vector3(0, BORE, MUZZLE),
    bore: new THREE.Vector3(0, BORE, MUZZLE),
    // linha de mira: o fundo do entalhe da alça de trás, alinhado com o topo da massa
    sight: new THREE.Vector3(0, SIGHT, 0.03),
    support: new THREE.Vector3(0.01, -0.03, 0.03),
    length: 0.075 - MUZZLE,
  };
}

/** Karambit (lâmina curva em gancho e argola) ou baioneta M9 (lâmina reta com serrilha e cabo com guarda) */
function knife(id: 'karambit' | 'bayonet'): GunModel {
  const root = new THREE.Group();
  // aço das lâminas: sem mapa de ambiente, metal claro estoura em branco; mais escuro e menos liso lê como aço
  // (o karambit, de lâmina pequena e curva, um pouco mais claro para a face aparecer)
  const steel = id === 'karambit' ? mat(0xaab1b9, 0.4, 0.55) : mat(0x8d949c, 0.45, 0.6);
  const handleMat = mat(0x1d1e20, 0.8, 0.05);
  /** cabo do karambit (só existe nele) */
  let gripMat: THREE.Material | null = null;
  const blade = new THREE.Group();
  if (id === 'karambit') {
    // desenhado no plano (x = para onde a garra aponta, y = da argola até a lâmina, em metros) e depois girado:
    // cabo em pé na mão, argola em cima, lâmina saindo por baixo e curvando para a frente
    const toWorld = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(-1, 0, 0),
    );
    const center = new THREE.Matrix4().makeTranslation(0, -0.062, 0);
    const solid = (sh: THREE.Shape, depth: number, bevel: number) => {
      const geo = new THREE.ExtrudeGeometry(sh, {
        depth,
        bevelEnabled: true,
        bevelSize: bevel,
        bevelThickness: bevel,
        bevelSegments: 2,
        curveSegments: 16,
      });
      geo
        .translate(0, 0, -depth / 2)
        .applyMatrix4(center)
        .applyMatrix4(toWorld);
      return geo;
    };
    // cabo com quatro encaixes de dedo na frente e o dorso reto
    const hs = new THREE.Shape();
    hs.moveTo(-0.013, 0.024);
    hs.lineTo(-0.015, 0.112);
    hs.lineTo(0.015, 0.124);
    hs.quadraticCurveTo(0.024, 0.11, 0.02, 0.1);
    for (const y of [0.088, 0.071, 0.054]) {
      hs.quadraticCurveTo(0.011, y + 0.006, 0.019, y - 0.005);
      hs.quadraticCurveTo(0.024, y - 0.01, 0.02, y - 0.015);
    }
    hs.quadraticCurveTo(0.012, 0.03, 0.01, 0.022);
    hs.closePath();
    const grip = (gripMat = own(new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.9 })));
    root.add(meshG(solid(hs, 0.016, 0.0025), grip));
    // dois parafusos e as ranhuras do dorso
    for (const y of [0.05, 0.094]) {
      for (const z of [1, -1]) {
        const sc = meshG(new THREE.CylinderGeometry(0.0028, 0.0028, 0.003, 10).rotateZ(Math.PI / 2), steel);
        sc.position.set(z * 0.0105, -(y - 0.062), 0.001);
        root.add(sc);
      }
    }
    for (let i = 0; i < 4; i++) {
      const rib = meshG(new THREE.BoxGeometry(0.018, 0.002, 0.004), grip);
      rib.position.set(0, -(0.032 + i * 0.007 - 0.062), 0.016);
      root.add(rib);
    }
    // argola na ponta do cabo
    const ring = meshG(new THREE.TorusGeometry(0.017, 0.0055, 10, 28).rotateY(Math.PI / 2), steel);
    ring.position.set(0, 0.062 - 0.006, 0.004);
    root.add(ring);
    // lâmina em garra: dorso por fora, fio na curva de dentro, ponta bem fina
    const bs = new THREE.Shape();
    bs.moveTo(-0.014, 0.11);
    bs.quadraticCurveTo(-0.012, 0.17, 0.05, 0.19);
    bs.quadraticCurveTo(0.1, 0.2, 0.135, 0.185);
    bs.quadraticCurveTo(0.095, 0.178, 0.06, 0.162);
    bs.quadraticCurveTo(0.025, 0.145, 0.016, 0.122);
    bs.closePath();
    blade.add(meshG(solid(bs, 0.0035, 0.0012), steel));
  } else {
    const s = new THREE.Shape();
    s.moveTo(0, -0.012);
    s.lineTo(0.17, -0.012);
    s.lineTo(0.2, 0.0);
    s.lineTo(0.17, 0.014);
    s.lineTo(0, 0.014);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.004,
      bevelEnabled: true,
      bevelSize: 0.0015,
      bevelThickness: 0.002,
      bevelSegments: 1,
    });
    geo.translate(0, 0, -0.002).rotateY(Math.PI / 2);
    blade.add(mesh(geo, steel, 0, 0.0, -0.06));
    for (let i = 0; i < 5; i++)
      blade.add(mesh(new THREE.BoxGeometry(0.004, 0.006, 0.01), steel, 0, 0.017, -0.09 - i * 0.013));
    root.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 8).rotateX(Math.PI / 2), handleMat, 0, 0, 0.0));
    root.add(mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), steel, 0, 0, -0.06));
  }
  root.add(blade);
  root.traverse((o) => (o.castShadow = true));
  // centro do cabo, medido no modelo (as malhas do cabo usam o material dele)
  const handleBox = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && (o.material === handleMat || o.material === gripMat)) handleBox.expandByObject(o);
  });
  return {
    id,
    root,
    parts: { blade: part(blade, root) },
    ...(handleBox.isEmpty() ? {} : { handle: handleBox.getCenter(new THREE.Vector3()) }),
    muzzle: new THREE.Vector3(0, 0, -0.25),
    sight: new THREE.Vector3(0, 0.05, 0),
    support: new THREE.Vector3(0, 0, 0),
    length: 0.25,
  };
}

/** libera as geometrias e os materiais próprios de um modelo (os do arquivo são compartilhados e ficam) */
export function disposeGun(g: GunModel) {
  const mats = new Set<THREE.Material>();
  g.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.userData.own) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if ((m as THREE.Material).userData.own) mats.add(m as THREE.Material);
  });
  for (const m of mats) m.dispose();
  disposeSkeletons(g.root);
  g.root.removeFromParent();
}
