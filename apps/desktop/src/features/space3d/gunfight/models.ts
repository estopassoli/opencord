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
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import ak47Url from '../assets/guns/ak47.glb?url';
import kar98kUrl from '../assets/guns/kar98k.glb?url';
import l115Url from '../assets/guns/l115.glb?url';
import m24Url from '../assets/guns/m24.glb?url';
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
}

/**
 * Mão de apoio: que fração do caminho do punho até a boca (meio do guarda-mão). Fuzil no meio do guarda-mão; sniper
 * e Kar98k na ponta da coronha de madeira, por baixo; submetralhadora bem à frente.
 */
const SUPPORT_AT: Partial<Record<GunId, number>> = {
  m4: 0.48,
  ak47: 0.44,
  l115: 0.3,
  m200: 0.3,
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

interface Template {
  scene: THREE.Object3D;
  build: () => GunModel;
}

const FILE: Partial<Record<GunId | 'm24', string>> = {
  m4: m4Url,
  ak47: ak47Url,
  mp7: mp7Url,
  mp5: mp5Url,
  l115: l115Url,
  kar98k: kar98kUrl,
  m9: m9Url,
  m24: m24Url,
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
      (Object.entries(FILE) as [GunId | 'm24', string][]).map(
        async ([id, url]) => [id, await loader.loadAsync(url)] as const,
      ),
    );
    const scenes = new Map(files.map(([id, g]) => [id, g.scene]));
    const kar = scenes.get('kar98k');
    if (kar) darkenWood(kar);
    // a M24 é a base da M200, que tinge o material inteiro (precisa dele sozinho, sem a lista de dois materiais)
    for (const [id, scene] of scenes) if (id !== 'm24') splitRounds(scene);
    for (const [id, scene] of scenes) {
      if (id === 'm24') continue;
      templates.set(id, { scene, build: () => fromFile(id, scene) });
    }
    const m24 = scenes.get('m24');
    if (m24) templates.set('m200', { scene: m24, build: () => m200(m24) });
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
  src.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      // cartuchos: cada cópia tem o seu material (escondido; a recarga mostra só nesta arma)
      if (Array.isArray(o.material) && o.material[1]?.name === ROUNDS) {
        rounds = own(o.material[1].clone());
        o.material = [o.material[0]!, rounds];
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
  // linha de mira: na mira de ferro, o topo da massa (o ponto mais alto da parte da frente da arma: a ponta dela fica
  // no centro da tela, onde a bala vai); na luneta, o eixo óptico (o centro do tubo, um pouco abaixo do topo)
  const scoped = id === 'l115' || id === 'm200';
  const sight = new THREE.Vector3(
    0,
    scoped ? box.max.y - 0.025 : (frontTop(holder, box.min.z * (SIGHT_AT[id] ?? 0.6)) ?? box.max.y),
    -0.05,
  );
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
    support,
    ...(supportW ? { supportW } : {}),
    ...(rounds ? { rounds } : {}),
    length: box.max.z - box.min.z,
  };
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
const mat = (color: number, rough = 0.6, metal = 0.3) =>
  own(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
function own<M extends THREE.Material>(m: M): M {
  m.userData.own = true;
  return m;
}

function meshG(geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  return mesh(geo, m, 0, 0, 0);
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.userData.own = true;
  return o;
}

/**
 * M200: a mesma base do ferrolho do M24 (receptor, gatilho, pente e luneta com esqueleto), com o cano grosso de
 * capa canelada, a coronha de esqueleto e o bipé, em areia — a silhueta da M200.
 */
function m200(m24: THREE.Object3D): GunModel {
  const g = fromFile('m200', m24);
  const tan = mat(0xb59a6a, 0.7, 0.1);
  g.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
      const m = own(o.material.clone());
      m.color.lerp(new THREE.Color(0xb59a6a), 0.55);
      o.material = m;
    }
  });
  const dark = mat(0x2b2c2f, 0.5, 0.6);
  // capa do cano: tubo grosso com caneluras, do receptor até perto da boca
  const z0 = -0.22;
  const z1 = g.muzzle.z + 0.08;
  const y = g.muzzle.y;
  const len = z0 - z1;
  const mid = (z0 + z1) / 2;
  g.root.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, len, 10).rotateX(Math.PI / 2), tan, 0, y, mid));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.root.add(
      mesh(new THREE.BoxGeometry(0.007, 0.007, len * 0.85), dark, Math.cos(a) * 0.029, y + Math.sin(a) * 0.029, mid),
    );
  }
  // freio de boca largo e o bipé dobrado embaixo da capa
  g.root.add(mesh(new THREE.BoxGeometry(0.055, 0.045, 0.08), dark, 0, y, g.muzzle.z + 0.04));
  for (const sx of [1, -1])
    g.root.add(mesh(new THREE.BoxGeometry(0.012, 0.012, 0.22), dark, sx * 0.02, y - 0.04, z0 - 0.15));
  g.muzzle.z -= 0.01;
  return g;
}

/** Desert Eagle: ferrolho de perfil triangular, cano longo, punho grosso; ferrolho e pente separados para animar */
function deagle(): GunModel {
  const root = new THREE.Group();
  const steel = mat(0x8e9296, 0.35, 0.85);
  const dark = mat(0x26272a, 0.5, 0.5);
  const grip = mat(0x1c1c1e, 0.85, 0.05);
  const frame = new THREE.Group();
  root.add(frame);
  frame.add(mesh(new THREE.BoxGeometry(0.034, 0.03, 0.2), steel, 0, 0.035, -0.05));
  frame.add(mesh(new THREE.BoxGeometry(0.03, 0.012, 0.04), dark, 0, 0.0, -0.03));
  const handle = mesh(new THREE.BoxGeometry(0.032, 0.13, 0.055), grip, 0, -0.05, 0.03);
  handle.rotation.x = -0.2;
  frame.add(handle);
  const guard = mesh(new THREE.TorusGeometry(0.022, 0.004, 4, 10, Math.PI).rotateY(Math.PI / 2), dark, 0, 0.005, -0.03);
  guard.rotation.x = Math.PI;
  frame.add(guard);
  // ferrolho: corpo com o topo chanfrado (prisma) e o cano por dentro
  const slide = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.019, 0);
  shape.lineTo(0.019, 0);
  shape.lineTo(0.016, 0.03);
  shape.lineTo(0.006, 0.042);
  shape.lineTo(-0.006, 0.042);
  shape.lineTo(-0.016, 0.03);
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: false });
  body.translate(0, 0, -0.2);
  slide.add(mesh(body, steel, 0, 0.045, 0));
  slide.add(mesh(new THREE.BoxGeometry(0.006, 0.012, 0.012), dark, 0, 0.093, -0.19));
  slide.add(mesh(new THREE.BoxGeometry(0.02, 0.01, 0.01), dark, 0, 0.093, 0.05));
  root.add(slide);
  const magazine = mesh(new THREE.BoxGeometry(0.024, 0.1, 0.04), dark, 0, -0.06, 0.03);
  magazine.rotation.x = -0.2;
  root.add(magazine);
  root.traverse((o) => (o.castShadow = true));
  const parts: GunModel['parts'] = { slide: part(slide, root), mag: part(magazine, root) };
  return {
    id: 'deagle',
    root,
    parts,
    muzzle: new THREE.Vector3(0, 0.065, -0.22),
    sight: new THREE.Vector3(0, 0.1, 0.03),
    support: new THREE.Vector3(0.01, -0.03, 0.03),
    length: 0.27,
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
