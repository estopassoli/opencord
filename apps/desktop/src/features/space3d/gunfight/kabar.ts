/**
 * Ka-Bar (faca de combate dos fuzileiros, cabo de arruelas de couro) na primeira pessoa: a pegada medida na mão dos
 * braços, a guarda e as animações em trilhas de chaves (as mesmas da karambit, `karambit.ts`; o `viewmodel.ts` aplica).
 *
 * Espaço da faca (o modelo de arquivo): a lâmina para −z, o dorso para +y e o fio para −y; a guarda fica em z ≈ −0,08 e
 * o cabo vai de −0,075 ao pomo (+0,045), com ~2,3 cm de largura e ~3,1 cm do dorso ao fio.
 */
import * as THREE from 'three';
import type { KarTracks } from './karambit';

/**
 * Pegada em martelo, medida nas juntas da mão (não chutada): o cabo cruza a palma na diagonal (~29°, do nó do indicador
 * para a base da mão), a palma encosta em cima e à direita do cabo (o dorso da mão para cima e para fora), médio, anelar
 * e mindinho fecham por baixo, do lado do fio, e as pontas voltam pela lateral esquerda; o indicador fica logo atrás da
 * guarda e o polegar fecha por cima dos dedos, do lado esquerdo. O encaixe (`contact.ts`) parte dos dedos abertos
 * (`start`) e fecha cada um até encostar no cabo (o polegar parte fechado e abre até soltar). Antes a mão usava o
 * martelo genérico da baioneta em volta de um "centro do cabo" tirado de um nó do modelo 4 cm atrás da guarda de
 * verdade: segurava pelo pomo, com os dedos pendurados abaixo do cabo e a palma a 1,4 cm dele.
 */
export const KABAR_GRIP = {
  pos: [-0.0081, 0.065, 0.0032] as THREE.Vector3Tuple,
  quat: [-0.238, -0.4513, -0.4013, 0.7607] as [number, number, number, number],
  /** dedos, polegar e indicador de onde o encaixe parte */
  start: [0.3, 0.9, 0.3] as [number, number, number],
};

/** um giro YXZ (como o do `holder`) a partir de para onde a lâmina aponta e para onde fica o dorso (espaço da câmera) */
function aim(blade: THREE.Vector3Tuple, spine: THREE.Vector3Tuple): THREE.Vector3Tuple {
  const z = new THREE.Vector3(...blade).normalize().negate();
  const y = new THREE.Vector3(...spine);
  y.addScaledVector(z, -y.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z), 'YXZ');
  return [e.x, e.y, e.z];
}

/**
 * Guarda (espaço da câmera): o punho embaixo à direita, a lâmina para a frente, para cima e para o meio da tela, com o
 * dorso virado ~40° para a direita: a face de cima pega a luz principal (a lâmina é metal sem reflexo de ambiente; de
 * dorso para cima, ela ficava preta) e os dedos fechados no cabo ficam à vista. O antebraço entra pelo canto de baixo
 * à direita, o pulso quase reto com o desvio natural da pegada em martelo. Conferida a 16:9, 1,6 e 1,85.
 */
export const KABAR_POSE = {
  pos: new THREE.Vector3(0.155, -0.14, -0.35),
  rot: aim([-0.5, 0.45, -0.75], [0.72, 0.69, -0.07]),
  /** antebraço (do cotovelo ao pulso) no espaço da mão: desvio para o lado do mindinho e o pulso um pouco estendido */
  fore: new THREE.Vector3(-0.5, 0.25, -0.83).normalize(),
};

/**
 * Correndo e na corrida tática (somados à guarda, pesados por quanto se está correndo): posição (m) e giro ZYX do braço
 * em volta da faca (rad), no espaço da câmera. Correndo, a faca desce e aponta para a frente e para a esquerda, relaxada;
 * na tática, o braço sobe dobrado para perto do peito, a lâmina em pé. (Antes valia a pose das armas de fogo: correndo, a
 * faca deitava atravessada no pé da tela; na tática, ficava em pé com a mão no pomo.)
 */
export const KABAR_RUN = {
  sprintPos: [0, -0.03, 0.02] as THREE.Vector3Tuple,
  sprint: [-0.213, -0.015, 0.344] as THREE.Vector3Tuple,
  tacPos: [-0.03, 0, 0.05] as THREE.Vector3Tuple,
  tac: [0.634, -0.135, -0.118] as THREE.Vector3Tuple,
};

/**
 * Giro do braço inteiro (em volta da faca, no espaço da câmera) em chaves de orientação: [fração, ex, ey, ez, curva], o
 * mesmo giro ZYX das trilhas `ex`/`ey`/`ez` da karambit, mas interpolado como giro (slerp) e não ângulo a ângulo. Virar
 * a faca para mostrar a outra face é meia volta: ângulo a ângulo, o caminho passava pela trava do Euler e a lâmina dava
 * um giro torto no meio.
 */
