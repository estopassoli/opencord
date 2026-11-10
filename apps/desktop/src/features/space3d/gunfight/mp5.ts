/**
 * Animações próprias da MP5 na primeira pessoa (dados e contas puras; o `viewmodel.ts` aplica). A MP5 tem a coronha
 * retrátil comprida: nos gestos comuns das armas longas (inspeção virando o cano para a direita, golpe empurrando a
 * arma para a frente e para o meio), a soleira entrava na tela perto da câmera e tapava a mão direita. Aqui o cano
 * vira para a esquerda e a arma rola no próprio eixo, com a coronha ficando fora da tela, à direita.
 *
 * - Inspeção (`MP5_INSPECT`): antecipa, vira o cano para a esquerda mostrando o lado direito inteiro (janela de ejeção,
 *   seletor, punho e pente; pausa), rola para o outro lado mostrando o lado esquerdo enquanto a mão de apoio vai ao
 *   pente e confere (pausa), solta e volta passando um pouco do ponto.
 * - Golpe (`MP5_BASH`): recua e arma, estoca para a frente com o cano para a esquerda e a arma inclinada, tranco no
 *   acerto (160 ms de 500, como o `game.ts`), segue e volta.
 * - Recarga vazia (`hkGesture`), o "tapa HK" da MP5 de verdade (não tem retém do ferrolho): a esquerda vai à alavanca
 *   da frente (à esquerda do tubo, em cima do guarda-mão), puxa para trás e trava no entalhe; o pente vazio cai, o novo
 *   entra; a esquerda sobe aberta e dá o tapa para baixo na alavanca, que solta e o ferrolho fecha (som `charge`).
 *
 * Trilhas no formato da karambit (`Key`: [fração, valor, curva]), somadas à pose de quadril: posição do `holder` no
 * espaço da câmera (`px`, `py`, `pz`, m), giro YXZ (`rx`, `ry`, `rz`, rad) e a esquerda no pente (`mag`, 0–1).
 */
import * as THREE from 'three';
import { track, type Key } from './karambit';

export type Mp5Track = 'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz' | 'mag';
export type Mp5Tracks = Partial<Record<Mp5Track, readonly Key[]>>;

/** inspeção (2400 ms no jogo) */
export const MP5_INSPECT: Mp5Tracks = {
  px: [
    [0, 0],
    [0.06, 0.005],
    [0.2, -0.03],
    [0.42, -0.03],
    [0.56, -0.02],
    [0.78, -0.02],
    [0.92, 0],
  ],
  py: [
    [0, 0],
    [0.06, -0.012, 2],
    [0.2, 0.05],
    [0.42, 0.055],
    [0.56, 0.06],
    [0.78, 0.06],
    [0.9, -0.006],
    [1, 0],
  ],
  pz: [
    [0, 0],
    [0.2, 0.02],
    [0.42, 0.02],
    [0.56, 0.01],
    [0.78, 0.01],
    [0.92, 0],
  ],
  rx: [
    [0, 0],
    [0.06, -0.05, 2],
    [0.2, 0.18],
    [0.42, 0.2],
    [0.56, 0.12],
    [0.78, 0.12],
    [0.9, -0.03],
    [1, 0],
  ],
  ry: [
    [0, 0],
    [0.06, -0.03],
    [0.2, 0.75],
    [0.42, 0.8],
    [0.56, -0.12],
    [0.78, -0.14],
    [0.92, 0],
  ],
  rz: [
    [0, 0],
    [0.06, -0.04, 2],
    [0.2, 0.3],
    [0.42, 0.33],
    [0.56, -0.75],
    [0.78, -0.8],
    [0.9, 0.04],
    [1, 0],
  ],
  mag: [
    [0, 0],
    [0.5, 0],
    [0.58, 1],
    [0.74, 1],
    [0.82, 0],
  ],
};

