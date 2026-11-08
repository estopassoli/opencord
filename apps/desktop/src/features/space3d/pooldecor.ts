/** Mesa de sinuca do Espaço 3D (ADR-0055): feltro, tabelas, caçapas e pés. Só visual (a física fica em pool.ts). */
import * as THREE from 'three';
import { POCKETS, POOL_HX, POOL_HZ, POOL_Y } from './pool';

export function buildPoolDecor(): THREE.Group {
  const g = new THREE.Group();
  const felt = new THREE.Mesh(
    new THREE.BoxGeometry(POOL_HX * 2, 0.06, POOL_HZ * 2),
    new THREE.MeshLambertMaterial({ color: 0x1f7a4a }),
  );
  felt.position.y = POOL_Y - 0.03;
  g.add(felt);
  const wood = new THREE.MeshLambertMaterial({ color: 0x6b3f22 });
  const rail = 0.12;
  for (const s of [1, -1]) {
    const long = new THREE.Mesh(new THREE.BoxGeometry(POOL_HX * 2 + rail * 2, 0.1, rail), wood);
    long.position.set(0, POOL_Y + 0.02, s * (POOL_HZ + rail / 2));
    g.add(long);
    const short = new THREE.Mesh(new THREE.BoxGeometry(rail, 0.1, POOL_HZ * 2), wood);
    short.position.set(s * (POOL_HX + rail / 2), POOL_Y + 0.02, 0);
    g.add(short);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(POOL_HX * 2 + 0.1, 0.3, POOL_HZ * 2 + 0.1), wood);
  body.position.y = POOL_Y - 0.2;
  g.add(body);
  for (const [x, z] of [
    [-POOL_HX + 0.1, -POOL_HZ + 0.1],
    [POOL_HX - 0.1, -POOL_HZ + 0.1],
    [-POOL_HX + 0.1, POOL_HZ - 0.1],
    [POOL_HX - 0.1, POOL_HZ - 0.1],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, POOL_Y - 0.35, 0.12), wood);
    leg.position.set(x, (POOL_Y - 0.35) / 2, z);
    g.add(leg);
  }
  for (const [x, z] of POCKETS) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.065, 16), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(x, POOL_Y + 0.001, z);
    g.add(hole);
  }
  // luminária em cima da mesa
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.5, 0.25, 8, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x2f6f4a, emissive: 0x1a3a2a, side: THREE.DoubleSide }),
  );
  lamp.position.set(0, 2.2, 0);
  g.add(lamp);
  const light = new THREE.PointLight(0xfff1d0, 4, 6, 1.6);
  light.position.set(0, 2, 0);
  g.add(light);
  g.traverse((o) => (o.raycast = () => undefined));
  return g;
}