export type TurnKey = readonly [number, number, number, number, (0 | 1 | 2)?];

const ease = (u: number) => u * u * (3 - 2 * u);
const QA = new THREE.Quaternion();
const QB = new THREE.Quaternion();
const EA = new THREE.Euler(0, 0, 0, 'ZYX');

/** o giro das chaves no momento `u`, somado em `out` (`ex`, `ey`, `ez`, como o `viewmodel.ts` aplica) */
export function turnInto(u: number, k: readonly TurnKey[], out: { ex: number; ey: number; ez: number }) {
  if (k.length === 0) return;
  let a = k[0]!;
  let b = a;
  let t = 0;
  if (u > a[0]) {
    b = k[k.length - 1]!;
    a = b;
    for (let i = 0; i + 1 < k.length; i++) {
      if (u > k[i + 1]![0]) continue;
      a = k[i]!;
      b = k[i + 1]!;
      const x = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
      const c = a[4] ?? 0;
      t = c === 1 ? 1 - (1 - x) ** 3 : c === 2 ? x * x * x : ease(x);
      break;
    }
  }
  QA.setFromEuler(EA.set(a[1], a[2], a[3], 'ZYX'));
  if (t > 0) QA.slerp(QB.setFromEuler(EA.set(b[1], b[2], b[3], 'ZYX')), t);
  EA.setFromQuaternion(QA, 'ZYX');
  out.ex += EA.x;
  out.ey += EA.y;
  out.ez += EA.z;
}

/**
 * Saque (1000 ms; o jogo libera o golpe antes): a mão sobe da bainha do cinto, embaixo à direita, ainda com a lâmina
 * para baixo, e o pulso vira a ponta para cima e para a frente num arco (passa um pouco do ponto, tranco ao chegar); a
 * esquerda sobe para a guarda logo atrás.
 */
// prettier-ignore
export const KB_DRAW: KarTracks = {
  px: [[0, 0.06], [0.15, 0.03, 1], [0.38, -0.005], [0.6, 0]],
  py: [[0, -0.22], [0.15, -0.1, 1], [0.38, 0.02], [0.52, -0.01], [0.66, 0]],
  pz: [[0, 0.02], [0.15, 0.0], [0.38, -0.01], [0.66, 0]],
  ly: [[0, -0.22], [0.2, -0.22], [0.65, 0]],
  lz: [[0, 0.06], [0.2, 0.06], [0.65, 0]],
};
// prettier-ignore
export const KB_DRAW_T: readonly TurnKey[] = [
  [0, -2.1, 0.1, -0.4], [0.15, -1.9, 0.15, -0.35], [0.38, 0.15, 0, 0.05], [0.52, -0.04, 0, 0], [0.66, 0, 0, 0],
];

/**
 * Inspeção (3400 ms): um pequeno recuo, o braço traz a faca para perto e para o meio de dorso da mão para cima, a lâmina
 * atravessada para a esquerda mostrando a face com a marca (pausa); o antebraço rola e mostra a outra face, a mão por
 * baixo (pausa); volta para a guarda passando um pouco do ponto. A esquerda baixa, fora do caminho.
 */
// prettier-ignore
export const KB_INSPECT: KarTracks = {
  px: [[0, 0], [0.05, 0.005], [0.2, -0.04], [0.4, -0.045], [0.55, -0.055], [0.75, -0.055], [0.9, 0.004], [1, 0]],
  py: [[0, 0], [0.05, -0.012, 2], [0.2, 0.05, 1], [0.4, 0.055], [0.55, 0.015], [0.75, 0.02], [0.9, -0.01], [1, 0]],
  pz: [[0, 0], [0.2, 0.04, 1], [0.4, 0.04], [0.55, 0.04], [0.75, 0.04], [0.9, 0], [1, 0]],
  lx: [[0, 0], [0.15, -0.02], [0.8, -0.02], [1, 0]],
  ly: [[0, 0], [0.15, -0.05], [0.8, -0.05], [1, 0]],
};
// prettier-ignore
export const KB_INSPECT_T: readonly TurnKey[] = [
  [0, 0, 0, 0], [0.05, 0.04, 0.03, -0.04, 2], [0.2, -2.828, -1.24, -0.9, 1], [0.4, -2.75, -1.2, -0.95],
  [0.55, -0.237, 0.732, 0.125, 1], [0.75, -0.2, 0.7, 0.16], [0.9, 0.05, -0.06, -0.05], [1, 0, 0, 0],
];

