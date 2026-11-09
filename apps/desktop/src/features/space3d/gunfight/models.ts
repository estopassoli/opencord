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

export type PartName = 'mag' | 'bolt' | 'slide' | 'charge' | 'boltRot' | 'blade';

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
  length: number;
}

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
  src.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.frustumCulled = false;
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
  const sight = new THREE.Vector3(0, box.max.y + (id === 'l115' ? -0.01 : 0.01), -0.05);
  // mão de apoio: fuzil e submetralhadora em "C-clamp" (bem à frente no guarda-mão); sniper no meio, por baixo
  const sniper = id === 'l115' || id === 'm200' || id === 'kar98k';
  const support = new THREE.Vector3(0, 0.0, box.min.z * (sniper ? 0.5 : 0.7));
  if (id === 'm9') {
    // pistola: as duas mãos no punho
    support.set(0.01, -0.02, 0.02);
  }
  return { id, root: holder, parts, muzzle, sight, support, length: box.max.z - box.min.z };
}

const mat = (color: number, rough = 0.6, metal = 0.3) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

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
      const m = o.material.clone();
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
  const steel = mat(0xdde2e8, 0.28, 0.55);
  const handleMat = mat(0x1d1e20, 0.8, 0.05);
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
    const grip = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.9 });
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
  return {
    id,
    root,
    parts: { blade: part(blade, root) },
    muzzle: new THREE.Vector3(0, 0, -0.25),
    sight: new THREE.Vector3(0, 0.05, 0),
    support: new THREE.Vector3(0, 0, 0),
    length: 0.25,
  };
}

/** libera as geometrias e os materiais próprios de um modelo (os do arquivo são compartilhados e ficam) */
export function disposeGun(g: GunModel) {
  g.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.own) o.geometry.dispose();
  });
  g.root.removeFromParent();
}
