/**
 * Pegadas das mãos nas armas, no espaço da arma (frente em −z, cima em +y, origem no punho): onde fica o pulso, como a
 * mão gira e quanto os dedos fecham. A primeira pessoa (`viewmodel.ts`) e o boneco (`avatar.ts`) usam as mesmas, para
 * a mão segurar igual nas duas visões. Espaço da mão em `hand.ts` (dedos para −z, palma para −y, meia espessura da
 * palma 0,017 m).
 *
 * Como se segura (referência: tiro prático, sem copiar jogo nenhum):
 * - punho de pistola (fuzil, submetralhadora, sniper, pistola): a palma encosta no lado direito do punho, três dedos
 *   fechados na frente dele, o indicador separado na altura do gatilho (dobrado pela metade) e o polegar por cima,
 *   do lado esquerdo;
 * - mão de apoio no guarda-mão em "C": a palma por baixo, encostada, os dedos subindo pela direita até a metade da
 *   altura (não passam do topo, senão enchem a mira) e o polegar por cima, do lado esquerdo;
 * - pistola com as duas mãos: a esquerda por fora da direita, os dedos dela descendo por cima dos da direita e os dois
 *   polegares esticados para a frente, do lado esquerdo do quadro;
 * - baioneta em martelo (o cabo atravessa a mão fechada, a lâmina à frente do polegar); karambit em pegada reversa (o
 *   indicador passa pela argola, o cabo desce pela mão fechada e a lâmina curva sai abaixo do mindinho).
 */
import * as THREE from 'three';
import { FIST_CURL, FIST_HOLE } from '../hand';
import type { GunModel } from './models';
import type { GunClass } from './weapons';

export interface Grip {
  /** pulso (raiz da mão) no espaço da arma */
  pos: THREE.Vector3;
  /** giro da mão no espaço da arma */
  quat: THREE.Quaternion;
  /** dedos, polegar e indicador (0 aberto a 1 fechado) */
  curl: [number, number, number];
  /** o polegar aberto para o lado da palma (o sexto acerto de `FingerOffsets`; só a mão dos braços usa) */
  thumbUp?: number;
}

/**
 * O indicador no gatilho: a polpa da ponta na lâmina (medido em cada pegada: o centro da falange da ponta a ≤ 1 cm de
 * (0, gatilho.y − 0,017, gatilho.z), no meio do gatilho). No tiro, fecha mais `TRIGGER_SQUEEZE` (a ponta vem ~0,8 cm
 * para trás, com a lâmina); fora do gatilho, esticado sobre a armação, acima do guarda-mato.
 */
export const TRIGGER_CURL = 0.65;
const TRIGGER_CURL_PISTOL = 0.75;
const TRIGGER_CURL_KAR = 0.85;
export const TRIGGER_SQUEEZE = 0.1;
export const TRIGGER_OFF = 0.15;

/** giro a partir dos eixos da mão escritos no espaço da arma (x, y e z da mão) */
function basis(x: THREE.Vector3Tuple, y: THREE.Vector3Tuple, z: THREE.Vector3Tuple): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
const rotX = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const rotY = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
const rotZ = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);

// pegadas fixas (calculadas uma vez)
/** mão direita de lado no punho: dorso para a direita, dedos para a frente dando a volta, indicador em cima */
const PUNHO = basis([0, -1, 0], [1, 0, 0], [0, 0, 1]);
/** o punho de pistola é inclinado (~17°): a mão acompanha, o pulso mais para trás embaixo */
const PUNHO_INCL = rotX(-0.3).multiply(PUNHO);
/** o cabo cruza a palma na diagonal (~17°), a ponta do cabo indo para a base do mindinho, como numa mão de verdade */
const MARTELO_DIAG = 0.3;
/**
 * martelo (baioneta): o cabo atravessa a mão fechada de lado a lado (eixo x da mão ao longo do cabo, o indicador do
 * lado da lâmina), o dorso para a direita e os nós dos dedos para o lado do fio. Antes a base era espelhada
 * (determinante −1) e o giro que saía dela punha o cabo atravessando a palma de frente, como um prolongamento do braço.
 */
const MARTELO = basis([0, 0, 1], [1, 0, 0], [0, 1, 0]).multiply(rotY(MARTELO_DIAG));
/** apoio da pistola: palma para a direita (encostando nos dedos da direita), dedos descendo ~35° por cima deles */
const APOIO_PISTOLA = rotX(-0.6).multiply(basis([0, 1, 0], [-1, 0, 0], [0, 0, 1]));
const C_CLAMP = basis([0, 0, -1], [0, -1, 0], [-1, 0, 0]);
/**
 * esquerda na empunhadura vertical: palma para a arma (+x), dedos para a frente dando a volta nela, indicador em cima;
 * inclinada como o punho (a base dele vai um pouco para a frente)
 */
const VGRIP = rotX(0.14).multiply(basis([0, 1, 0], [-1, 0, 0], [0, 0, 1]));
/**
 * coronha reta (Kar98k, sem punho de pistola): a pegada de punho inclinada ~40° para os dedos seguirem a descida do
 * delgado (menos inclinada, as pontas passavam ~1 cm abaixo da madeira)
 */
