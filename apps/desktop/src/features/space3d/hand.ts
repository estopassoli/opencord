/**
 * Mão com dedos (bonecos e primeira pessoa): palma, quatro dedos de três falanges e polegar de duas, cada falange uma
 * cápsula girando na junta. `setCurl` fecha os dedos (0 aberta, 1 punho fechado) — em volta do punho da arma, da faca
 * ou do guarda-mão. Medidas de mão adulta (m); o boneco usa a mesma mão em escala.
 *
 * Espaço da mão: o pulso na origem, a palma e os dedos para −z, a palma virada para −y, o dorso para +y. Na mão
 * direita (`side` 1) o polegar fica em −x; na esquerda, em +x.
 */
import * as THREE from 'three';

const FINGERS = [
  // x na palma, comprimentos das 3 falanges
  { x: 0.027, len: [0.042, 0.026, 0.022] },
  { x: 0.009, len: [0.046, 0.029, 0.023] },
  { x: -0.009, len: [0.043, 0.027, 0.022] },
  { x: -0.026, len: [0.034, 0.021, 0.019] },
];
const R = 0.0085;

export interface Hand {
  root: THREE.Group;
  /** fecha os dedos (0–1); o polegar fecha junto, um pouco menos */
  setCurl(c: number, thumb?: number): void;
  dispose(): void;
}

export function makeHand(color: THREE.ColorRepresentation, side: 1 | -1): Hand {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const geos: THREE.BufferGeometry[] = [];
  const geo = (g: THREE.BufferGeometry) => (geos.push(g), g);
  // palma arredondada (uma esfera achatada) e o volume do pulso
  const palm = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 16, 12)), mat);
  palm.scale.set(0.043, 0.017, 0.05);
  palm.position.set(0, 0, -0.046);
  root.add(palm);
  const wrist = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 12, 10)), mat);
  wrist.scale.set(0.03, 0.02, 0.03);
  wrist.position.set(0, 0, -0.008);
  root.add(wrist);
  // cada dedo: uma corrente de juntas; a falange vai de 0 até −len no z da junta
  const joints: THREE.Object3D[][] = [];
  const mirror = side === 1 ? 1 : -1;
  for (const f of FINGERS) {
    const chain: THREE.Object3D[] = [];
    let parent: THREE.Object3D = root;
    let z = -0.088;
    for (let i = 0; i < 3; i++) {
      const j = new THREE.Group();
      j.position.set(i === 0 ? f.x * -mirror : 0, i === 0 ? 0.002 : 0, i === 0 ? z : -f.len[i - 1]!);
      const ph = new THREE.Mesh(
        geo(new THREE.CapsuleGeometry(R * (1 - i * 0.08), f.len[i]! - R * 1.4, 3, 8).rotateX(Math.PI / 2)),
        mat,
      );
      ph.position.z = -f.len[i]! / 2;
      j.add(ph);
      parent.add(j);
      chain.push(j);
      parent = j;
      z = 0;
    }
    joints.push(chain);
  }
  // polegar: sai da lateral da palma, perto do pulso, apontando para a frente e para dentro
  const thumbBase = new THREE.Group();
  thumbBase.position.set(0.036 * -mirror * -1, -0.008, -0.03);
  thumbBase.rotation.set(0, 0.7 * -mirror * -1, 0);
  root.add(thumbBase);
  const thumb: THREE.Object3D[] = [];
  let tp: THREE.Object3D = thumbBase;
  for (const [i, len] of [0.036, 0.03].entries()) {
    const j = new THREE.Group();
    if (i > 0) j.position.z = -0.036;
    const ph = new THREE.Mesh(geo(new THREE.CapsuleGeometry(R * 1.15, len - R * 1.4, 3, 8).rotateX(Math.PI / 2)), mat);
    ph.position.z = -len / 2;
    j.add(ph);
    tp.add(j);
    thumb.push(j);
    tp = j;
  }
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const hand: Hand = {
    root,
    setCurl(c, t = c * 0.8) {
      // dobra para o lado da palma (−y): girar em +x leva o −z para −y
      for (const chain of joints)
        chain.forEach((j, i) => (j.rotation.x = -c * (i === 0 ? 1.35 : i === 1 ? 1.55 : 1.1)));
      thumbBase.rotation.x = -t * 0.5;
      thumb[0]!.rotation.y = t * 0.6 * mirror;
      thumb[1]!.rotation.x = -t * 0.9;
    },
    dispose() {
      for (const g of geos) g.dispose();
      mat.dispose();
    },
  };
  hand.setCurl(0.2);
  return hand;
}