/** golpe com a arma (500 ms; o acerto em 160 ms) */
export const MP5_BASH: Mp5Tracks = {
  px: [
    [0, 0],
    [0.14, 0.02],
    [0.32, -0.02, 1],
    [0.46, -0.02],
    [0.85, 0],
  ],
  py: [
    [0, 0],
    [0.14, 0.015],
    [0.32, -0.01, 1],
    [0.85, 0],
  ],
  pz: [
    [0, 0],
    [0.14, 0.035, 2],
    [0.32, -0.1, 1],
    [0.46, -0.11],
    [0.85, 0],
  ],
  rx: [
    [0, 0],
    [0.14, 0.1, 2],
    [0.32, 0.04, 1],
    [0.85, 0],
  ],
  ry: [
    [0, 0],
    [0.14, -0.1, 2],
    [0.32, 0.38, 1],
    [0.46, 0.4],
    [0.85, 0],
  ],
  rz: [
    [0, 0],
    [0.14, 0.12, 2],
    [0.32, -0.3, 1],
    [0.46, -0.32],
    [0.85, 0],
  ],
};
export const MP5_BASH_HIT = 0.32;

/**
 * Uma animação da MP5 no momento `u`: soma as trilhas na pose (`pos`, `rot`); os giros de rolagem ficam menores com
 * "reduzir movimento" (`mo`). Devolve quanto a esquerda está no pente (0–1).
 */
export function mp5Play(t: Mp5Tracks, u: number, mo: number, pos: THREE.Vector3, rot: THREE.Euler): number {
  pos.x += track(u, t.px);
  pos.y += track(u, t.py);
  pos.z += track(u, t.pz);
  rot.x += track(u, t.rx);
  rot.y += track(u, t.ry);
  rot.z += track(u, t.rz) * mo;
  return track(u, t.mag);
}

/** o gesto da recarga vazia neste quadro (o `EG` do viewmodel tem estes campos) */
export interface HkPose {
  bolt: number;
  charge: number;
  /** giro da alavanca no tubo (rad): sobe para o entalhe */
  chargeRot: number;
  alt: number;
  altQ: THREE.Quaternion;
  out: number;
  curl: number;
  thumb: number;
  at: THREE.Vector3;
  /** o arco da mão indo e voltando da peça (espaço da arma) */
  arc: THREE.Vector3;
  /**
   * a arma vem ao encontro da mão (0–1): desfaz a inclinação da recarga, inclina um pouco para a esquerda e chega mais
   * perto; inclinada, a alavanca subia para o alto da tela e o braço esticado atravessava a vista
   */
  present: number;
}

/**
 * a arma vindo ao encontro da mão (sem a inclinação da recarga): rolagem para a esquerda (rad) e deslocamento no espaço
 * da câmera (m)
 */
export const HK_PRESENT_ROLL = 0.15;
export const HK_PRESENT_POS = new THREE.Vector3(-0.01, 0, 0.03);
/**
 * a bola da alavanca em relação ao meio da peça (`chargeHome`, que inclui o tubo): 3 cm à esquerda do tubo e 2 cm à
 * frente do meio (medido nos vértices do osso `charginghandle` do modelo)
 */
const HK_KNOB = new THREE.Vector3(-0.017, 0.001, -0.022);
/** quanto a alavanca anda para trás até o entalhe (m) e quanto ela gira para subir nele (rad) */
export const HK_TRAVEL = 0.06;
export const HK_NOTCH = 0.35;
/** a alavanca solta no tapa (fração da recarga vazia; o som `charge` do `game.ts` toca em 0,8) */
export const HK_RELEASE = 0.8;
/** a mão aberta sobe esta altura acima da alavanca antes do tapa (m) */
const HK_LIFT = 0.035;
/** meia espessura da palma */
const PALM_HALF = 0.017;
/** indo para a alavanca: por fora e um pouco por cima (em linha reta, a mão passava pelo guarda-mão) */
const HK_ARC = new THREE.Vector3(-0.04, 0.025, 0);
/**
 * O tapa: a esquerda por cima da alavanca, palma para baixo, dedos para a frente e um pouco para dentro, o polegar do
 * lado da arma
 */