const DELGADO = rotX(-0.7).multiply(PUNHO);
/** o punho fechado encostado na guarda (o indicador logo atrás dela): só a ponta do cabo sobra, do lado do mindinho */
const MARTELO_FWD = new THREE.Vector3(0, 0, -0.022);
/**
 * A mão que vai segurar: o vão da mão fechada (no espaço da mão) e o fechamento dele. O boneco usa a mão de cápsulas
 * (`hand.ts`, o padrão); a primeira pessoa, a mão dos braços com esqueleto (`handrig.ts`).
 */
export interface HandFit {
  hole: THREE.Vector3;
  curl: number;
  /** o centro do punho da arma (mais grosso que um cabo de faca): a palma na lateral, os nós dos dedos na frente dele */
  grip: THREE.Vector3;
  /** apoio em "C" no guarda-mão: quanto o pulso vai para a esquerda (dedos compridos passavam do topo) */
  clamp: number;
  /**
   * karambit: a altura da fileira do indicador acima do pulso (no punho de lado ela fica no centro da argola) e quanto
   * o vão da mão fica atrás do centro da argola (z), para o indicador passar nela
   */
  ring: { row: number; back: number };
  /**
   * karambit medida para esta mão (pulso e giro no espaço da faca, o fechamento do indicador); sem ela, a conta de
   * `ring` (mão de cápsulas do boneco)
   */
  karambit?: { pos: THREE.Vector3Tuple; quat: [number, number, number, number]; index: number; middle: number };
  /** bowie medida para esta mão (pulso e giro no espaço da faca; `curl`: indicador, médio, anelar, mindinho, polegar) */
  bowie?: { pos: THREE.Vector3Tuple; quat: [number, number, number, number]; curl: readonly number[] };
  /**
   * empunhadura vertical: quanto a mão inclina a mais (o pulso desce para trás, na linha do antebraço que vem de baixo;
   * reta, o pulso dobrava em ângulo)
   */
  vgripTilt: number;
  /** apoio em "C": quanto os dedos apontam para a frente (rad; 0 atravessando a arma) */
  clampYaw: number;
  /** apoio em "C": quanto a palma gira para a lateral esquerda do guarda-mão (rad; 0 de palma para cima) */
  clampRoll: number;
  /** apoio em "C": o fechamento do polegar e quanto ele abre para o lado da palma (sobe pela lateral esquerda) */
  clampThumb: number;
  clampThumbUp: number;
}
const CAPSULE_HAND: HandFit = {
  hole: FIST_HOLE,
  curl: FIST_CURL,
  grip: FIST_HOLE,
  clamp: 0,
  ring: { row: 0.027, back: 0.043 },
  vgripTilt: 0,
  clampYaw: 0.45,
  clampRoll: 0.15,
  clampThumb: 0.8,
  clampThumbUp: 0,
};
/** onde o vão da mão fechada fica em relação ao pulso num giro (espaço da arma) */
const holeIn = (h: HandFit, q: THREE.Quaternion) => h.hole.clone().applyQuaternion(q);
const gripIn = (h: HandFit, q: THREE.Quaternion) => h.grip.clone().applyQuaternion(q);
/** a palma encosta pela esquerda da empunhadura (o vão da mão é mais largo que ela) */
const VGRIP_SHIFT = new THREE.Vector3(-0.004, 0, 0);
/** o punho tem ~2,6 cm de largura e o vão da mão é mais largo: a mão encosta pela direita */
const GRIP_SHIFT = new THREE.Vector3(0.004, 0, 0);
/** o meio do punho, onde passa o vão da mão (o indicador fica na altura do gatilho, em (0, 0,03, −0,02)) */
const GRIP_AT = new THREE.Vector3(0, -0.024, 0.055);
const PISTOL_GRIP_AT = new THREE.Vector3(0, -0.014, 0.05);
/** o delgado da coronha da Kar98k, logo atrás do guarda-mato (mais para trás, o indicador não chegava ao gatilho) */
const DELGADO_AT = new THREE.Vector3(0, 0.01, 0.05);
/** karambit: o centro da argola (o indicador passa nele), como em `models.ts` */
const KARAMBIT_RING = new THREE.Vector3(0, 0.057, -0.021);
/** apoio com empunhadura angulada: quanto a mão vai para trás do apoio (a rampa começa 1,2 cm à frente dele) */
const AGRIP_BACK = 0.03;
/** meia espessura da palma (hand.ts): a palma encosta na arma a essa distância do centro dela */
const PALM_HALF = 0.017;

/**
 * Mão direita. Arma de fogo: no punho (ver o comentário do arquivo), o pulso na altura em que a fileira do indicador
 * fica no gatilho. Karambit: reversa, o vão da mão fechada no cabo, o indicador na argola. Baioneta: martelo, com o
 * centro do cabo (`handle`, medido no modelo) no vão dos dedos fechados. Kar98k: sem punho de pistola, a mão abraça o
 * delgado da coronha.
 */
