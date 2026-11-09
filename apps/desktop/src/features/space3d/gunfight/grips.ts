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
/** onde o vão da mão fechada fica em relação ao pulso, já no giro de martelo e no de punho (espaço da arma) */
const MARTELO_HOLE = FIST_HOLE.clone().applyQuaternion(MARTELO);
const PUNHO_HOLE = FIST_HOLE.clone().applyQuaternion(PUNHO);
const PUNHO_INCL_HOLE = FIST_HOLE.clone().applyQuaternion(PUNHO_INCL);
const DELGADO_HOLE = FIST_HOLE.clone().applyQuaternion(DELGADO);
const VGRIP_HOLE = FIST_HOLE.clone().applyQuaternion(VGRIP);
/** a palma encosta pela esquerda da empunhadura (o vão da mão é mais largo que ela) */
const VGRIP_SHIFT = new THREE.Vector3(-0.004, 0, 0);
/** o punho tem ~2,6 cm de largura e o vão da mão é mais largo: a mão encosta pela direita */
const GRIP_SHIFT = new THREE.Vector3(0.004, 0, 0);
/** o meio do punho, onde passa o vão da mão (o indicador fica na altura do gatilho, em (0, 0,03, −0,02)) */
const GRIP_AT = new THREE.Vector3(0, -0.024, 0.055);
const PISTOL_GRIP_AT = new THREE.Vector3(0, -0.014, 0.05);
/** o delgado da coronha da Kar98k, logo atrás do guarda-mato (mais para trás, o indicador não chegava ao gatilho) */
const DELGADO_AT = new THREE.Vector3(0, 0.01, 0.05);
/** karambit: o indicador (a fileira de cima da mão, +0,027 do pulso) passa no centro da argola */
const KARAMBIT_RING_Y = 0.056;
/**
 * A argola fica em cima do meio do cabo, e o indicador cruza a argola ~4 cm atrás de onde os outros dedos cruzam a
 * frente do cabo: a mão vai para trás até o indicador passar no centro da argola (medido: a linha do indicador em
 * x = 0 a ~0,3 cm do centro dela), e o cabo fica no fundo do punho fechado.
 */
const KARAMBIT_BACK = 0.05;
const INDEX_ROW = 0.027;
/** meia espessura da palma (hand.ts): a palma encosta na arma a essa distância do centro dela */
const PALM_HALF = 0.017;

/**
 * Mão direita. Arma de fogo: no punho (ver o comentário do arquivo), o pulso na altura em que a fileira do indicador
 * fica no gatilho. Karambit: reversa, o vão da mão fechada no cabo, o indicador na argola. Baioneta: martelo, com o
 * centro do cabo (`handle`, medido no modelo) no vão dos dedos fechados. Kar98k: sem punho de pistola, a mão abraça o
 * delgado da coronha.
 */
export function rightGrip(g: Pick<GunModel, 'id' | 'handle'>, cls: GunClass): Grip {
  const handle = g.handle ?? new THREE.Vector3();
  if (g.id === 'karambit') {
    const pos = handle.clone().sub(PUNHO_HOLE);
    pos.y = KARAMBIT_RING_Y - INDEX_ROW;
    pos.z += KARAMBIT_BACK;
    return { pos, quat: PUNHO.clone(), curl: [1, 0.8, 1] };
  }
  if (cls === 'knife')
    return {
      pos: handle.clone().add(MARTELO_FWD).sub(MARTELO_HOLE),
      quat: MARTELO.clone(),
      curl: [FIST_CURL, 0.7, FIST_CURL],
    };
  // o vão da mão fechada no meio do punho (todo modelo tem o punho na origem), um pouco para a direita: a palma
  // encosta sem entrar
  if (g.id === 'kar98k')
    return {
      pos: DELGADO_AT.clone().sub(DELGADO_HOLE).add(GRIP_SHIFT),
      quat: DELGADO.clone(),
      curl: [1, 0.55, TRIGGER_CURL_KAR],
    };
  // pistola: a mão mais alta (a membrana do polegar embaixo do ferrolho) e o polegar esticado para a frente, por cima
  // do polegar da mão de apoio
  const pistol = cls === 'pistol';
  return {
    pos: (pistol ? PISTOL_GRIP_AT : GRIP_AT).clone().sub(PUNHO_INCL_HOLE).add(GRIP_SHIFT),
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
export function leftGrip(g: Pick<GunModel, 'support' | 'supportW' | 'foregrip'>, cls: GunClass): Grip {
  if (cls === 'pistol')
    return { pos: new THREE.Vector3(-0.025, -0.04, 0.055), quat: APOIO_PISTOLA.clone(), curl: [0.78, 0.1, 0.78] };
  if (g.foregrip?.kind === 'vertical') {
    // empunhadura vertical: a esquerda fecha em volta dela como a direita no punho (o vão da mão no meio dela, a palma
    // pela esquerda, o indicador em cima, logo abaixo do guarda-mão)
    return {
      pos: g.foregrip.at.clone().sub(VGRIP_HOLE).add(VGRIP_SHIFT),
      quat: VGRIP.clone(),
      curl: [0.92, 0.6, 0.92],
    };
  }
  const w = g.supportW ?? 0.03;
  const c = Math.max(0.8, Math.min(1, 0.9 + 5 * (0.03 - w)));
  return {
    pos: g.support.clone().add(new THREE.Vector3(-0.046, -PALM_HALF - 0.002, 0)),
    quat: C_CLAMP.clone(),
    curl: [c, 0.8, c],
  };
}