/**
 * Golpe leve de direita (480 ms; o acerto sai em 30%): o punho sobe e recua para a direita com a lâmina em pé, a face
 * para a câmera (antecipação); corta na diagonal para baixo e para a esquerda com o fio na frente, cruzando o meio da
 * tela no acerto, segue até embaixo à esquerda e volta. A esquerda desce, fora do caminho do braço.
 */
// prettier-ignore
export const KB_SLASH_R: KarTracks = {
  px: [[0, 0], [0.16, 0.06], [0.18, 0.06, 1], [0.5, -0.2], [0.88, 0]],
  py: [[0, 0], [0.16, 0.08], [0.18, 0.08, 1], [0.5, -0.02], [0.88, 0]],
  pz: [[0, 0], [0.16, 0.03], [0.18, 0.03, 1], [0.5, -0.04], [0.88, 0]],
  lx: [[0, 0], [0.2, -0.05], [0.6, -0.05], [1, 0]],
  ly: [[0, 0], [0.2, -0.12], [0.6, -0.12], [1, 0]],
  lz: [[0, 0], [0.2, 0.05], [0.6, 0.05], [1, 0]],
};
// prettier-ignore
export const KB_SLASH_R_T: readonly TurnKey[] = [
  [0, 0, 0, 0], [0.16, 0.482, -0.093, -0.96], [0.18, 0.482, -0.093, -0.96, 1], [0.5, 0.426, -0.019, 1.593],
  [0.88, 0, 0, 0],
];

/**
 * Golpe leve de revés (o outro lado, alternando): o braço cruza o corpo e arma o pulso à esquerda, a lâmina apontando
 * para trás à esquerda (a esquerda desce e sai do caminho); varre para a direita com o fio na frente, cruzando o meio
 * da tela no acerto, segue à direita e volta.
 */
// prettier-ignore
export const KB_SLASH_L: KarTracks = {
  px: [[0, 0], [0.16, -0.2], [0.18, -0.2, 1], [0.5, 0.06], [0.88, 0]],
  py: [[0, 0], [0.16, 0.04], [0.18, 0.04, 1], [0.5, 0.0], [0.88, 0]],
  pz: [[0, 0], [0.16, 0.0], [0.18, 0.0, 1], [0.5, -0.04], [0.88, 0]],
  lx: [[0, 0], [0.12, -0.03], [0.5, -0.03], [0.85, 0]],
  ly: [[0, 0], [0.12, -0.14], [0.5, -0.14], [0.85, 0]],
  lz: [[0, 0], [0.12, 0.04], [0.5, 0.04], [0.85, 0]],
};
// prettier-ignore
export const KB_SLASH_L_T: readonly TurnKey[] = [
  [0, 0, 0, 0], [0.16, 1.686, -0.044, 0.435], [0.18, 1.686, -0.044, 0.435, 1], [0.5, -0.151, -0.712, 1.408],
  [0.88, 0, 0, 0],
];

/**
 * Golpe pesado (720 ms; o acerto sai em 45%): antecipação longa — o punho recua e sobe com a ponta para o alto —,
 * estocada para a frente e para o meio da tela, tranco forte, segura um instante e volta devagar. A esquerda desce.
 * No acerto a mão vai para baixo do meio da tela e longe da câmera, com a lâmina subindo dela até a mira (a ponta a
 * ~10 px do centro, ~45° da linha de visada: inteira à vista, indo na frente); antes a faca parava no meio-direita quase
 * no ângulo da guarda, com o antebraço tomando a diagonal, e lia como um soco. A pausa no fim da estocada caiu de
 * ~95 ms para ~50 ms.
 */
// prettier-ignore
export const KB_HEAVY: KarTracks = {
  px: [[0, 0], [0.3, 0.02], [0.33, 0.02, 1], [0.45, -0.08, 1], [0.52, -0.072], [0.62, -0.05], [1, 0]],
  py: [[0, 0], [0.3, 0.04], [0.33, 0.04, 1], [0.45, -0.03, 1], [0.52, -0.027], [0.62, -0.019], [1, 0]],
  pz: [[0, 0], [0.3, 0.06], [0.33, 0.06, 1], [0.45, -0.2, 1], [0.52, -0.176], [0.62, -0.12], [1, 0]],
  lx: [[0, 0], [0.35, -0.04], [0.7, -0.05], [1, 0]],
  ly: [[0, 0], [0.35, -0.08], [0.7, -0.08], [1, 0]],
  lz: [[0, 0], [0.5, 0.06], [1, 0]],
};
// prettier-ignore
export const KB_HEAVY_T: readonly TurnKey[] = [
  [0, 0, 0, 0], [0.3, 0.626, -0.232, -0.13], [0.33, 0.626, -0.232, -0.13, 1], [0.45, 0.3, -0.35, 0.1, 1],
  [0.52, 0.255, -0.2975, 0.085], [0.62, 0.18, -0.21, 0.06], [1, 0, 0, 0],
];
