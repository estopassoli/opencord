/**
 * O desenho do mapa do gunfight (as caixas de `map.ts` viram contêineres, muros, caixotes e o galpão), com chão de
 * asfalto, faixas pintadas e postes de luz. Contêiner tem frisos e portas no fundo para não parecer um bloco liso.
 */
import * as THREE from 'three';
import { GUN_BOXES, GUN_HALF, type MapBox } from './map';

export function buildGunMap(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'gunmap';
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GUN_HALF * 2 + 2, GUN_HALF * 2 + 2),
    new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  // faixas amarelas no chão (corredores)
  const paint = new THREE.MeshBasicMaterial({ color: 0xc9a53a });
  for (const z of [-7, 7]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(GUN_HALF * 2 - 4, 0.12), paint);
    s.rotation.x = -Math.PI / 2;
    s.position.set(0, 0.006, z);
    g.add(s);
  }
  for (const b of GUN_BOXES) g.add(boxMesh(b));
  // postes de luz nos cantos
  for (const [x, z] of [
    [-GUN_HALF + 1, -GUN_HALF + 1],
    [GUN_HALF - 1, GUN_HALF - 1],
    [-GUN_HALF + 1, GUN_HALF - 1],
    [GUN_HALF - 1, -GUN_HALF + 1],
  ] as const) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 7, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30 }),
    );
    pole.position.set(x, 3.5, z);
    g.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.15, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffe2a0, emissiveIntensity: 1.2 }),
    );
    lamp.position.set(x * 0.95, 7, z * 0.95);
    g.add(lamp);
    const light = new THREE.PointLight(0xffd9a0, 18, 26, 1.6);
    light.position.copy(lamp.position).add(new THREE.Vector3(0, -0.3, 0));
    g.add(light);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = o !== ground;
      o.receiveShadow = true;
    }
  });
  return g;
}

function boxMesh(b: MapBox): THREE.Object3D {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const c = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  const rough = b.kind === 'container' ? 0.55 : 0.9;
  const m = new THREE.MeshStandardMaterial({
    color: b.color,
    roughness: rough,
    metalness: b.kind === 'container' ? 0.35 : 0,
  });
  const main = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  main.position.copy(c);
  if (b.kind !== 'container') return main;
  // contêiner: frisos verticais nas laterais longas e a moldura do fundo
  const grp = new THREE.Group();
  grp.add(main);
  const along = sx > sz;
  const len = along ? sx : sz;
  const rib = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color).multiplyScalar(0.8), roughness: 0.6 });
  for (let i = 1; i < 12; i++) {
    const t = -len / 2 + (i * len) / 12;
    for (const side of [1, -1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.06 : 0.04, sy * 0.92, along ? 0.04 : 0.06), rib);
      r.position.set(c.x + (along ? t : (side * sx) / 2), c.y, c.z + (along ? (side * sz) / 2 : t));
      grp.add(r);
    }
  }
  const frame = new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.7 });
  for (const end of [1, -1]) {
    const f = new THREE.Mesh(
      new THREE.BoxGeometry(along ? 0.05 : sx * 1.01, sy * 1.01, along ? sz * 1.01 : 0.05),
      frame,
    );
    f.position.set(c.x + (along ? (end * sx) / 2 : 0), c.y, c.z + (along ? 0 : (end * sz) / 2));
    grp.add(f);
  }
  return grp;
}
