/**
 * O desenho do mapa do gunfight (as caixas de `map.ts` viram contêineres, muros, caixotes e o galpão), com chão de
 * asfalto, faixas pintadas e postes de luz. Contêiner tem frisos e portas no fundo para não parecer um bloco liso.
 *
 * Desempenho: os materiais são do módulo (um por cor, criados uma vez e reaproveitados a cada entrada na zona 8) e as
 * peças de um mesmo material viram uma malha só (`mergeGeometries`) — o mapa inteiro fica em poucas dezenas de
 * chamadas de desenho em vez de ~390. Quem tira o mapa da cena só libera as geometrias (os materiais ficam).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GUN_BOXES, GUN_HALF, type MapBox } from './map';

/** materiais do mapa, um por aparência (nunca liberados: voltam na próxima vez) */
const MATS = new Map<string, THREE.Material>();
function std(color: number, rough: number, metal = 0, emissive = 0): THREE.Material {
  const key = `${color}:${rough}:${metal}:${emissive}`;
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      ...(emissive ? { emissive, emissiveIntensity: 1.2 } : {}),
    });
    MATS.set(key, m);
  }
  return m;
}
let paintMat: THREE.MeshBasicMaterial | null = null;

/** juntando as peças: geometria já no lugar (mundo), agrupada pelo material */
class Batch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) {
    geo.translate(x, y, z);
    const list = this.parts.get(m);
    if (list) list.push(geo);
    else this.parts.set(m, [geo]);
  }
  /** uma malha por material */
  build(g: THREE.Group) {
    for (const [m, geos] of this.parts) {
      const geo = mergeGeometries(geos, false);
      for (const p of geos) p.dispose();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    this.parts.clear();
  }
}

export function buildGunMap(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'gunmap';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GUN_HALF * 2 + 2, GUN_HALF * 2 + 2), std(0x3a3c40, 0.95));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  // faixas amarelas no chão (corredores)
  paintMat ??= new THREE.MeshBasicMaterial({ color: 0xc9a53a });
  const batch = new Batch();
  for (const z of [-7, 7]) {
    const s = new THREE.PlaneGeometry(GUN_HALF * 2 - 4, 0.12).rotateX(-Math.PI / 2);
    batch.add(s, paintMat, 0, 0.006, z);
  }
  for (const b of GUN_BOXES) boxParts(b, batch);
  // postes de luz nos cantos
  for (const [x, z] of [
    [-GUN_HALF + 1, -GUN_HALF + 1],
    [GUN_HALF - 1, GUN_HALF - 1],
    [-GUN_HALF + 1, GUN_HALF - 1],
    [GUN_HALF - 1, -GUN_HALF + 1],
  ] as const) {
    batch.add(new THREE.CylinderGeometry(0.08, 0.1, 7, 8), std(0x2a2c30, 1), x, 3.5, z);
    batch.add(new THREE.BoxGeometry(0.6, 0.15, 0.3), std(0xfff1c8, 1, 0, 0xffe2a0), x * 0.95, 7, z * 0.95);
    const light = new THREE.PointLight(0xffd9a0, 18, 26, 1.6);
    light.position.set(x * 0.95, 6.7, z * 0.95);
    g.add(light);
  }
  batch.build(g);
  return g;
}

function boxParts(b: MapBox, batch: Batch) {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const c = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  const container = b.kind === 'container';
  batch.add(
    new THREE.BoxGeometry(sx, sy, sz),
    std(b.color, container ? 0.55 : 0.9, container ? 0.35 : 0),
    c.x,
    c.y,
    c.z,
  );
  if (!container) return;
  // contêiner: frisos verticais nas laterais longas e a moldura do fundo
  const along = sx > sz;
  const len = along ? sx : sz;
  const rib = std(new THREE.Color(b.color).multiplyScalar(0.8).getHex(), 0.6);
  for (let i = 1; i < 12; i++) {
    const t = -len / 2 + (i * len) / 12;
    for (const side of [1, -1])
      batch.add(
        new THREE.BoxGeometry(along ? 0.06 : 0.04, sy * 0.92, along ? 0.04 : 0.06),
        rib,
        c.x + (along ? t : (side * sx) / 2),
        c.y,
        c.z + (along ? (side * sz) / 2 : t),
      );
  }
  const frame = std(0x222326, 0.7);
  for (const end of [1, -1])
    batch.add(
      new THREE.BoxGeometry(along ? 0.05 : sx * 1.01, sy * 1.01, along ? sz * 1.01 : 0.05),
      frame,
      c.x + (along ? (end * sx) / 2 : 0),
      c.y,
      c.z + (along ? 0 : (end * sz) / 2),
    );
}