export function rightGrip(g: Pick<GunModel, 'id' | 'handle'>, cls: GunClass, hf: HandFit = CAPSULE_HAND): Grip {
  const handle = g.handle ?? new THREE.Vector3();
  if (g.id === 'karambit' && hf.karambit) {
    const k = hf.karambit;
    return { pos: new THREE.Vector3(...k.pos), quat: new THREE.Quaternion(...k.quat), curl: [k.middle, 0.3, k.index] };
  }
  if (g.id === 'bowie' && hf.bowie) {
    const b = hf.bowie;
    const quat = new THREE.Quaternion(...b.quat).normalize();
    // os dedos de baixo partem de 0,5 (o acerto de cada um sobe até o medido): partindo do médio, mais fechado que o
    // indicador, o indicador virava dedo de gatilho
    return { pos: new THREE.Vector3(...b.pos), quat, curl: [0.5, b.curl[4] ?? 0.6, b.curl[0] ?? 1] };
  }
  if (g.id === 'karambit') {
    const pos = handle.clone().sub(holeIn(hf, PUNHO));
    pos.y = KARAMBIT_RING.y - hf.ring.row;
    pos.z = KARAMBIT_RING.z + hf.ring.back - holeIn(hf, PUNHO).z;
    return { pos, quat: PUNHO.clone(), curl: [1, 0.8, 1] };
  }
  if (cls === 'knife')
    return {
      pos: handle.clone().add(MARTELO_FWD).sub(holeIn(hf, MARTELO)),
      quat: MARTELO.clone(),
      curl: [hf.curl, 0.7, hf.curl],
    };
  // o vão da mão fechada no meio do punho (todo modelo tem o punho na origem), um pouco para a direita: a palma
  // encosta sem entrar
  if (g.id === 'kar98k')
    return {
      pos: DELGADO_AT.clone().sub(gripIn(hf, DELGADO)).add(GRIP_SHIFT),
      quat: DELGADO.clone(),
      curl: [1, 0.55, TRIGGER_CURL_KAR],
    };
  // pistola: a mão mais alta (a membrana do polegar embaixo do ferrolho) e o polegar esticado para a frente, por cima
  // do polegar da mão de apoio
  const pistol = cls === 'pistol';
  return {
    pos: (pistol ? PISTOL_GRIP_AT : GRIP_AT).clone().sub(gripIn(hf, PUNHO_INCL)).add(GRIP_SHIFT),
    quat: PUNHO_INCL.clone(),
    curl: [0.9, pistol ? 0.25 : 0.5, pistol ? TRIGGER_CURL_PISTOL : TRIGGER_CURL],
  };
}

/**
 * Mão esquerda. Pistola: por fora da direita, envolvendo, polegar esticado. Fuzil, submetralhadora e sniper: "C" no
 * guarda-mão — palma por baixo encostada no fundo (o `support` vem da geometria da arma), dedos subindo pela direita
 * (fecham mais no guarda-mão fino, para não sobrar dedo acima dele) e polegar por cima. O centro da palma fica a
 * 0,046 do pulso nesse giro.
 */
export function leftGrip(
  g: Pick<GunModel, 'support' | 'supportW' | 'foregrip'>,
  cls: GunClass,
  hf: HandFit = CAPSULE_HAND,
): Grip {
  if (cls === 'pistol')
    return { pos: new THREE.Vector3(-0.025, -0.04, 0.055), quat: APOIO_PISTOLA.clone(), curl: [0.78, 0.1, 0.78] };
  if (g.foregrip?.kind === 'vertical') {
    // empunhadura vertical: a esquerda fecha em volta dela como a direita no punho (o vão da mão no meio dela, a palma
    // pela esquerda, o indicador em cima, logo abaixo do guarda-mão)
    const q = rotX(hf.vgripTilt).multiply(VGRIP);
    return {
      pos: g.foregrip.at.clone().sub(gripIn(hf, q)).add(VGRIP_SHIFT),
      quat: q,
      curl: [0.92, 0.6, 0.92],
    };
  }
  const w = g.supportW ?? 0.03;
  const c = Math.max(0.8, Math.min(1, 0.9 + 5 * (0.03 - w)));
  // empunhadura angulada: a palma vai para trás até o lado do indicador encostar na rampa dela (no apoio de sempre,
  // a palma, larga ao longo do guarda-mão, ficava por dentro da rampa)
  const back = g.foregrip?.kind === 'angled' ? AGRIP_BACK : 0;
  const q = rotY(hf.clampYaw).multiply(rotZ(-hf.clampRoll)).multiply(C_CLAMP);
  // o centro da palma encostado no ponto de apoio (deslocado `clamp` para a esquerda), pelo lado da palma
  const palmC = new THREE.Vector3(0, 0, -0.046).applyQuaternion(q);
  const out = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(PALM_HALF + 0.002);
  return {
    pos: g.support
      .clone()
      .add(new THREE.Vector3(-hf.clamp, 0, back))
      .add(out)
      .sub(palmC),
    quat: q,
    curl: [c, hf.clampThumb, c],
    thumbUp: hf.clampThumbUp,
  };
}