const HK_FINGERS = new THREE.Vector3(0.1, -0.15, -1).normalize();
const HK_SLAP_Q = (() => {
  const fingers = HK_FINGERS;
  const back = new THREE.Vector3(-0.35, 1, 0);
  back.addScaledVector(fingers, -back.dot(fingers)).normalize();
  const z = fingers.clone().negate();
  const x = new THREE.Vector3().crossVectors(back, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, back, z));
})();

const ease = (u: number) => u * u * (3 - 2 * u);
const seg = (u: number, a: number, b: number) => Math.max(0, Math.min(1, (u - a) / (b - a)));
const hump = (u: number, a: number, b: number, c: number, d: number) => ease(seg(u, a, b)) * (1 - ease(seg(u, c, d)));
const expOut = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));

/**
 * O "tapa HK" no momento `u` da recarga vazia: preenche `e` a partir da alavanca parada (`ch`, espaço da arma) e do giro
 * da mão pela lateral (`side`, o mesmo da pegada que puxa). Sem alocar.
 */
export function hkGesture(
  u: number,
  ch: THREE.Vector3,
  side: THREE.Quaternion,
  e: HkPose,
  joltAt: (key: string, at: number, v: number) => void,
) {
  // a alavanca: puxa (0,09–0,14), sobe para o entalhe (0,14–0,165) e fica; no tapa desce do entalhe e volta com a mola
  const pull = ease(seg(u, 0.09, 0.14));
  const notch = ease(seg(u, 0.14, 0.165)) * (1 - ease(seg(u, HK_RELEASE - 0.012, HK_RELEASE - 0.002)));
  const home = expOut(seg(u, HK_RELEASE, HK_RELEASE + 0.025));
  e.charge = HK_TRAVEL * pull * (1 - home);
  e.chargeRot = HK_NOTCH * notch;
  e.bolt = e.charge;
  joltAt('hkLock', 0.15, -0.8);
  joltAt('release', HK_RELEASE, 2.4);
  e.arc.copy(HK_ARC);
  if (u < 0.5) {
    // puxando: pela lateral esquerda, a mão fechada em volta da bola (os dedos passam na frente dela), anda com ela
    e.alt = ease(seg(u, 0.02, 0.08)) * (1 - ease(seg(u, 0.17, 0.27)));
    e.altQ = side;
    e.curl = 0.8;
    e.thumb = 0.7;
    e.out = 0;
    e.present = hump(u, 0, 0.06, 0.18, 0.28);
    // o meio da palma ~2,5 cm atrás da bola e por fora da ponta dela (conferido de lado, de cima e por trás)
    e.at
      .copy(ch)
      .add(HK_KNOB)
      .add(W.set(-0.006 - PALM_HALF, -0.008, 0.046 + 0.025 + e.charge));
    return;
  }
  // o tapa: sobe aberta por cima da alavanca travada (0,68–0,76), desce rápido (0,76–0,795), empurra a alavanca para
  // baixo e segue para baixo e para a frente com ela, e volta ao guarda-mão (0,83–0,94)
  e.alt = ease(seg(u, 0.68, 0.76)) * (1 - ease(seg(u, 0.83, 0.94)));
  e.altQ = HK_SLAP_Q;
  e.curl = 0.2;
  e.thumb = 0.25;
  e.out = 0;
  e.present = hump(u, 0.64, 0.72, 0.84, 0.94);
  const strike = Math.pow(seg(u, 0.76, HK_RELEASE - 0.005), 2);
  const follow = ease(seg(u, HK_RELEASE - 0.005, 0.84));
  const lift = HK_LIFT * (1 - strike) - 0.012 * follow;
  // o meio da palma (0,046 do pulso, na direção dos dedos) em cima da alavanca: anda com ela para a frente quando solta
  e.at
    .copy(ch)
    .add(HK_KNOB)
    .add(W.set(-0.016, 0.005 + PALM_HALF + lift, HK_TRAVEL * (1 - home) - 0.02 * follow))
    .addScaledVector(HK_FINGERS, -0.046);
}
const W = new THREE.Vector3();
