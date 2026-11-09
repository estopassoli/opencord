/**
 * Pegadas das mãos nas armas, no espaço da arma (frente em −z, cima em +y, origem no punho): onde fica o pulso, como a
 * mão gira e quanto os dedos fecham. A primeira pessoa (`viewmodel.ts`) e o boneco (`avatar.ts`) usam as mesmas, para
 * a mão segurar igual nas duas visões. Espaço da mão em `hand.ts` (dedos para −z, palma para −y).
 */
import * as THREE from 'three';
import { FIST_CURL, FIST_HOLE } from '../hand';
import type { GunClass } from './weapons';

export interface Grip {
  /** pulso (raiz da mão) no espaço da arma */
  pos: THREE.Vector3;
  /** giro da mão no espaço da arma */
  quat: THREE.Quaternion;
  /** dedos e polegar (0 aberto a 1 fechado) */
  curl: [number, number];
}

/** giro a partir dos eixos da mão escritos no espaço da arma (x, y e z da mão) */
function basis(x: THREE.Vector3Tuple, y: THREE.Vector3Tuple, z: THREE.Vector3Tuple): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// pegadas fixas (calculadas uma vez)
const PUNHO = basis([0, -1, 0], [1, 0, 0], [0, 0, 1]);
const MARTELO = basis([0, 0, 1], [1, 0, 0], [0, -1, 0]);
const APOIO_PISTOLA = basis([0, 1, 0], [-1, 0, 0], [0, 0, 1]);
const C_CLAMP = basis([0, 0, -1], [0, -1, 0], [-1, 0, 0]);
/** coronha reta (Kar98k, sem punho de pistola): a pegada de punho inclinada ~25° para os dedos abraçarem o delgado */
const DELGADO = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.44).multiply(PUNHO);
/** onde o vão da mão fechada fica em relação ao pulso, já no giro de martelo (espaço da arma) */
const MARTELO_HOLE = FIST_HOLE.clone().applyQuaternion(MARTELO);

/**
 * Mão direita: no punho (dorso para a direita, dedos dando a volta, polegar por cima). Karambit: cabo em pé dentro da
 * mão fechada, o indicador passando pela argola. Baioneta: martelo, com o centro do cabo (`handle`, medido no modelo)
 * no vão dos dedos fechados. Kar98k: sem punho de pistola, a mão sobe para o delgado da coronha e inclina.
 */
export function rightGrip(cls: GunClass, id: string, handle?: THREE.Vector3): Grip {
  if (id === 'karambit') return { pos: new THREE.Vector3(0.016, 0.029, 0.045), quat: PUNHO.clone(), curl: [0.92, 0.6] };
  if (cls === 'knife') {
    const pos = (handle ?? new THREE.Vector3()).clone().sub(MARTELO_HOLE);
    return { pos, quat: MARTELO.clone(), curl: [FIST_CURL, 0.7] };
  }
  if (id === 'kar98k') return { pos: new THREE.Vector3(0.015, -0.01, 0.06), quat: DELGADO.clone(), curl: [0.85, 0.5] };
  return { pos: new THREE.Vector3(0.018, -0.035, 0.075), quat: PUNHO.clone(), curl: [0.88, 0.5] };
}

/**
 * Mão esquerda. Pistola: por fora da direita, envolvendo. Fuzil, submetralhadora e sniper: "C" no guarda-mão — palma
 * para cima encostada no fundo (o `support` vem da geometria da arma), dedos subindo pela direita, polegar por cima.
 * O centro da palma fica a (0,046, 0,017) do pulso nesse giro; mais a meia espessura da palma.
 */
export function leftGrip(cls: GunClass, support: THREE.Vector3): Grip {
  if (cls === 'pistol')
    return { pos: new THREE.Vector3(-0.03, -0.05, 0.07), quat: APOIO_PISTOLA.clone(), curl: [0.75, 0.4] };
  return {
    pos: support.clone().add(new THREE.Vector3(-0.046, -0.032, 0)),
    quat: C_CLAMP.clone(),
    curl: [0.72, 0.8],
  };
}
