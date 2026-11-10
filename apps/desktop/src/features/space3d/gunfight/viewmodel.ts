/**
 * Primeira pessoa do gunfight: braços e arma desenhados por cima da cena (cena e câmera próprias, profundidade
 * limpa antes), para a arma nunca entrar na parede. Toda animação é feita aqui, em código, por cima das peças do
 * modelo: sacar, guardar, respirar, balançar com o mouse, passo, corrida (e a corrida tática, arma para cima), mirar,
 * coice do tiro com o ferrolho indo e voltando (o estojo sai pela janela), recarga (`reload.ts`: com bala, o pente velho
 * vai para o colete e a mão volta com um cheio; vazia, o velho cai e o novo encaixa; depois o gesto da arma),
 * ferrolho do sniper (a mão direita anda junto com a alavanca), golpes da faca (alternando os lados) e a inspeção. As
 * mãos seguram nas pegadas medidas na malha de cada arma (`holds.ts`: palma encostada, cada dedo fechado até tocar).
 * Braços, mãos e dedos são o modelo com esqueleto de `arms.ts` (ADR-0060): a mão vai para a pegada, os dedos usam as
 * poses de `handrig.ts` e o braço é resolvido do pulso até o ombro (fixo na câmera), pelo cotovelo pedido; com faca, o
 * antebraço segue a mão (o pulso fica quase reto em qualquer giro). As facas giram na mão em volta de um pivô (a
 * karambit na argola, pelo indicador; a baioneta no meio do cabo), nunca a lâmina sozinha.
 *
 * "Reduzir movimento": passo, balanço, inclinações e o giro do saque ficam em ~30%; a faca não gira na mão.
 */
import * as THREE from 'three';
import { FpsArms, type ArmHand } from './arms';
import {
  KAR_DRAW,
  KAR_HEAVY,
  KAR_INSPECT,
  KAR_SLASH_L,
  KAR_SLASH_R,
  KAR_SLIDE,
  KAR_SPIN_CURL,
  track,
  type KarTracks,
} from './karambit';
import {
  KUK_CHOP_L,
  KUK_CHOP_R,
  KUK_DRAW,
  KUK_HEAVY,
  KUK_GUARD_CURL,
  KUK_INSPECT,
  KUKRI_POSE,
  kukriPlay,
  kukriRun,
} from './kukri';
import {
  BAY_DRAW,
  BAY_GUARD,
  BAY_HEAVY,
  BAY_INSPECT,
  BAY_OPEN,
  BAY_POSE,
  BAY_RUN,
  BAY_SLASH_L,
  BAY_SLASH_R,
  BAY_TOSS,
} from './bayonet';
import {
  BAL_DRAW,
  BAL_FIT_START,
  BAL_FLIP_CURL,
  BAL_GUARD,
  BAL_HEAVY,
  BAL_INSPECT,
  BAL_LIFT,
  BAL_SLASH_L,
  BAL_SLASH_R,
  balShift,
  balSpread,
  type BalTracks,
} from './balisong';
import {
  KABAR_GRIP,
  KABAR_GUARD_L,
  KABAR_POSE,
  KABAR_RUN,
  KB_DRAW,
  KB_DRAW_T,
  KB_HEAVY,
  KB_HEAVY_T,
  KB_INSPECT,
  KB_INSPECT_T,
  KB_SLASH_L,
  KB_SLASH_L_T,
  KB_SLASH_R,
  KB_SLASH_R_T,
  turnInto,
} from './kabar';
import { ARM_RIG } from './armsrig';
import { BOWIE_DRAW, BOWIE_HEAVY, BOWIE_INSPECT, BOWIE_SLASH_L, BOWIE_SLASH_R } from './bowie';
import { PORT, ejectKind, ejectVelocity, type EjectKind } from './casings';
import { fitHand, soupOf } from './contact';
import { flashTexture } from './fx';
import { ARM_HAND_FIT, BOWIE_ARM, FIST_HOLE, KUKRI_ARM, type FingerOffsets } from './handrig';
import { TRIGGER_OFF, TRIGGER_SQUEEZE, leftGrip, rightGrip, type Grip } from './grips';
import { aimReticles } from './attachmodels';
import { disposeGun, movePart, partBox, partCenter, posePart, setBalisong, type GunModel, type Part } from './models';
import { PINCH_CURL, fitAt, gunHolds, magMesh, speedLoader, stripperClip, warmHolds, type Holds } from './holds';
import {
  CLIP_ROUNDS,
  CYL_CLOSE_AT,
  MAG_OUT_AT,
  MAG_SEAT_AT,
  blankClip,
  blankCylinder,
  blankPose,
  clipPose,
  cylinderPose,
  reloadPose,
  reloadStyle,
} from './reload';
import { kickSpring, spring, stepSpring } from './spring';
import {
  BFR_CHAMBER,
  BFR_CLOSE_AT,
  BFR_DUMP_AT,
  BFR_INSPECT,
  BFR_LOADER_DROP,
  BFR_LOADER_SHOW,
  BFR_MELEE,
  BFR_RL_COCK,
  BFR_RL_DECOCK,
  BFR_SEAT_AT,
  COCK_MS,
  COCK_SHIFT_DOWN,
  COCK_SHIFT_UP,
  COCK_THUMB_DOWN,
  COCK_THUMB_UP,
  bfrMove,
  bfrReload,
  blankBfrMove,
  blankBfrReload,
  cockAt,
  craneArm,
  craneOffset,
  placeCraneArm,
  poseHammer,
  splitHammer,
  type Hammer,
} from './bfr';
import { AuthoredArms, hasAuthored } from './fpanim';
import { M200_BASH, M200_BOLT, M200_INSPECT, m200Pose } from './m200';
import { HK_PRESENT_POS, HK_PRESENT_ROLL, MP5_BASH, MP5_BASH_HIT, MP5_INSPECT, hkGesture, mp5Play } from './mp5';
import type { GunSpec } from './weapons';
import type { GunId } from '@opencord/contracts';

/** `reloadClip`: recarga por pente-lâmina (Kar98k); `heavy`: golpe pesado da faca (antecipa e estoca) */
export type VmAction =
  'draw' | 'fire' | 'reload' | 'reloadEmpty' | 'reloadClip' | 'bolt' | 'melee' | 'heavy' | 'inspect';

export interface VmInput {
  /** 0 (quadril) a 1 (mirando) */
  ads: number;
  /** 0 parado a 1 andando */
  moving: number;
  sprint: boolean;
  tactical: boolean;
  slide: boolean;
  crouch: boolean;
  airborne: boolean;
  /** quanto o mouse mexeu neste quadro (rad) */
  lookX: number;
  lookY: number;
}

const ease = (u: number) => u * u * (3 - 2 * u);
const seg = (u: number, a: number, b: number) => Math.max(0, Math.min(1, (u - a) / (b - a)));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
/** sai rápido e chega devagar (sem elástico) */
const expOut = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
/** sobe em [a,b] e desce em [c,d] (0–1) */
const hump = (u: number, a: number, b: number, c: number, d: number) => ease(seg(u, a, b)) * (1 - ease(seg(u, c, d)));

/** limites do balanço: quanto um quadro de mouse pode empurrar e quanto a arma pode ficar para trás (rad) */
const LOOK_MAX = 0.05;
const SWAY_MAX = 0.12;
/** ombros (fixos no espaço da câmera), braço e antebraço (m) e o z mais perto da câmera que a manga pode chegar */
const SHOULDER = { x: 0.2, y: -0.35, z: 0.1 };
/**
 * O ombro esquerdo fica para a frente e para fora (postura de lado, a coronha no ombro direito): o braço de apoio
 * alcança o guarda-mão sem esticar e o antebraço entra pelo canto de baixo à esquerda, em vez de um tubo atravessando
 * o meio da tela.
 */
const SHOULDER_L = { x: 0.26, y: -0.32, z: -0.08 };
/** braço e antebraço do modelo (`assets/arms.glb`) */
const UPPER = ARM_RIG.upper;
const FORE = ARM_RIG.fore;
const ELBOW_MAX_Z = -0.08;
/** puxando a alavanca por cima: o cotovelo esquerdo fica mais longe da câmera, baixo e para fora */
const ELBOW_MAX_Z_OVER = -0.2;

// temporários do módulo (o update roda todo quadro: nada de alocar)
const V = new THREE.Vector3();
const W1 = new THREE.Vector3();
const POS = new THREE.Vector3();
const AIM = new THREE.Vector3();
const ROT = new THREE.Euler(0, 0, 0, 'YXZ');
/**
 * distância do olho mirando (z da câmera onde fica o ponto `sight`): a M4 encosta mais para o furo de trás abrir; a
 * SCAR-L um pouco (a −0,2 o furo era um anel fino em volta da massa)
 */
const ADS_EYE: Partial<Record<GunId, number>> = { m4: -0.15, mp5: -0.2, mp7: -0.18, scarl: -0.17 };
/**
 * Facas paradas (posição e giro YXZ do `holder`, sem mirar). Baioneta em martelo: o polegar por cima, o cabo atravessando
 * o punho fechado (a ponta do cabo aparece do lado do mindinho) e a lâmina para a frente e para cima, com o pulso
 * dobrado para o lado do mindinho, como quem segura de verdade. Karambit em reversa: o punho quase em pé no terço direito,
 * o antebraço entrando pelo canto de baixo, a argola em cima com o indicador e a garra saindo por baixo do punho e
 * curvando para o meio da tela, com a face à vista (a pegada é `KARAMBIT_ARM`, em `handrig.ts`). Balisong em martelo:
 * o punho fechado nos dois cabos no canto de baixo à direita (a ponta dos cabos sai do lado do mindinho), a lâmina para
 * a frente, para cima e para o meio da tela, com a face à vista e o dorso da mão para a câmera (`BALISONG_ARM`).
 */
const KNIFE_POSE: Record<
  'bayonet' | 'karambit' | 'balisong',
  {
    pos: THREE.Vector3;
    rot: THREE.Vector3Tuple;
    /** antebraço (do cotovelo ao pulso) no espaço da mão */ fore: THREE.Vector3;
  }
> = {
  bayonet: {
    pos: new THREE.Vector3(0.16, -0.155, -0.43),
    rot: [0.327, 0.914, 1.675],
    fore: new THREE.Vector3(-0.34, -0.17, -0.92).normalize(),
  },
  karambit: {
    pos: new THREE.Vector3(0.1232, -0.065, -0.3373),
    rot: [-0.1294, 0.8447, -0.3458],
    fore: new THREE.Vector3(-0.2, 0.05, -0.98).normalize(),
  },
  balisong: {
    pos: new THREE.Vector3(0.1694, -0.1241, -0.3889),
    rot: [0.5252, 0.769, 1.8761],
    fore: new THREE.Vector3(-0.15, 0, -0.99).normalize(),
  },
};
/**
 * Bowie parada, em martelo (`BOWIE_ARM`): o antebraço entra pelo canto de baixo à direita, o pulso caído para o lado do
 * mindinho, e a lâmina sobe para a frente e um pouco para o meio, o fio para a frente e a face direita à vista (o dorso
 * da lâmina fica do lado do antebraço, como numa mão de verdade).
 */
const BOWIE_POSE = {
  pos: new THREE.Vector3(0.1635, -0.1327, -0.3264),
  rot: [0.4363, 1.0472, 1.6232] as THREE.Vector3Tuple,
  fore: new THREE.Vector3(-0.5, -0.1, -0.86).normalize(),
};
const HIP_PISTOL = new THREE.Vector3(0.09, -0.085, -0.33);
/**
 * Quadril próprio de uma arma (posição do `holder` e giros, no lugar dos de sempre). Automag III: mais baixa, à direita
 * e virada para o meio, o cano um pouco para cima: o ferrolho comprido aparece de lado (na pose das pistolas ela ficava
 * de costas para a câmera, só o punho e as mãos à vista).
 */
interface HipPose {
  pos: THREE.Vector3;
  yaw: number;
  roll: number;
  pitch: number;
}
const HIP_OWN: Partial<Record<GunId, HipPose>> = {
  automag3: { pos: new THREE.Vector3(0.12, -0.13, -0.38), yaw: 0.35, roll: -0.1, pitch: 0.15 },
};
/** arma longa no quadril: perto do corpo (mais longe, o braço de apoio não alcança o guarda-mão e a arma "voa" ao mirar) */
const HIP_LONG = new THREE.Vector3(0.13, -0.15, -0.38);
const GRIP_R = new THREE.Vector3();
const LEFT = new THREE.Vector3();
const MAG = new THREE.Vector3();
const HANDLE = new THREE.Vector3();
/** corrida tática: a mão esquerda solta a arma e desce para fora da tela (espaço da câmera) */
const LEFT_OFF = new THREE.Vector3(-0.22, -0.6, -0.2);
/** a mão esquerda pela lateral esquerda da arma: palma para a arma, dedos para a frente, indicador em cima */
const SIDE_Q = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)),
);
/** pegando a alavanca do ferrolho em pinça (dedos, polegar, indicador) */
const PINCH: readonly [number, number, number] = PINCH_CURL;
/**
 * Ferrolho trabalhado em pinça na bola da alavanca (SV-98: a bola fica a ~2 cm da coronha, sem lugar para a mão
 * fechar em volta dela): a bola parada (espaço da arma) e quanto do giro da alavanca o pulso acompanha. Preso por
 * inteiro, ele virava ~70° junto com ela e a mão ficava de dorso para cima, os dedos pendurados por cima da caixa.
 */
const BOLT_HAND: Partial<Record<string, { knob: THREE.Vector3; roll: number }>> = {
  sv98: { knob: new THREE.Vector3(0.0227, 0.0444, -0.0263), roll: 0.35 },
  // M200: a mão fechada na bola, girando 40% do giro dela (girando tudo, o dorso virava para cima e o braço vinha do
  // alto da tela, com o cotovelo levantado)
  m200: { knob: new THREE.Vector3(0.0649, 0.0225, -0.0049), roll: 0.4 },
  // FN Ballista: a bola fica longe da caixa (a mão fecha em volta dela), mas virava ~70° com a alavanca
  ballista: { knob: new THREE.Vector3(0.0558, 0.0607, -0.0143), roll: 0.35 },
  l115: { knob: new THREE.Vector3(0.0438, 0.0433, -0.0256), roll: 0.35 },
  kar98k: { knob: new THREE.Vector3(0.0401, 0.0484, -0.0395), roll: 0.35 },
  // RS9: a alavanca desce para a direita (a bola fica 6 cm abaixo do eixo); girando junto, a mão ficava de dorso para
  // cima e os dedos pendurados por cima da caixa
  rs9: { knob: new THREE.Vector3(0.0429, 0.0211, -0.036), roll: 0.35 },
};
/** Kar98k: quanto a alavanca gira por unidade de `boltRot` (1,2 × 1,3 ≈ 90°, como no Mauser) */
const KAR_LIFT = 1.3;
const KNOB_NOW = new THREE.Vector3();
const KNOB_Q = new THREE.Quaternion();
const LEVER_Q = new THREE.Quaternion();
/** o coice nunca traz a arma para mais perto da câmera que isto (z no espaço da câmera do viewmodel) */
const KICK_Z_MAX = -0.12;
/** meia espessura da palma (palpite para os gestos da recarga; o encaixe medido corrige) */
const PALM_HALF = 0.017;
/**
 * Recarga vazia, por arma, sem o braço esquerdo passar por cima da arma (cobria 1/3 da tela): tapa no retém do
 * ferrolho pela esquerda (M4, MP7), alavanca da direita puxada por baixo (AK), alavanca da frente puxada pela esquerda
 * (StG 44), o "tapa HK" da MP5 (`mp5.ts`: trava a alavanca antes de tirar o pente e solta com um tapa depois), o polegar
 * direito solta o ferrolho da pistola, a mão direita trabalha o ferrolho da sniper.
 */
type EmptyKind = 'slap' | 'under' | 'rack' | 'front' | 'hook' | 'hk' | 'pistol' | 'bolt';
const EMPTY_GESTURE: Partial<Record<string, EmptyKind>> = {
  m4: 'slap',
  mp7: 'slap',
  ak47: 'rack',
  mp5: 'hk',
  l115: 'bolt',
  m200: 'bolt',
  m9: 'pistol',
  deagle: 'pistol',
  scarl: 'slap',
  mcx: 'slap',
  mpx: 'slap',
  pdw: 'slap',
  msmc: 'front',
  aks74u: 'rack',
  stg44: 'hook',
  rs9: 'bolt',
  ballista: 'bolt',
  sv98: 'bolt',
  automag3: 'pistol',
};
/**
 * AKS-74U (`rack`): a direita solta o punho, sobe pela lateral direita e fecha em gancho na alavanca (dedos para a
 * esquerda, passando à frente dela, palma para trás, indicador em cima); puxa até o fim e solta (o ferrolho volta
 * sozinho, a mão fica atrás) e volta ao punho. A esquerda fica no guarda-mão: por baixo, a mão dela ficava no
 * guarda-mão longe da alavanca e, levada até ela, o antebraço atravessava o pente. Pulso em relação ao centro do
 * ferrolho (espaço da arma)
 */
const RACK_AT = new THREE.Vector3(0.124, 0, 0.012);
const RACK_Q = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0)),
);
const RACK_PULL = 0.07;
/** `RACK_AT` de cada arma em que a alavanca fica em outro lugar do ferrolho (AK-47: mais atrás, no fim do transportador) */
const RACK_AT_OF: Partial<Record<string, THREE.Vector3>> = {
  ak47: new THREE.Vector3(0.11, 0, 0.058),
};
/**
 * StG 44 (`hook`): a alavanca fica à esquerda, na frente da caixa, com a haste saindo ~4 cm para o lado. A esquerda
 * vem pela esquerda e fecha os dedos em gancho na ponta da haste (palma para trás, dedos descendo pela frente dela e
 * dobrando para a caixa); puxa até o fim e solta: a alavanca volta sozinha num estalo e a mão fica atrás, abrindo.
 * Antes a mão ia espalmada por cima da caixa e a alavanca voltava junto com ela. `HOOK_AT`: o ponto da haste no vão
 * dos dedos (espaço da arma, com a alavanca parada); no puxão a arma rola um pouco (`HOOK_ROLL`) e desce, com a
 * lateral esquerda (alavanca e mão em gancho) virada para a câmera.
 */
const HOOK_AT = new THREE.Vector3(-0.062, 0.07, -0.127);
const HOOK_Q = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2))
  .multiply(
    new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0, 1, 0),
      ),
    ),
  );
const HOOK_PULL = 0.06;
const HOOK_ROLL = 0.3;
/**
 * O polegar da direita no punho, por arma: [fechamento, abertura para o lado da palma], no lugar do encaixe medido. Dá a
 * volta por trás do punho e deita na lateral esquerda, atrás do gatilho. O encaixe deixava o da StG 44 em pé do lado
 * direito, encostado na caixa (medido no harness: a ponta passa de x +3,6 cm para −2,6 cm, a ~2 mm da malha). Nas armas
 * com a pegada da direita medida (`RIGHT_FIX` `hold`, em `holds.ts`), o polegar foi escolhido junto com ela: encostado
 * na lateral esquerda do punho, sem entrar.
 */
const RIGHT_THUMB: Partial<Record<string, readonly [number, number]>> = {
  stg44: [0.5, 0.85],
  rs9: [0.63, 1.1],
  mcx: [0.6, 0.9],
  m4: [0.6, 0.9],
  automag3: [0.2, 0.8],
  sv98: [0.45, 0.85],
  scarl: [0.5, 0.5],
  aks74u: [0.45, 0.7],
  m9: [0.4, 0.45], // pistola com as duas mãos: deita na lateral esquerda, para a frente, por cima do polegar de apoio
  msmc: [0.4, 0.6],
  m200: [0.46, 0.7],
  mp5: [0.58, 0.9],
  ballista: [0.42, 0.65],
  mpx: [0.5, 0.5],
  deagle: [0.3, 0.2],
  l115: [0.45, 0.8],
  bfr: [0.3, 0.6],
  ak47: [0.35, 0.5],
  rhino: [0.5, 0.6],
  // MP7 (de volta ao caminho de código): o encaixe deixava o polegar em pé do lado direito, por cima do punho
  mp7: [0.5, 0.85],
};
/** inspeção da StG 44, segundo lado: giro (rad) e quanto a arma vai para longe (m) */
const S2_STG = { yaw: 0.45, roll: 0.3, pitch: 0.12, push: 0.04 };
/** inspeção da MPX: giro (rad) e deslocamento (m) de cada lado (`mpxInspect`) */
const MPX_INSPECT = {
  yaw1: -0.6,
  roll1: 0.4,
  pitch1: 0.15,
  x1: 0.06,
  y1: 0.04,
  push1: 0.04,
  yaw2: 0.15,
  roll2: 0.9,
  pitch2: 0.2,
  x2: -0.05,
  y2: 0.07,
  push2: 0.03,
};
/** pente dentro do punho (MP7, MSMC): ele cai e o novo entra por baixo, como na pistola */
const GRIP_MAG: ReadonlySet<string> = new Set(['mp7', 'msmc']);
/**
 * pente no punho que sobra embaixo dele (MSMC, MP7): com bala, a esquerda pega a base, puxa, guarda no colete e volta
 * com um cheio, como nos fuzis (cair, só vazio)
 */
const GRIP_MAG_TACTICAL: ReadonlySet<string> = new Set(['msmc', 'mp7']);
/**
 * quanto a arma sobe a mais na recarga do pente no punho (x, y, z em m, cano para cima em rad, no pico). MP7: como a
 * MSMC (sem subir, a troca do pente acontecia embaixo da borda da tela)
 */
const GRIP_MAG_LIFT: Partial<Record<string, readonly [number, number, number, number]>> = {
  msmc: [-0.04, 0.06, 0.02, 0.15],
  mp7: [-0.04, 0.06, 0.02, 0.15],
};
/**
 * a bola da alavanca do ferrolho (espaço da arma) quando a peça inteira é grande e o meio dela não é onde se pega.
 * MSMC: a alavanca fica na frente da caixa, do lado esquerdo, logo acima da empunhadura (a peça vai até o fundo da caixa)
 */
const CHARGE_KNOB: Partial<Record<string, THREE.Vector3>> = { msmc: new THREE.Vector3(-0.035, 0.069, -0.16) };
/** o tambor do revólver sai para a esquerda e um pouco para baixo (espaço da arma) */
const CYL_OUT = new THREE.Vector3(-0.034, -0.01, 0);
/** o gesto da recarga vazia neste quadro (preenchido pelo `emptyGesture`; peças, mãos e o giro da esquerda) */
const EG = {
  bolt: 0,
  charge: 0,
  /** a alavanca girando no tubo (o entalhe da MP5) */
  chargeRot: 0,
  boltRot: 0,
  rightK: 0,
  thumbR: 0,
  alt: 0,
  altQ: SIDE_Q,
  out: 0,
  curl: 0.8,
  thumb: 0.5,
  at: new THREE.Vector3(),
  /** onde vai o pulso direito no gesto `rack` (espaço da arma) */
  rat: new THREE.Vector3(),
  /** o arco da mão indo e voltando da peça (`ARC_OUT`, por fora e por baixo; a MP5 vai por cima) */
  arc: new THREE.Vector3(),
  /** MP5: a arma vem ao encontro da mão na alavanca (0–1) */
  present: 0,
};
/** na recarga, o pulso esquerdo em relação ao fundo do pente: a palma (para cima) encosta embaixo dele (ver grips) */
const LEFT_Q = new THREE.Quaternion();
const RIGHT_Q = new THREE.Quaternion();
/** a pose da recarga e do pente-lâmina neste quadro (`reload.ts`) */
const RP = blankPose();
const CP = blankClip();
const CY = blankCylinder();
/**
 * Porta-carregador no colete (esquerda, embaixo, fora da tela) e a cartucheira da direita (Kar98k), no espaço da
 * câmera: a mão leva o pente velho / busca o novo ali
 */
const POUCH_L = new THREE.Vector3(-0.32, -0.5, -0.3);
/** indo e voltando do pente, a mão passa por fora (−x) e por baixo da arma, em arco (espaço da arma) */
const ARC_OUT = new THREE.Vector3(-0.045, -0.035, 0);
/** a mão esquerda no meio desse caminho: dedos e polegar meio fechados (fechamento) */
const LEFT_TRANSIT: readonly [number, number] = [0.7, 0.45];
/** o pente e a mão indo para o colete: por fora e pela frente (atrás ficam o punho e a mão direita) */
const ARC_POUCH = new THREE.Vector3(-0.08, -0.02, -0.06);
const POUCH_R = new THREE.Vector3(0.3, -0.55, -0.1);
/** quanto o pente desce para sair do poço (espaço da arma): fuzil e pistola */
const MAG_PULL = new THREE.Vector3(0, -0.12, 0.02);
const MAG_PULL_PISTOL = new THREE.Vector3(0, -0.09, 0.01);
/**
 * AK-47: o pente curvo sai e entra girando na trava da frente do poço (`AK_PIVOT`, espaço da arma): para sair, a base
 * vai para a frente (`AK_ROCK` rad) e só então ele desce; para entrar, a frente engata na trava e ele gira para trás até
 * travar. Depois de girado, desce um pouco para a frente (`AK_PULL`).
 */
const AK_PIVOT = new THREE.Vector3(0, 0.005, -0.152);
const AK_ROCK = 0.45;
const AK_PULL = new THREE.Vector3(0, -0.11, -0.03);
const AK_X = new THREE.Vector3(1, 0, 0);
const AK_Q = new THREE.Quaternion();
const AK_HQ = new THREE.Quaternion();
const AK_M = new THREE.Matrix4();
const AK_V = new THREE.Vector3();
/** o quanto o pente já girou e desceu pelo quanto ele saiu (0 no lugar, 1 fora): primeiro gira, depois desce */
const akTurn = (out: number) => ease(seg(out, 0, 0.5));
const akSlide = (out: number) => ease(seg(out, 0.4, 1));
/** o giro de `a` rad na trava da frente, em matriz no espaço da arma (escreve em `out`) */
function akRock(a: number, out: THREE.Matrix4): THREE.Matrix4 {
  AK_Q.setFromAxisAngle(AK_X, a);
  out.makeRotationFromQuaternion(AK_Q);
  return out.setPosition(AK_V.copy(AK_PIVOT).sub(W2.copy(AK_PIVOT).applyQuaternion(AK_Q)));
}
/**
 * a mão direita em relação ao topo do pente-lâmina (espaço da arma), no giro da pegada do delgado: a palma pela direita
 * da caixa da culatra, a 2 cm dela, os dedos meio fechados encostando na lateral e o polegar deitado de través por cima
 * das balas, logo à frente da lâmina (antes a mão ficava acima da janela, aberta, com o indicador e o médio entrando na
 * caixa; conferido no harness, de frente, de baixo e pela direita: nenhum dedo entra na coronha)
 */
const CLIP_HAND = new THREE.Vector3(0.075, 0.012, 0.039);
/** os dedos da direita no pente-lâmina (dedos, polegar, indicador) e o polegar aberto para o lado, como no delgado */
const CLIP_CURL: readonly [number, number, number] = [0.75, 0.35, 0.75];
const CLIP_THUMB_AB = 0.5;
/**
 * o topo do pente-lâmina encaixado no guia em cima da janela da Kar98k (espaço da arma): a lâmina de pé com o pé no
 * guia (y 0,09) e as 5 balas para cima, para a frente; o polegar as empurra para o depósito (antes o topo ficava no guia
 * e a lâmina inteira, com as balas, já começava dentro da caixa)
 */
const CLIP_GUIDE = new THREE.Vector3(0, 0.142, -0.045);
/** a altura de uma bala na lâmina (holds.stripperClip) */
const CLIP_PITCH = 0.0102;
/** peças soltas (pente vazio caindo, lâmina vazia voando): quanto tempo ficam na tela (ms) e a gravidade (m/s²) */
const DEBRIS_MS = 900;
const DEBRIS_G = 9.8;
const DEBRIS_MAX = 4;
/**
 * Pistolas em que o ferrolho trava aberto depois do último tiro (o retém segura ele para trás) e só fecha quando o
 * polegar solta o retém na recarga vazia; e quanto ele fica para trás (m, o mesmo do gesto da recarga vazia).
 */
const SLIDE_LOCK: ReadonlySet<string> = new Set(['automag3', 'm9', 'deagle']);
const SLIDE_LOCK_BACK = 0.035;
/** pistolas em que a esquerda chega depois no saque (a direita traz a arma sozinha e a esquerda fecha por fora dela) */
const LATE_SUPPORT: ReadonlySet<string> = new Set(['m9', 'deagle']);
/** no tiro, quando o ferrolho chega lá atrás (fração do `fire`): dali em diante, travado, ele não volta */
const SLIDE_LOCK_AT = 0.42;
/** quantos estojos esperando o `game.ts` levar para o mundo, no máximo */
const EJECT_MAX = 8;
/** revólver: quando a vareta empurra os estojos para fora (fração da recarga, logo depois de o tambor abrir) */
const CYL_DUMP_AT = 0.26;
/** o carregador rápido: aparece na mão quando ela volta do cinto (`cylinderPose.pouch` no pico) e some com ela */
const LOADER_SHOW = 0.44;
const LOADER_GONE = 0.64;
/** onde a mão segura o carregador rápido (espaço da mão: à frente da palma, nos dedos) */
const LOADER_IN_HAND = new THREE.Vector3(0, -0.03, -0.085);
/**
 * Magnum BFR (`bfr.ts`): a recarga, a coronhada e a inspeção deste quadro, o gesto do polegar no cão, o giro da mão
 * esquerda segurando o carregador rápido atrás do tambor (pela esquerda: palma para a direita, dedos para a frente
 * fechando no corpo dele, polegar por cima; por trás, a mão tampava o carregador) e onde ele fica nela (espaço da mão)
 */
const BR = blankBfrReload();
const BM = blankBfrMove();
const CK = { reach: 0, ham: 0 };
const BFR_LQ = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0.95, 0.3).normalize(),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, -0.3, 0.95).normalize(),
  ),
);
const BFR_LQ_INV = BFR_LQ.clone().invert();
const BFR_IN_HAND = new THREE.Vector3(0, -0.03, -0.06);
const BFR_Q = new THREE.Quaternion();
/**
 * Rhino: o carregador rápido não sai da mão — ela o leva até atrás do tambor, empurra, gira o botão, puxa o carregador
 * vazio para trás e para fora e solta (ele cai); quanto ela puxa (espaço da arma) e quando solta (fração da recarga)
 */
const RHINO_PULL = new THREE.Vector3(-0.025, -0.015, 0.05);
const RHINO_LOADER_TOSS = 0.69;
/**
 * a mão com o carregador rápido pela esquerda dele: palma para a arma, dedos para cima dando a volta nele, o pulso
 * embaixo (por trás do tambor, o antebraço tapava o tambor e o carregador na visão do jogador)
 */
const RHINO_LOADER_Q = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)),
);
/** acertos dos dedos (misturados por quadro, sem alocar) */
const OFF_R: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const OFF_L: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const NO_OFF: FingerOffsets = [0, 0, 0, 0, 0];
const M1 = new THREE.Matrix4();
const POUCH = new THREE.Vector3();
/**
 * Inspeção por arma: o giro que mostra o lado esquerdo (rad), a rolagem e o deslocamento (x para a esquerda, z para
 * trás). FN Ballista: a coronha comprida passava na frente da câmera e enchia metade da tela; a arma vai para a frente
 * (antes de girar) e para a direita, e rola menos, mostrando o lado esquerdo inteiro de perfil
 */
const INSPECT_TUNE: Partial<Record<string, { yaw: number; roll: number; x: number; z: number }>> = {
  ballista: { yaw: 0.95, roll: 0.35, x: -0.06, z: -0.16 },
};
/** armas em que a mão de apoio pega o pente pela lateral (na inspeção) */
const SIDE_MAG: ReadonlySet<string> = new Set(['m4', 'ak47', 'mp5', 'scarl', 'mcx', 'aks74u', 'stg44', 'mpx', 'pdw']);
const M2 = new THREE.Matrix4();
const Q1 = new THREE.Quaternion();
const S1 = new THREE.Vector3();

/** um estojo saindo da arma (espaço da câmera do viewmodel): o `game.ts` leva para o mundo */
export interface VmEject {
  at: THREE.Vector3;
  vel: THREE.Vector3;
  /** o eixo do cano (o estojo sai deitado ao longo dele) */
  axis: THREE.Vector3;
  kind: EjectKind;
}

/** peça solta caindo na primeira pessoa (no espaço da câmera do viewmodel) */
interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  t: number;
}
const HQ = new THREE.Quaternion();
const FORE_DIR = new THREE.Vector3();
const FORE_L = new THREE.Vector3();
const SPIN_Q = new THREE.Quaternion();
/**
 * Saque das facas (ms): o braço sobe de baixo à direita e a karambit dá uma volta no indicador (`KAR_DRAW`), ou sobe
 * com a lâmina em pé (baioneta, que deita até a ponta apontar para o meio da tela) e desce para a guarda, passando um
 * pouco do ponto. Só a animação: o tempo de sacar do jogo (`game.ts`) não muda, e um golpe logo depois corta o saque com
 * a passagem suave do `carry`.
 */
const KNIFE_DRAW_MS = 1000;
/** inspeção da faca (ms): levanta, mostra uma face (pausa), a outra (pausa), o floreio e volta */
const KNIFE_INSPECT_MS = 3400;
/** quanto tempo a pose de uma ação cortada leva para voltar ao lugar (ms) */
const CARRY_MS = 160;
/** dedos soltos enquanto a faca gira (o indicador da karambit fica na argola) */
const OPEN_CURL = 0.35;
const OPEN_THUMB = 0.2;
/**
 * Mão esquerda de guarda com faca (espaço da câmera): baixa à esquerda, meio fechada, o dorso para cima e para a câmera
 * e os dedos apontando para a frente e para o meio — as duas mãos na frente do corpo, como numa base de luta.
 */
const GUARD_L = new THREE.Vector3(-0.17, -0.16, -0.42);
const GUARD_Q = (() => {
  const f = new THREE.Vector3(0.45, 0.25, -0.86).normalize();
  const back = new THREE.Vector3(-0.15, 0.75, 0.6);
  back.addScaledVector(f, -back.dot(f)).normalize();
  const z = f.clone().negate();
  const x = new THREE.Vector3().crossVectors(back, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, back, z));
})();
/** a guarda da balisong: punho frouxo com o pulso reto (`BAL_GUARD`) */
const BAL_GUARD_Q = (() => {
  const f = new THREE.Vector3(...BAL_GUARD.fwd).normalize();
  const back = new THREE.Vector3(...BAL_GUARD.back);
  back.addScaledVector(f, -back.dot(f)).normalize();
  const z = f.clone().negate();
  const x = new THREE.Vector3().crossVectors(back, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, back, z));
})();
/** a guarda relaxada: dedos meio dobrados (o mindinho mais), o indicador um pouco mais aberto e o polegar solto */
const GUARD_CURL = 0.5;
const GUARD_INDEX = 0.38;
const GUARD_THUMB = 0.3;
/**
 * Bowie: a esquerda de guarda na linha do antebraço (o pulso reto; com a de sempre, o pulso dobrava ~90° para cima e
 * os dedos caíam, uma garra), a palma para a frente e para a direita, os dedos soltos subindo para a frente.
 */
const BOWIE_GUARD_L = new THREE.Vector3(-0.16, -0.19, -0.46);
const BOWIE_GUARD_Q = (() => {
  const f = new THREE.Vector3(0.3, 0.6, -0.74).normalize();
  const back = new THREE.Vector3(-0.85, 0.15, 0.5);
  back.addScaledVector(f, -back.dot(f)).normalize();
  const z = f.clone().negate();
  const x = new THREE.Vector3().crossVectors(back, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, back, z));
})();
/** os dedos da mão da faca antes de fechar no cabo (o encaixe fecha cada um até encostar) */
const KNIFE_OPEN: [number, number, number] = [0.3, 0.2, 0.3];
/**
 * deslocamento da animação neste quadro: posição e giro do `holder`, giro extra no espaço da câmera (`ex`, `ey`, `ez`) e
 * em volta do antebraço (`pro`, pronação e supinação), giro da faca na mão (`spin` no eixo dela; `twist` no comprimento
 * da lâmina), dedos abertos e a mão esquerda de guarda (deslocamento no espaço da câmera)
 */
interface Offsets {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  ex: number;
  ey: number;
  ez: number;
  pro: number;
  /** giro no comprimento da faca (eixo z dela), mão junto */
  roll: number;
  spin: number;
  twist: number;
  /** karambit: quanto a argola escorrega para fora no indicador (m, em `KAR_SLIDE`) */
  slide: number;
  open: number;
  /** balisong: quanto ela está fechada (0 aberta) e os giros extras do cabo de morder e da lâmina (rad) */
  shut: number;
  bite: number;
  bladeX: number;
  lx: number;
  ly: number;
  lz: number;
}
const zeroOffsets = (): Offsets => ({
  px: 0,
  py: 0,
  pz: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  ex: 0,
  ey: 0,
  ez: 0,
  pro: 0,
  roll: 0,
  spin: 0,
  twist: 0,
  slide: 0,
  open: 0,
  shut: 0,
  bite: 0,
  bladeX: 0,
  lx: 0,
  ly: 0,
  lz: 0,
});
/** o que as animações da faca pedem neste quadro além de `pos`/`rot` (preenchido por `knifeDraw`, `knifeInspect` e os golpes) */
const KD = zeroOffsets();
const resetKD = () => {
  KD.ex = KD.ey = KD.ez = KD.pro = KD.roll = KD.spin = KD.twist = KD.slide = KD.open = KD.lx = KD.ly = KD.lz = 0;
  KD.shut = KD.bite = KD.bladeX = 0;
};
const KQ = new THREE.Quaternion();
const KQ2 = new THREE.Quaternion();
const KE = new THREE.Euler(0, 0, 0, 'ZYX');
const TWIST_Q = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const GL = new THREE.Vector3();
/** karambit correndo: giro do braço no espaço da câmera (somado ao das animações, fora do `carry`) */
const RUN_E = new THREE.Vector3();
/** ângulo em (−π, π] (a volta mais curta para casa) */
const wrapAngle = (a: number) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
/** temporários do caminho feito à mão */
const AU_ROOT = new THREE.Matrix4();
const AU_M = new THREE.Matrix4();
const AU_Q = new THREE.Quaternion();
const AU_S = new THREE.Vector3();
const AU_V = new THREE.Vector3();
const AU_ONE = new THREE.Vector3(1, 1, 1);

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
  private readonly holder = new THREE.Group();
  private readonly sway = new THREE.Group();
  /** braços com esqueleto (`arms.ts`): as mãos são âncoras no espaço da arma, o braço é resolvido até o ombro */
  private readonly arms: FpsArms;
  private readonly handR: ArmHand;
  private readonly handL: ArmHand;
  /** onde ficam as mãos no espaço da arma quando seguram (a animação sai e volta para cá) */
  private readonly rightAt = new THREE.Vector3();
  private readonly leftAt = new THREE.Vector3();
  private rightCurl: [number, number, number] = [0.9, 0.5, 0.42];
  private leftCurl: [number, number, number] = [0.8, 0.8, 0.8];
  /** onde fica o pente parado (espaço da arma), para a mão ir buscar, e o fundo dele (onde a palma encosta) */
  private readonly magHome = new THREE.Vector3();
  private readonly magBottom = new THREE.Vector3();
  /** a alavanca que se vê, parada (espaço da arma): a mão vai até ela na recarga vazia */
  private chargeHome: THREE.Vector3 | null = null;
  /** o retém do ferrolho (esquerda do receptor, acima do pente): o pulso para o tapa da recarga vazia */
  private readonly slapAt = new THREE.Vector3();
  /** StG 44: o pulso esquerdo com a haste da alavanca no vão dos dedos (o gesto `hook`, espaço da arma) */
  private readonly hookAt = new THREE.Vector3();
  private readonly leftQ = new THREE.Quaternion();
  /** as pegadas medidas na malha da arma (`holds.ts`): palma encostada, cada dedo fechado até tocar */
  private holds: Holds | null = null;
  /** o ferrolho da pistola travado aberto (pente vazio, nas de `SLIDE_LOCK`) */
  private slideHeld = false;
  /** a alavanca do ferrolho parada (inversa da matriz dela no espaço da arma): a mão anda junto com ela */
  private readonly handleRestInv = new THREE.Matrix4();
  /** o gesto da recarga vazia: o acerto do pulso (palma encostada) e dos dedos, medido na pose do gesto */
  private readonly egFix = new THREE.Vector3();
  /** a mão direita em relação ao pente-lâmina, já com a palma encostada fora da caixa da culatra (Kar98k) */
  private readonly clipHand = CLIP_HAND.clone();
  private egOff: FingerOffsets = [0, 0, 0, 0, 0];
  /** faca: o acerto de cada dedo medido no cabo (eles partem de `KNIFE_OPEN` e fecham até encostar) */
  private knifeOff: FingerOffsets = [0, 0, 0, 0, 0];
  /** cópia do pente sem os cartuchos (o vazio que cai) e o pente-lâmina da Kar98k, com as balas */
  private magGhost: THREE.Object3D | null = null;
  private clip: { root: THREE.Group; rounds: THREE.Mesh[] } | null = null;
  /** o carregador rápido do revólver e o centro da face de trás do tambor fechado (espaço da arma) */
  private loader: THREE.Group | null = null;
  private readonly loaderSeat = new THREE.Vector3();
  private readonly debris: Debris[] = [];
  /** estojos que saíram neste quadro (o `game.ts` leva para o mundo e esvazia) */
  readonly ejects: VmEject[] = [];
  /** o ferrolho chegou para trás neste quadro: o estojo sai depois de as peças irem para o lugar */
  private ejectAfter = false;
  /** revólver: o tambor abriu e a vareta foi empurrada neste quadro (os estojos caem depois das peças no lugar) */
  private dumpAfter = false;
  /**
   * Magnum BFR: o cão (separado da armação), o quanto ele está armado (0–1), o gesto do polegar depois do tiro (ms;
   * negativo = esperando o coice; NaN = nenhum), o cão no começo da recarga, o raio dos furos do tambor e se o
   * carregador rápido vazio já foi largado nesta recarga
   */
  private bfrHam: Hammer | null = null;
  private bfrCocked = 1;
  private bfrCockT = Number.NaN;
  private bfrFrom = 1;
  private bfrRing = 0.012;
  private bfrDropped = false;
  /** o braço do tambor aberto e a face da frente do tambor (z, espaço da arma) */
  private bfrArm: THREE.Mesh | null = null;
  private bfrFront = 0;
  private gun: GunModel | null = null;
  private spec: GunSpec | null = null;
  private action: { kind: VmAction; t: number; ms: number; side: number } | null = null;
  /** coice da arma (molas da arma): para trás (m), subida do cano, rolagem e lado (rad) */
  private readonly kBack = spring();
  private readonly kRise = spring();
  private readonly kRoll = spring();
  private readonly kSide = spring();
  /** a mira do último quadro (o coice mirando é menor) */
  private adsNow = 0;
  /** tranco curto (mola): pente encaixando, ferrolho fechando, fim do saque, fim do corte */
  private jolt = 0;
  private joltV = 0;
  private joltDone = new Set<string>();
  private bob = 0;
  private swayX = 0;
  private swayY = 0;
  private sprintK = 0;
  private tacK = 0;
  private slideK = 0;
  private airK = 0;
  /** a mão esquerda fora da arma (corrida tática): sai junto com a tática e volta mais rápido que a arma */
  private leftOffK = 0;
  private meleeSide = 1;
  /**
   * Faca: o ponto e o eixo (espaço da faca) em que ela gira na mão. Karambit: o centro da argola, no eixo dela (o
   * indicador); baioneta: o meio do cabo, no eixo perpendicular à lâmina (a lâmina gira no próprio plano)
   */
  private readonly spinPivot = new THREE.Vector3();
  private readonly spinAxis = new THREE.Vector3(1, 0, 0);
  /** o deslocamento da animação do último quadro e o que sobrou de uma ação cortada (some em `CARRY_MS`) */
  private last: Offsets = zeroOffsets();
  private carry: Offsets = zeroOffsets();
  private carryT = CARRY_MS;
  /** faca: o antebraço direito do último quadro (espaço da câmera), o eixo da pronação e da supinação */
  private readonly foreAxis = new THREE.Vector3(-0.5, 0.3, -0.8).normalize();
  private readonly flash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly flashLight: THREE.PointLight;
  private flashUntil = 0;
  private now = 0;
  /** 1 normal; ~0,3 com "reduzir movimento" */
  private readonly motion: number;
  /** animação feita à mão (ADR-0061; hoje só o MP7): no lugar das contas de código para esta arma */
  private authored: AuthoredArms | null = null;

  constructor(reducedMotion = false) {
    this.motion = reducedMotion ? 0.3 : 1;
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.5, 1, 0.6);
    this.scene.add(key);
    this.scene.add(this.sway);
    this.sway.add(this.holder);
    this.arms = new FpsArms();
    this.sway.add(this.arms.root);
    this.handR = this.arms.hand(1);
    this.handL = this.arms.hand(-1);
    this.holder.add(this.handR.root, this.handL.root);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        map: flashTexture(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffc070, 0, 2);
    this.holder.add(this.flash, this.flashLight);
  }

  setAspect(a: number) {
    if (Math.abs(this.camera.aspect - a) < 1e-4) return;
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  /** troca a arma (com a animação de sacar); o modelo de antes é liberado */
  setGun(g: GunModel, spec: GunSpec) {
    if (this.gun && this.gun !== g) disposeGun(this.gun);
    this.gun = g;
    this.spec = spec;
    this.slideHeld = false;
    this.bfrHam = null;
    this.holder.add(g.root);
    // a primeira pessoa vê a arma com o próprio frustum (a câmera é outra): nunca some pelas bordas
    g.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.frustumCulled = false;
    });
    const knife = spec.cls === 'knife';
    // com faca, a esquerda fica de guarda (baixa, meio fechada), fora da arma
    this.arms.build();
    applyGrip(this.handR, rightGrip(g, spec.cls, ARM_HAND_FIT));
    this.rightAt.copy(this.handR.root.position);
    this.rightCurl = curlOf(this.handR);
    applyGrip(this.handL, leftGrip(g, spec.cls, ARM_HAND_FIT));
    this.leftAt.copy(this.handL.root.position);
    this.leftQ.copy(this.handL.root.quaternion);
    this.leftCurl = curlOf(this.handL);
    // encaixe medido na malha (contact.ts): a palma encostada e cada dedo fechado até tocar a arma (uma vez por arma)
    this.holds = knife ? null : gunHolds(g, spec.cls);
    // as outras armas são medidas com o navegador à toa (a troca não trava na primeira vez)
    warmHolds();
    if (this.holds) {
      this.rightAt.copy(this.holds.right.pos);
      this.leftAt.copy(this.holds.left.pos);
      // o giro e os fechamentos medidos (o apoio escolhe o giro que encaixa melhor em cada guarda-mão)
      this.leftQ.copy(this.holds.left.quat);
      this.leftCurl = [...this.holds.left.curl];
      this.rightCurl = [...this.holds.right.curl];
    }
    this.clearDebris();
    this.magHome.set(0, -0.06, 0.03);
    const mag = g.parts.mag;
    if (mag) {
      this.holder.updateMatrixWorld(true);
      partHome(mag, this.holder, this.magHome);
    }
    // o fundo do pente (o meio da caixa dele, embaixo); sem a caixa, um palpite abaixo do osso
    const box = mag ? partBox(g, mag) : null;
    if (box) this.magBottom.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    else this.magBottom.copy(this.magHome).add(V.set(0, -0.08, 0));
    const handle = g.parts.charge ?? g.parts.slide ?? g.parts.bolt;
    this.chargeHome = handle ? partCenter(g, handle) : null;
    const knob = CHARGE_KNOB[g.id];
    if (knob && this.chargeHome) this.chargeHome.copy(knob);
    // o retém fica do lado esquerdo do receptor, logo acima e atrás do poço do pente: a palma encosta nele
    const top = box ? box.max.y : this.magHome.y;
    const bz = box ? box.max.z : this.magHome.z;
    this.slapAt.set(-0.025 - PALM_HALF, top - 0.04, bz + 0.046 - 0.01);
    if (!knife) this.prepareGunParts(g, spec);
    this.knifeOff = NO_OFF;
    const bay = ARM_HAND_FIT.bayonet;
    if (knife && g.id === 'bayonet') {
      // baioneta: os fechamentos já medidos na pegada (`BAYONET_ARM`), cada dedo encostado no cabo
      knifeSpinFrame(g, this.spinPivot, this.spinAxis);
      this.rightCurl = curlOf(this.handR);
      const c = this.rightCurl[0];
      this.knifeOff = [0, bay.curl[1] - c, bay.curl[2] - c, bay.curl[3] - c, 0, bay.thumbUp];
    } else if (knife && g.id === 'bowie') {
      // bowie: os fechamentos medidos de cada dedo (`BOWIE_ARM`, já encostados no cabo)
      knifeSpinFrame(g, this.spinPivot, this.spinAxis);
      const c = BOWIE_ARM.curl;
      this.knifeOff = [0, c[1] - 0.5, c[2] - 0.5, c[3] - 0.5, 0, c[5]];
      this.rightCurl = curlOf(this.handR);
    } else if (knife) {
      knifeSpinFrame(g, this.spinPivot, this.spinAxis);
      // os dedos partem abertos e fecham até encostar no cabo, um por um. Karambit: o indicador (atravessando a argola)
      // e o médio (rente à frente dela) ficam no fechamento medido da pegada; o anelar e o mindinho partem dele
      const kar = g.id === 'karambit';
      // Ka-Bar: a pegada medida dela (`kabar.ts`) no lugar do martelo genérico
      if (g.id === 'kabar') {
        this.handR.root.position.fromArray(KABAR_GRIP.pos);
        this.handR.root.quaternion.fromArray(KABAR_GRIP.quat);
        this.rightAt.copy(this.handR.root.position);
      }
      const start: [number, number, number] = kar
        ? curlOf(this.handR)
        : g.flip
          ? [...BAL_FIT_START]
          : g.id === 'kabar'
            ? [...KABAR_GRIP.start]
            : [...KNIFE_OPEN];
      // kukri: o polegar fica no fechamento medido, por cima dos dedos (`KUKRI_ARM`), sem encaixe
      const kuk = g.id === 'kukri';
      const f = fitHand(soupOf(g.root), 1, this.handR.root.position, this.handR.root.quaternion, start, {
        fingers: kar
          ? ['ring', 'pinky', 'thumb']
          : kuk
            ? ['index', 'middle', 'ring', 'pinky']
            : ['index', 'middle', 'ring', 'pinky', 'thumb'],
        maxCurl: 1.6,
        ...(kuk ? { base: [0, 0, 0, 0, KUKRI_ARM.thumb[0] - start[1], KUKRI_ARM.thumb[1]] } : {}),
      });
      this.knifeOff = f.offsets;
      this.rightCurl = start;
    }
    // trocou de arma: nada da anterior sobra
    this.last = zeroOffsets();
    this.carry = zeroOffsets();
    this.carryT = CARRY_MS;
    this.authored?.dispose();
    this.authored = !knife && hasAuthored(g.id) ? new AuthoredArms(g.id, g) : null;
    this.play('draw', knife ? KNIFE_DRAW_MS : spec.cls === 'pistol' ? 420 : 600);
  }

  play(kind: VmAction, ms: number) {
    // faca: cada golpe leve sai de um lado
    if (kind === 'melee') this.meleeSide = -this.meleeSide;
    // cortou uma ação no meio (golpe durante o saque, por exemplo): a pose dela volta suave em vez de pular
    if (this.action && kind !== 'fire') {
      this.carry = { ...this.last };
      this.carryT = 0;
    }
    // a inspeção da faca tem pausa em cada face e um floreio: mais longa que a pedida (só a animação; um golpe corta)
    if (kind === 'inspect' && this.spec?.cls === 'knife') ms = KNIFE_INSPECT_MS;
    // feita à mão: a inspeção tem a duração escrita; as outras seguem o tempo do jogo (recarga montada, saque)
    if (this.authored && kind !== 'fire') {
      if (kind === 'inspect') ms = this.authored.length('inspect') * 1000;
      if (kind === 'draw' || kind === 'reload' || kind === 'reloadEmpty' || kind === 'inspect' || kind === 'melee')
        this.authored.play(kind, ms);
    }
    this.action = { kind, t: 0, ms: Math.max(1, ms), side: this.meleeSide };
    this.joltDone.clear();
    // BFR: no saque o cão vem abaixado (o polegar arma subindo); na recarga, o polegar desarma se estiver armado
    if (this.bfrHam && (kind === 'draw' || kind === 'reload' || kind === 'reloadEmpty')) {
      if (kind === 'draw') this.bfrCocked = 0;
      this.bfrFrom = this.bfrCocked;
      this.bfrCockT = Number.NaN;
      this.bfrDropped = false;
    }
    // supressor e quebra-chamas: sem clarão na boca
    if (kind === 'fire' && !this.spec?.noFlash) {
      this.flashUntil = this.now + 45;
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flash.scale.setScalar(this.spec?.cls === 'sniper' ? 1.8 : this.spec?.cls === 'smg' ? 0.9 : 1.2);
    }
  }

  /**
   * O pente ficou vazio (o último tiro, ou a arma sacada já vazia): nas pistolas de `SLIDE_LOCK` o ferrolho trava
   * aberto (no tiro, depois de ir para trás) até o polegar soltar o retém na recarga vazia.
   */
  emptied() {
    if (this.gun && SLIDE_LOCK.has(this.gun.id)) this.slideHeld = true;
  }

  /**
   * Tiro: o coice da arma pelas molas dela (`recoil.vm`), a rolagem e o lado no sentido do recuo (`side` ±1); mirando,
   * menor (a mira de ferro não sai do centro), e o primeiro tiro com `first` do coice.
   */
  fire(side: number, first = 1) {
    const sp = this.spec;
    if (!sp) return;
    this.play('fire', 120);
    const v = sp.recoil.vm;
    const a = this.adsNow;
    const k = first;
    kickSpring(this.kBack, v.k, v.c, v.back * (1 - 0.4 * a) * k);
    kickSpring(this.kRise, v.k, v.c, v.rise * (1 - 0.65 * a) * k);
    kickSpring(this.kRoll, v.k, v.c, -v.roll * (1 - 0.6 * a) * side * k);
    kickSpring(this.kSide, v.k, v.c, -v.side * (1 - 0.6 * a) * side * k);
    // semiautomática e automática: o estojo sai no tiro (no ferrolho, sai quando a mão abre a culatra)
    if (!sp.boltMs) this.eject(false);
    this.authored?.fire();
    // BFR (ação simples): o cão cai no tiro; o polegar arma de novo depois do coice
    if (this.bfrHam) {
      this.bfrCocked = 0;
      this.bfrCockT = -150;
    }
  }

  /** o coice de agora (para trás em m e a subida em rad), para as medidas */
  get kickNow(): { back: number; rise: number; roll: number } {
    return { back: this.kBack.x, rise: this.kRise.x, roll: this.kRoll.x };
  }

  get busy(): VmAction | null {
    return this.action && this.action.kind !== 'fire' ? this.action.kind : null;
  }

  /** a boca da arma no espaço da câmera do viewmodel (para o traçante sair dela) */
  muzzleView(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.gun) return null;
    return this.gun.root.localToWorld(out.copy(this.gun.muzzle));
  }

  update(dt: number, now: number, inp: VmInput) {
    this.now = now;
    const g = this.gun;
    const spec = this.spec;
    if (!g || !spec) return;
    if (this.authored) return this.updateAuthored(g, spec, this.authored, dt, now, inp);
    const mo = this.motion;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.sprintK += ((inp.sprint && !inp.slide ? 1 : 0) - this.sprintK) * k(10);
    this.tacK += ((inp.tactical && !inp.slide ? 1 : 0) - this.tacK) * k(10);
    this.slideK += ((inp.slide ? 1 : 0) - this.slideK) * k(12);
    this.airK += ((inp.airborne ? 1 : 0) - this.airK) * k(8);
    const leftOffTo = inp.tactical && !inp.slide ? 1 : 0;
    this.leftOffK += (leftOffTo - this.leftOffK) * k(leftOffTo > this.leftOffK ? 10 : 20);
    // balanço: a arma fica para trás do mouse e volta (menos mirando); um tranco de mouse (ou a câmera virando de uma
    // vez) não joga a arma de lado
    const swayK = (1 - inp.ads * 0.85) * mo;
    const lx = clamp(inp.lookX, LOOK_MAX);
    const ly = clamp(inp.lookY, LOOK_MAX);
    this.swayX = clamp(this.swayX + (-lx * 0.9 * swayK - this.swayX) * k(14), SWAY_MAX);
    this.swayY = clamp(this.swayY + (ly * 0.9 * swayK - this.swayY) * k(14), SWAY_MAX);
    // passo: um oito, mais largo correndo
    const pace = inp.sprint ? (inp.tactical ? 15 : 12) : 8;
    if (inp.moving > 0.05 && !inp.airborne && !inp.slide) this.bob += dt * pace;
    // coice: as molas da arma, em passos pequenos (o mesmo pico a 30 e a 144 qps)
    this.adsNow = inp.ads;
    const vk = spec.recoil.vm;
    for (const s of [this.kBack, this.kRise, this.kRoll, this.kSide]) stepSpring(s, vk.k, vk.c, dt);
    this.joltV += (-this.jolt * 260 - this.joltV * 16) * dt;
    this.jolt += this.joltV * dt;

    // faca não mira (o botão direito dela é o golpe pesado)
    const knife = spec.cls === 'knife';
    const ads = knife ? 0 : ease(inp.ads);
    const kp = knife
      ? g.id === 'kukri'
        ? KUKRI_POSE
        : g.id === 'bayonet'
          ? BAY_POSE
          : g.id === 'bowie'
            ? BOWIE_POSE
            : g.id === 'kabar'
              ? KABAR_POSE
              : KNIFE_POSE[g.id === 'karambit' || g.id === 'balisong' ? g.id : 'bayonet']
      : null;
    const own = HIP_OWN[g.id];
    const hip = kp ? kp.pos : own ? own.pos : spec.cls === 'pistol' ? HIP_PISTOL : HIP_LONG;
    // mirando: a linha de mira passa pelo centro da tela, um pouco à frente do olho (na luneta, o olho na ocular)
    const eyeZ =
      spec.cls === 'pistol'
        ? -0.34
        : spec.scope
          ? -0.07
          : (g.adsEye ?? ADS_EYE[g.id] ?? (spec.cls === 'smg' ? -0.25 : -0.2));
    // o ponto da linha de mira já inclinado (`sightPitch`): sem isso, a linha da alça à massa passava 1–3 px fora do centro
    const sPitch = g.sightPitch ?? 0;
    const pc = Math.cos(sPitch);
    const ps = Math.sin(sPitch);
    AIM.set(-g.sight.x, -(g.sight.y * pc - g.sight.z * ps), eyeZ - (g.sight.y * ps + g.sight.z * pc));
    const pos = POS.copy(hip).lerp(AIM, ads);
    const rot = ROT.set(sPitch * ads, 0, 0, 'YXZ');
    // no quadril, o cano aponta um pouco para o centro da tela; a faca fica no giro dela
    if (kp) {
      rot.x += kp.rot[0];
      rot.y += kp.rot[1];
      rot.z += kp.rot[2];
    } else {
      rot.y += (own?.yaw ?? 0.06) * (1 - ads);
      rot.z += (own?.roll ?? -0.08) * (1 - ads);
      rot.x += (own?.pitch ?? (spec.cls === 'pistol' ? 0.05 : 0)) * (1 - ads);
    }
    const bobA = inp.moving * (1 - ads * 0.85) * (inp.crouch ? 0.6 : 1) * mo;
    pos.x += Math.sin(this.bob) * 0.012 * bobA;
    pos.y += Math.abs(Math.cos(this.bob)) * -0.012 * bobA;
    // respirar parado
    pos.y += Math.sin(now / 900) * 0.0025 * (1 - ads * 0.8) * mo;
    rot.y += this.swayX;
    rot.x += this.swayY;
    // mirando, a arma fica na linha do olho: os desvios de posição quase somem (a mira de trás fica a poucos cm do olho e
    // qualquer centímetro a mais tapa a tela); o desvio do tiro no ar vem do espalhamento, não da arma
    const steady = 1 - ads * 0.9;
    pos.x += this.swayX * 0.05 * steady;
    pos.y -= this.swayY * 0.05 * steady;
    // corrida: arma atravessada e baixa; corrida tática: arma para cima, cano para o alto
    const sp = this.sprintK * (1 - this.tacK);
    const kar = g.id === 'karambit';
    const bay = g.id === 'bayonet';
    RUN_E.set(0, 0, 0);
    if (bay) {
      // baioneta: correndo, o punho desce com a lâmina deitada para a frente e bombeia com o passo; na tática, o braço
      // dobra para perto do peito com a lâmina em pé
      const pump = Math.sin(this.bob) * mo;
      const s = BAY_RUN.sprint;
      const t = BAY_RUN.tac;
      pos.x += sp * s.px + this.tacK * t.px + pump * 0.012 * this.sprintK;
      pos.y += sp * s.py + this.tacK * t.py + Math.abs(Math.cos(this.bob)) * -0.014 * this.sprintK * mo;
      pos.z += sp * s.pz + this.tacK * t.pz - pump * 0.018 * this.sprintK;
      RUN_E.set(
        sp * s.ex + this.tacK * t.ex + pump * 0.1 * this.sprintK,
        sp * s.ey + this.tacK * t.ey,
        sp * s.ez + this.tacK * t.ez,
      );
    }
    if (kar) {
      // karambit: correndo, o punho desce e bombeia com o passo, a garra deitada para trás; na tática, o braço sobe
      // dobrado para perto do peito, a garra para baixo, e o bombeio fica mais largo
      const pump = Math.sin(this.bob) * mo;
      pos.x += sp * 0.01 + this.tacK * -0.02 + pump * 0.012 * this.sprintK;
      pos.y += sp * -0.05 + this.tacK * 0.005 + Math.abs(Math.cos(this.bob)) * -0.012 * this.sprintK * mo;
      pos.z += sp * 0.02 + this.tacK * 0.04 - pump * 0.015 * this.sprintK;
      RUN_E.set(
        sp * 0.35 + this.tacK * -0.25 + pump * 0.12 * this.sprintK,
        sp * 0.2 + this.tacK * -0.2,
        sp * -0.25 + this.tacK * 0.35,
      );
    }
    const kuk = g.id === 'kukri';
    if (kuk) kukriRun(pos, RUN_E, sp, this.tacK, this.sprintK, this.bob, mo);
    const bal = !!g.flip;
    if (bal) {
      // balisong: correndo, o punho desce e bombeia com o passo, a ponta para a frente e para baixo; na tática, o braço
      // sobe dobrado para perto do peito com a ponta para cima, e o bombeio fica mais largo
      const pump = Math.sin(this.bob) * mo;
      pos.x += sp * 0.01 + this.tacK * -0.03 + pump * 0.012 * this.sprintK;
      pos.y += sp * -0.05 + this.tacK * 0.04 + Math.abs(Math.cos(this.bob)) * -0.012 * this.sprintK * mo;
      pos.z += sp * 0.02 + this.tacK * 0.05 - pump * 0.015 * this.sprintK;
      RUN_E.set(
        sp * -0.4 + this.tacK * 0.4 + pump * 0.12 * this.sprintK,
        sp * 0.15 + this.tacK * -0.15,
        sp * -0.2 + this.tacK * 0.3,
      );
    }
    const bw = g.id === 'bowie';
    if (bw) {
      // bowie: correndo, o punho baixa e bombeia com o passo, a lâmina deitada para a frente e para o meio (a face à
      // vista); na tática, o braço sobe dobrado para perto do peito com a lâmina em pé, e o bombeio fica mais largo
      const pump = Math.sin(this.bob) * mo;
      pos.x += sp * -0.01 + this.tacK * -0.03 + pump * 0.012 * this.sprintK;
      pos.y += sp * -0.02 + this.tacK * 0.04 + Math.abs(Math.cos(this.bob)) * -0.014 * this.sprintK * mo;
      pos.z += sp * 0.02 + this.tacK * 0.06 - pump * 0.015 * this.sprintK;
      RUN_E.set(
        sp * 0.32 + this.tacK * 0.1 + pump * 0.1 * this.sprintK,
        sp * -0.09 + this.tacK * 0.25,
        sp * 0.3 + this.tacK * -0.3,
      );
    }
    // Ka-Bar: correndo, a faca desce e aponta para a frente e para a esquerda, bombeando com o passo; na tática, o braço
    // sobe dobrado para perto do peito com a lâmina em pé (os giros em `KABAR_RUN`)
    const kb = g.id === 'kabar';
    if (kb) {
      const pump = Math.sin(this.bob) * mo;
      const R = KABAR_RUN;
      pos.x += sp * R.sprintPos[0] + this.tacK * R.tacPos[0] + pump * 0.012 * this.sprintK;
      pos.y +=
        sp * R.sprintPos[1] + this.tacK * R.tacPos[1] + Math.abs(Math.cos(this.bob)) * -0.012 * this.sprintK * mo;
      pos.z += sp * R.sprintPos[2] + this.tacK * R.tacPos[2] - pump * 0.015 * this.sprintK;
      RUN_E.set(
        sp * R.sprint[0] + this.tacK * R.tac[0] + pump * 0.1 * this.sprintK,
        sp * R.sprint[1] + this.tacK * R.tac[1],
        sp * R.sprint[2] + this.tacK * R.tac[2],
      );
    }
    if (!kar && !bay && !kuk && !bal && !bw && !kb) {
      pos.x += sp * -0.03;
      pos.y += sp * -0.05;
      rot.y += sp * 0.65;
      rot.z += sp * 0.35;
      rot.x += sp * -0.15 + Math.sin(this.bob * 2) * 0.03 * this.sprintK * mo;
      // tática: a arma vai mais para a direita com o cano virado para dentro (a mão esquerda solta, ver abaixo)
      pos.y += this.tacK * 0.04;
      pos.x += this.tacK * 0.06;
      rot.x += this.tacK * 0.9;
      rot.z += this.tacK * 0.5;
      rot.y += this.tacK * 0.25;
    }
    // deslizando: a arma inclina; no ar, sobe um pouco
    rot.z += this.slideK * 0.45 * mo * steady;
    pos.y += (this.slideK * 0.02 + this.airK * 0.015) * steady;
    // tranco dos encaixes
    rot.x += this.jolt * 0.035 * mo * (1 - ads * 0.6);
    pos.y += this.jolt * 0.004 * steady;
    // coice: para trás (sem chegar na câmera), o cano sobe, rola e vai para o lado
    pos.z = Math.min(pos.z + this.kBack.x, Math.max(pos.z, KICK_Z_MAX));
    rot.x += this.kRise.x;
    rot.z += this.kRoll.x;
    rot.y += this.kSide.x;
    // peças: ferrolho (e o da pistola) indo e voltando, pente, alavanca, lâmina, gatilho
    let boltBack = 0;
    let boltRot = 0;
    let chargeBack = 0;
    let chargeRot = 0;
    /** faca: giro dela na mão (rad, no `spinAxis`) e o quanto os dedos soltam (0–1); o resto da faca fica em `KD` */
    let spin = 0;
    let open = 0;
    resetKD();
    let trig = 0;
    /** deslocamento do pente (espaço da arma) */
    MAG.set(0, 0, 0);
    // mãos: onde seguram (a animação puxa para outro ponto e devolve)
    GRIP_R.copy(this.rightAt);
    /** a mão direita vai até a alavanca do ferrolho (0 no punho, 1 na alavanca) e, na Kar98k, até o pente-lâmina */
    let rightK = 0;
    /** Kar98k: a direita vai na cartucheira (0–1) e no pente-lâmina, em cima da janela (0–1) */
    let rightPouch = 0;
    let clipK = 0;
    let clipNow: typeof CP | null = null;
    /** recarga: o pente desce (`MAG`) e vai até o colete (`magPouch`); a mão segue o pente (`magHold`) numa pose que
     * pode estar à frente dele (`handOut`/`handPouch`: no vazio ela já foi ao colete antes do pente velho cair) e solta
     * os dedos no fim do encaixe, empurrando a base com a palma (`magPalm`) */
    let magPouch = 0;
    let handOut = 0;
    let handPouch = 0;
    let magPalm = 0;
    let magPull = MAG_PULL;
    /** revólver: o giro do tambor aberto (rad) */
    let cylSpin = 0;
    /** AK: o quanto o pente (e a mão nele) saiu, para o giro na trava; −1 fora da recarga */
    let akMag = -1;
    let akHand = 0;
    let rightCurl = this.rightCurl[0];
    let rightThumb = this.rightCurl[1];
    // o indicador fica no gatilho; correndo, na tática, recarregando ou inspecionando, esticado sobre a armação
    const offTrigger = Math.max(this.sprintK, this.tacK);
    // fora do gatilho, o fechamento medido em que o indicador fica sobre a armação sem entrar nela
    const trigOff = this.holds?.trigOff ?? TRIGGER_OFF;
    let rightIndex = lerp(this.rightCurl[2], trigOff, knife ? 0 : offTrigger);
    LEFT.copy(this.leftAt);
    let leftCurl = this.leftCurl[0];
    let leftThumb = this.leftCurl[1];
    /** a mão esquerda segura o pente (segue a peça de verdade, depois de mexer nela) */
    let magHold = 0;
    /** a mão esquerda vira para outro giro (`altQ`: pela lateral ou por cima) e o ombro abre para fora */
    let leftAlt = 0;
    let altQ: THREE.Quaternion = SIDE_Q;
    let shoulderOut = 0;
    /** a mão esquerda solta a arma e desce para fora da tela (0–1): corrida tática e inspeção da pistola */
    let leftAway = ease(this.leftOffK);
    /** a mão esquerda no ar entre o apoio e o pente (0–1, o pico do arco) */
    let leftTransit = 0;
    /** quanto os dedos já têm a forma da pegada do pente (atrasado em relação a `magHold`) */
    let magFit = 0;
    /** revólver: a fração da recarga (para o carregador rápido e os cartuchos do tambor); −1 fora dela */
    let cylU = -1;
    /** BFR: a fração da recarga (−1 fora dela) e o gesto do polegar no cão feito pela ação deste quadro */
    let bfrRl = -1;
    let bfrGesture = false;
    let bfrCockSpin = false;
    /** Rhino: a mão esquerda bate na vareta do extrator (0–1) e, na inspeção, dá o peteleco no tambor (0–1) */
    let rhinoRod = 0;
    let rhinoFlick = 0;

    // o deslocamento desta ação é medido em volta do switch (para o `carry` de uma ação cortada)
    const p0x = pos.x;
    const p0y = pos.y;
    const p0z = pos.z;
    const r0x = rot.x;
    const r0y = rot.y;
    const r0z = rot.z;
    const a = this.action;
    if (a) {
      a.t += dt * 1000;
      const u = Math.min(1, a.t / a.ms);
      const joltAt = (key: string, at: number, v: number) => {
        if (u >= at && !this.joltDone.has(key)) {
          this.joltDone.add(key);
          this.joltV += v;
        }
      };
      if (a.kind !== 'fire' && a.kind !== 'draw' && !knife)
        rightIndex = lerp(rightIndex, trigOff, hump(u, 0, 0.1, 0.9, 1));
      switch (a.kind) {
        case 'draw': {
          if (knife) {
            this.knifeDraw(u, mo, pos, rot, joltAt);
            break;
          }
          // vem de baixo e da direita girando (o cano sobe por último), passa um pouco do ponto e assenta. A mão de
          // apoio chega depois da arma: vem aberta de baixo e bate no guarda-mão (tranco), e só então os dedos fecham
          const w = 1 - expOut(seg(u, 0, 0.85));
          const over = Math.sin(seg(u, 0.55, 1) * Math.PI) * (1 - seg(u, 0.55, 1));
          pos.y -= 0.25 * w;
          pos.x += 0.06 * w;
          rot.x -= 0.9 * w * mo;
          rot.z += 0.3 * w * mo;
          rot.y += 0.35 * w * mo;
          rot.x += 0.05 * over * mo;
          // M9 e Desert Eagle: a direita saca sozinha e a esquerda vem de baixo e fecha por fora dela, com o tranco do
          // encaixe
          if (spec.cls !== 'pistol' || LATE_SUPPORT.has(g.id)) {
            const arrive = ease(seg(u, 0.3, 0.62));
            leftAway = Math.max(leftAway, 1 - arrive);
            leftCurl = lerp(0.2, leftCurl, ease(seg(u, 0.6, 0.78)));
            leftThumb = lerp(0.2, leftThumb, ease(seg(u, 0.6, 0.78)));
            joltAt('slap', 0.62, 1.1);
          }
          joltAt('end', 0.8, 1.6);
          // BFR: o polegar arma o cão enquanto a arma chega (o tambor gira um furo)
          if (this.bfrHam) {
            const ms = (u - 0.28) * a.ms * 1.35;
            if (ms >= 0) cockAt(ms, false, CK);
            else CK.reach = CK.ham = 0;
            bfrGesture = bfrCockSpin = true;
          }
          break;
        }
        case 'fire':
          if (spec.cls !== 'sniper') boltBack = Math.sin(Math.min(1, u * 1.2) * Math.PI) * 0.035;
          // o indicador aperta e o gatilho vai para trás (~60 ms)
          trig = hump(u, 0, 0.12, 0.4, 0.6);
          rightIndex = lerp(rightIndex, this.rightCurl[2] + TRIGGER_SQUEEZE, trig);
          break;
        case 'reload':
        case 'reloadEmpty': {
          // recarga de verdade (`reload.ts`): com bala, o pente velho vai para o colete e a mão volta com um cheio;
          // vazia (e sempre na pistola) o velho cai e a mão já vai buscar o novo; encaixa com um tranco e (vazia) o
          // gesto da arma solta o ferrolho. A arma sobe e inclina para o pente e a mão ficarem na tela
          const empty = a.kind === 'reloadEmpty';
          const pistol = spec.cls === 'pistol';
          if (this.bfrHam && g.parts.mag) {
            // BFR (`bfr.ts`): desarma, abre o tambor no braço, cano para cima e a vareta (os estojos caem), cano
            // para baixo, carregador rápido do cinto alinhado e empurrado, larga o vazio, fecha e arma o cão
            const br = bfrReload(u, BR);
            pos.x += br.px;
            pos.y += br.py;
            pos.z += br.pz;
            rot.x += br.rx;
            rot.y += br.ry * mo;
            rot.z += br.rz * mo;
            joltAt('out', 0.2, -1.2);
            joltAt('rod', BFR_DUMP_AT, -1.4);
            joltAt('seat', BFR_SEAT_AT, 1.6);
            joltAt('close', BFR_CLOSE_AT, 2.4);
            if (u >= BFR_DUMP_AT && !this.joltDone.has('dump')) {
              this.joltDone.add('dump');
              this.dumpAfter = true;
            }
            bfrRl = u;
            craneOffset(this.loaderSeat, br.out, MAG);
            if (this.bfrArm) placeCraneArm(this.bfrArm, this.loaderSeat, MAG, this.bfrFront, br.out);
            cylSpin = br.spin;
            const dms = u * a.ms * BFR_RL_DECOCK.speed;
            const cms = (u - BFR_RL_COCK.at) * a.ms * BFR_RL_COCK.speed;
            if (this.bfrFrom > 0.5 && dms < COCK_MS) cockAt(dms, true, CK);
            else if (cms >= 0) {
              cockAt(cms, false, CK);
              bfrCockSpin = true;
            } else CK.reach = CK.ham = 0;
            bfrGesture = true;
            break;
          }
          if (spec.revolver) {
            // revólver (`cylinderPose`): a arma deita para a direita e mostra o tambor aberto; a esquerda segura por
            // baixo dele, busca o carregador rápido no cinto, empurra os cartuchos e o tambor fecha
            const cp = cylinderPose(u, CY);
            // deitada o bastante para o tambor aberto aparecer (mais que isso, a arma rolava demais)
            rot.z -= cp.tilt * 0.5 * mo;
            rot.x += cp.tilt * 0.4;
            pos.y += cp.tilt * 0.09;
            pos.x -= cp.tilt * 0.03;
            joltAt('out', MAG_OUT_AT + 0.02, -1.2);
            joltAt('seat', MAG_SEAT_AT, 1.6);
            joltAt('close', CYL_CLOSE_AT, 2.4);
            // com o tambor aberto, o polegar empurra a vareta: os estojos vazios caem de uma vez
            if (u >= CYL_DUMP_AT && !this.joltDone.has('dump')) {
              this.joltDone.add('dump');
              this.dumpAfter = true;
            }
            cylU = u;
            if (g.id === 'rhino') {
              // Rhino: a boca sobe quando a mão bate na vareta (os estojos caem) e desce para o carregador rápido entrar
              // de cima, com os furos do tambor virados para a câmera
              const flip = hump(u, 0.17, 0.23, 0.28, 0.36);
              const down = hump(u, 0.3, 0.44, 0.72, 0.84);
              rot.x += (0.3 * flip - 0.6 * down) * mo;
              rot.y += 0.4 * down * mo;
              pos.y -= 0.03 * down;
              pos.z -= 0.03 * down;
              rhinoRod = hump(u, 0.21, 0.245, 0.26, 0.3);
              joltAt('rod', 0.245, -0.8);
            }
            magPull = CYL_OUT;
            MAG.copy(CYL_OUT).multiplyScalar(cp.out);
            cylSpin = cp.spin;
            magHold = cp.hold;
            handOut = cp.out;
            handPouch = cp.pouch;
            // Rhino: os dedos ficam no carregador rápido (`rhinoLoader`); aberta, a mão abanava embaixo da arma
            magPalm = g.id === 'rhino' ? 0 : cp.palm;
            break;
          }
          // a MP7 e a MSMC têm o pente no punho, como a pistola: ele cai e o novo entra por baixo
          const gripMag = GRIP_MAG.has(g.id);
          const rp = reloadPose(reloadStyle(empty, pistol || (gripMag && !GRIP_MAG_TACTICAL.has(g.id))), u, RP);
          if (g.id === 'deagle') {
            // Desert Eagle: o polegar direito aperta o retém do pente (atrás do guarda-mato) antes de ele cair; a palma
            // bate na base e a mão volta logo para o apoio, perto do punho (no caminho comum ela abria e ficava ~0,1 s
            // parada no ar à esquerda, fora da arma)
            rightThumb += 0.3 * hump(u, 0.1, 0.15, 0.18, 0.24);
            rp.palm = hump(u, 0.54, 0.58, 0.6, 0.64);
            if (u > MAG_SEAT_AT) rp.hold = 1 - ease(seg(u, MAG_SEAT_AT, 0.7));
          }
          rot.z -= rp.tilt * 0.55 * mo;
          rot.x += rp.tilt * (pistol ? 0.45 : 0.3);
          pos.y += rp.tilt * (pistol ? 0.1 : 0.06);
          pos.x -= rp.tilt * 0.03;
          // pente no punho (MSMC): o fundo do punho ficava na beirada de baixo da tela e a troca acontecia fora dela; a
          // arma sobe e vem para o meio, e o pente entrando por baixo aparece. Vazia, ela já volta logo depois do
          // encaixe (`back`): a alavanca fica na frente, em cima da empunhadura, e com a arma deitada o braço esquerdo
          // subia esticado atravessando a tela
          const lift = GRIP_MAG_LIFT[g.id];
          if (lift) {
            const back = empty ? rp.tilt * ease(seg(u, 0.57, 0.72)) : 0;
            const t = rp.tilt - back;
            rot.z += back * 0.55 * mo;
            rot.x += t * lift[3] - back * 0.3;
            pos.x += t * lift[0] + back * 0.03;
            pos.y += t * lift[1] - back * 0.06;
            pos.z += t * lift[2];
          }
          joltAt('out', MAG_OUT_AT + 0.02, -1.2);
          joltAt('seat', MAG_SEAT_AT, 2.4);
          magPull = pistol ? MAG_PULL_PISTOL : MAG_PULL;
          MAG.copy(magPull).multiplyScalar(rp.out);
          magPouch = rp.pouch;
          magHold = rp.hold;
          // no `drop`, a mão sobe junto com o pente novo e a palma empurra a base até o fim (`reloadPose`)
          handOut = rp.handOut;
          handPouch = rp.handPouch;
          magPalm = rp.palm;
          if (g.id === 'm9') {
            // M9: o polegar da direita aperta o retém do pente, atrás do guarda-mato, logo antes de ele cair
            rightThumb += 0.3 * hump(u, 0.08, 0.13, 0.19, 0.26);
          }
          if (g.id === 'ak47') {
            // AK: o pente sai e entra girando na trava da frente (`akRock`); a mão anda com ele também no vazio
            akMag = rp.out;
            akHand = handOut;
            magPull = AK_PULL;
            MAG.copy(magPull).multiplyScalar(akSlide(rp.out));
          }
          // o pente velho cai (cópia sem cartuchos, do lugar dele): o da arma já está no colete, fora da tela
          if (rp.dropped && !this.joltDone.has('drop')) {
            this.joltDone.add('drop');
            const mag = g.parts.mag;
            if (this.magGhost && mag) {
              const ghost = this.magGhost;
              this.holder.updateMatrixWorld(true);
              M2.compose(ghost.position, ghost.quaternion, ghost.scale).premultiply(this.holder.matrixWorld);
              // AK: o vazio cai girando a base para a frente (como sai da trava da frente)
              if (g.id === 'ak47') this.toss(ghost.clone(), M2, V.set(-0.08, -0.3, -0.06), W1.set(0.8, 0, 0.6));
              else this.toss(ghost.clone(), M2, V.set(-0.1, -0.35, 0.05), W1.set(-1.2, 0, 1.6));
            }
          }
          if (empty) this.emptyGesture(u, joltAt);
          // o polegar soltou o retém: o ferrolho fecha (o gesto `pistol` segura ele aberto até aqui)
          if (empty && u >= 0.8) this.slideHeld = false;
          // M200 vazia: no ferrolho do fim, a arma deita para a esquerda como no ferrolho do tiro (a alavanca fica à
          // vista, em vez de escondida pela inclinação da recarga)
          if (empty && g.id === 'm200') m200Pose(M200_BOLT, seg(u, 0.62, 0.98), mo, pos, rot);
          // MP5: com a mão na alavanca, a pose do vazio (que leva a mão ao colete) espera ela soltar; e a arma desfaz a
          // inclinação da recarga (de lado, a alavanca subia para o alto da tela e o braço atravessava a vista) e chega
          // um pouco mais perto (`mp5.ts`)
          if (empty && g.id === 'mp5') magHold *= 1 - EG.alt;
          if (empty && EG.present > 0) {
            const k = rp.tilt * EG.present;
            rot.z += (k * 0.55 + HK_PRESENT_ROLL * EG.present) * mo;
            rot.x -= k * 0.3;
            pos.y -= k * 0.06;
            pos.x += k * 0.03;
            pos.addScaledVector(HK_PRESENT_POS, EG.present);
          }
          // AK: para puxar a alavanca, a arma rola para a direita e mostra o lado dela (inclinada para o pente, a
          // alavanca e a mão ficavam escondidas atrás da caixa)
          if (empty && g.id === 'ak47') {
            rot.z += EG.rightK * 0.85 * mo;
            rot.x -= EG.rightK * 0.12 * mo;
            pos.x += EG.rightK * 0.02;
          }
          // StG 44: no puxão da alavanca, a arma rola para a direita (a lateral esquerda, com a alavanca e a mão em
          // gancho, vira para a câmera) e vem um pouco para o meio
          if (empty && g.id === 'stg44') {
            const k = hump(u, 0.6, 0.69, 0.8, 0.9);
            rot.z -= k * HOOK_ROLL * mo;
            pos.x -= k * 0.03;
            pos.y -= k * 0.03;
          }
          break;
        }
        case 'reloadClip': {
          // pente-lâmina (Kar98k), tudo com a mão direita (a esquerda fica no guarda-mão): abre o ferrolho, vai na
          // cartucheira, volta com o pente-lâmina e encaixa no guia em cima da janela, o polegar empurra as balas duas
          // vezes, volta à alavanca e fecha o ferrolho (que joga a lâmina vazia fora) e volta ao delgado
          const cp = clipPose(u, CP);
          // a arma deita um pouco para a direita (o topo da janela aberta para o olho) e vem para o meio e mais perto
          rot.z -= cp.tilt * 0.3 * mo;
          rot.x += cp.tilt * 0.15;
          pos.y += cp.tilt * 0.04;
          pos.x -= cp.tilt * 0.03;
          pos.z += cp.tilt * 0.03;
          boltRot = cp.lift * 1.2;
          boltBack = cp.back * 0.09;
          rightK = cp.handle;
          rightPouch = cp.pouch;
          clipK = cp.clip;
          clipNow = cp;
          rightCurl = lerp(rightCurl, PINCH[0], rightK);
          rightThumb = lerp(rightThumb, PINCH[1], rightK);
          rightIndex = lerp(rightIndex, PINCH[2], rightK);
          // no pente-lâmina: os dedos meio fechados na lateral da caixa, o polegar por cima das balas, dobrando mais a
          // cada empurrão
          rightCurl = lerp(rightCurl, CLIP_CURL[0], clipK);
          rightIndex = lerp(rightIndex, CLIP_CURL[2], clipK);
          rightThumb = lerp(rightThumb, CLIP_CURL[1] + cp.press * 0.3, clipK);
          joltAt('open', 0.24, -1);
          joltAt('press1', 0.46, 1.2);
          joltAt('press2', 0.58, 1.2);
          joltAt('close', 0.8, 1.8);
          // o ferrolho indo para a frente empurra a lâmina vazia para fora (sobe e vai para a direita)
          if (cp.tossed && !this.joltDone.has('toss') && this.clip) {
            this.joltDone.add('toss');
            const empty = this.clip.root.clone();
            empty.children.forEach((c, i) => (c.visible = i === 0));
            this.clip.root.updateMatrixWorld(true);
            this.toss(empty, this.clip.root.matrixWorld, V.set(0.9, 1.6, 0.25), W1.set(4, 2, 7));
          }
          break;
        }
        case 'bolt': {
          // sniper: abaixa um pouco; a mão direita sai do punho, pega a alavanca, gira, puxa (o estojo sai), empurra,
          // gira de volta e volta para o punho
          if (g.id === 'm200') m200Pose(M200_BOLT, u, mo, pos, rot);
          else {
            const w = hump(u, 0, 0.12, 0.85, 1);
            pos.y -= w * 0.02;
            if (g.id === 'kar98k') {
              // Kar98k: a arma rola com a direita para cima e vem um pouco para o meio, o ferrolho de frente para o
              // olho (rolando para o outro lado, a alavanca e a mão sumiam atrás da caixa)
              rot.z += w * 0.25 * mo;
              pos.x -= w * 0.02;
            } else rot.z -= w * 0.15 * mo;
            // L115: a arma vem um pouco para a esquerda e deita mais (com o ferrolho atrás, a mão saía da tela pela
            // direita)
            if (g.id === 'l115') {
              pos.x -= w * 0.035;
              pos.y -= w * 0.01;
              rot.z -= w * 0.08 * mo;
            }
          }
          boltRot = hump(u, 0.12, 0.28, 0.66, 0.8) * 1.2;
          boltBack = hump(u, 0.28, 0.45, 0.48, 0.66) * 0.09;
          joltAt('back', 0.45, -1);
          joltAt('close', 0.8, 1.8);
          if (u >= 0.42 && !this.joltDone.has('eject')) {
            this.joltDone.add('eject');
            this.ejectAfter = true;
          }
          rightK = hump(u, 0.02, 0.12, 0.8, 0.95);
          rightCurl = lerp(rightCurl, PINCH[0], rightK);
          rightThumb = lerp(rightThumb, PINCH[1], rightK);
          rightIndex = lerp(rightIndex, PINCH[2], rightK);
          break;
        }
        case 'melee': {
          if (knife) {
            this.knifeSlash(u, a.side, mo, pos, rot, joltAt);
          } else if (g.id === 'stg44') {
            // StG 44: arma recua e cai um pouco para a direita (antecipação), sai rápida para a frente e para a esquerda
            // rolando a coronha para o alvo (acerto a ~32%, com tranco), segura um instante e volta devagar
            const pre = hump(u, 0, 0.16, 0.16, 0.3);
            const hit = ease(seg(u, 0.14, 0.32)) * (1 - ease(seg(u, 0.42, 0.95)));
            pos.z += 0.03 * pre - 0.17 * hit;
            pos.x += 0.02 * pre - 0.09 * hit;
            pos.y += 0.01 * pre - 0.01 * hit;
            rot.z += (-0.15 * pre + 0.7 * hit) * mo;
            rot.x += (0.1 * pre - 0.05 * hit) * mo;
            rot.y += 0.12 * hit * mo;
            joltAt('hit', 0.32, -1.4);
          } else if (g.id === 'm4') {
            m4Bash(u, mo, pos, rot, joltAt);
          } else if (g.id === 'automag3') {
            // Automag III: coronhada com a lateral da arma — recua e sobe para a direita com o pulso armado
            // (antecipação), desce rápida para a frente e para a esquerda rolando a arma (acerto a ~34%, com tranco),
            // segura um instante e volta devagar
            const pre = hump(u, 0, 0.16, 0.16, 0.3);
            const hit = ease(seg(u, 0.15, 0.34)) * (1 - ease(seg(u, 0.46, 0.95)));
            pos.z += 0.04 * pre - 0.15 * hit;
            pos.x += 0.03 * pre - 0.09 * hit;
            pos.y += 0.03 * pre - 0.02 * hit;
            rot.x += (0.25 * pre - 0.2 * hit) * mo;
            rot.y += (-0.15 * pre + 0.2 * hit) * mo;
            rot.z += (-0.2 * pre + 0.75 * hit) * mo;
            joltAt('hit', 0.34, -1.4);
          } else if (g.id === 'scarl') {
            scarBash(u, mo, pos, rot);
            joltAt('hit', 0.32, -1.6);
          } else if (g.id === 'm9') {
            this.pistolBash(u, mo, pos, rot, joltAt);
          } else if (g.id === 'msmc') {
            // MSMC: arma o golpe (recua e vai um pouco para a direita, ~80 ms), bate para a frente e para a esquerda
            // girando (tranco no acerto, em 30%), passa um pouco do ponto e volta devagar (antes ia e ficava parada no
            // fim, sem antecipação nem acerto)
            const ant = hump(u, 0, 0.16, 0.16, 0.3);
            const hit = expOut(seg(u, 0.16, 0.3)) * (1 - ease(seg(u, 0.42, 1)));
            const over = hump(u, 0.28, 0.36, 0.36, 0.52);
            pos.z += 0.035 * ant - 0.14 * hit - 0.012 * over;
            pos.x += 0.02 * ant - 0.05 * hit;
            pos.y += -0.012 * ant + 0.02 * hit;
            rot.z += (-0.15 * ant + 0.55 * hit + 0.05 * over) * mo;
            rot.y += (0.1 * ant - 0.1 * hit) * mo;
            rot.x += (0.06 * ant - 0.04 * hit) * mo;
            joltAt('hit', 0.3, 1.8);
          } else if (g.id === 'm200') {
            m200Pose(M200_BASH, u, mo, pos, rot);
            joltAt('hit', 0.32, 1.6);
          } else if (g.id === 'ballista') {
            // FN Ballista: arma o golpe (recua, o cano vai para a direita), varre a arma para a frente e para a esquerda
            // com a lateral direita na frente (o acerto do jogo é aos 160 ms, ~32%), dá o tranco e volta passando um
            // pouco do ponto (empurrada para a frente, a coronha comprida enchia a tela)
            const pre = hump(u, 0, 0.16, 0.18, 0.3);
            const hit = ease(seg(u, 0.18, 0.32)) * (1 - ease(seg(u, 0.42, 0.92)));
            const back = Math.sin(seg(u, 0.85, 1) * Math.PI) * (1 - seg(u, 0.85, 1));
            pos.z += 0.03 * pre - 0.1 * hit;
            pos.x += 0.03 * pre - 0.08 * hit;
            pos.y += -0.01 * pre + 0.01 * hit;
            rot.z += (-0.1 * pre + 0.3 * hit) * mo;
            rot.y += (-0.22 * pre + 0.5 * hit) * mo;
            rot.x += (0.06 * pre - 0.05 * hit + 0.03 * back) * mo;
            joltAt('hit', 0.32, 1.6);
          } else if (g.id === 'mpx') {
            this.mpxMelee(u, mo, pos, rot, joltAt);
          } else if (g.id === 'deagle') {
            leftAway = Math.max(leftAway, this.deagleBash(u, mo, pos, rot, joltAt));
          } else if (g.id === 'l115') {
            // L115: antecipação (a arma recua e vira um pouco para fora), a estocada sai rápida para a frente e para o
            // lado, o tranco do impacto e a volta devagar (o golpe comum ia e voltava em rampa, sem peso)
            const wind = hump(u, 0, 0.16, 0.18, 0.3);
            const thrust = expOut(seg(u, 0.18, 0.34)) * (1 - ease(seg(u, 0.5, 1)));
            pos.z += 0.035 * wind - 0.16 * thrust;
            pos.x += 0.02 * wind - 0.08 * thrust;
            pos.y += 0.01 * wind - 0.01 * thrust;
            rot.z += (-0.12 * wind + 0.6 * thrust) * mo;
            rot.x += (0.08 * wind - 0.05 * thrust) * mo;
            joltAt('hit', 0.34, 1.6);
          } else if (this.bfrHam) {
            // BFR: coronhada com antecipação e arco (`BFR_MELEE`); a esquerda sai do caminho
            const m = bfrMove(BFR_MELEE, u, BM);
            pos.x += m.px;
            pos.y += m.py;
            pos.z += m.pz;
            rot.x += m.rx * mo;
            rot.y += m.ry * mo;
            rot.z += m.rz * mo;
            leftAway = Math.max(leftAway, m.away);
            joltAt('hit', 0.32, 2.4);
          } else if (g.id === 'ak47') {
            this.akMelee(u, mo, pos, rot, joltAt);
          } else if (g.id === 'rhino') {
            // Rhino: coronhada de revólver com uma mão só (a esquerda solta antes): antecipação puxando a arma para trás
            // e para a direita com a boca para cima, o golpe rápido para a frente, para a esquerda e para baixo com a
            // armação na frente, um tranco no impacto e a volta devagar
            const wind = hump(u, 0, 0.18, 0.2, 0.32);
            const hit = hump(u, 0.18, 0.32, 0.45, 0.95);
            pos.x += 0.03 * wind - 0.08 * hit;
            pos.y += 0.02 * wind - 0.03 * hit;
            pos.z += 0.04 * wind - 0.14 * hit;
            rot.x += (0.35 * wind - 0.3 * hit) * mo;
            rot.y += (0.3 * hit - 0.15 * wind) * mo;
            rot.z += (0.4 * hit - 0.2 * wind) * mo;
            leftAway = Math.max(leftAway, hump(u, 0.02, 0.15, 0.6, 0.9));
            joltAt('hit', 0.32, 1.5);
          } else {
            // MP5: estocada inclinada para a esquerda, a coronha comprida fora da tela (`mp5.ts`)
            if (g.id === 'mp5') {
              mp5Play(MP5_BASH, u, mo, pos, rot);
              joltAt('hit', MP5_BASH_HIT, 1.6);
              break;
            }
            // a coronhada comum das armas longas: antecipação, golpe rolando, tranco e volta assentando (`gunBash`)
            if (g.id !== 'rs9') {
              gunBash(u, mo, pos, rot, joltAt);
              break;
            }
            // RS9 (a dela, de antes da comum): recolhe a arma para trás e para a direita (antecipação) e só então empurra
            const w = hump(u, 0.12, 0.3, 0.5, 1);
            pos.z -= 0.15 * w;
            pos.x -= 0.08 * w;
            rot.z += 0.6 * w * mo;
            const pre = hump(u, 0, 0.1, 0.12, 0.26);
            pos.z += 0.035 * pre;
            pos.x += 0.015 * pre;
            rot.z -= 0.12 * pre * mo;
            rot.x += 0.05 * pre * mo;
          }
          break;
        }
        case 'heavy': {
          this.knifeStab(u, mo, pos, rot, joltAt);
          break;
        }
        case 'inspect': {
          if (knife) {
            this.knifeInspect(u, mo, pos, rot, joltAt);
            break;
          }
          if (g.id === 'm4') {
            magHold = Math.max(magHold, m4Inspect(u, mo, pos, rot, MAG, joltAt));
            break;
          }
          if (g.id === 'scarl') {
            // SCAR-L: a esquerda vai ao pente no segundo lado e volta ao guarda-mão antes de a arma assentar
            const grab = scarInspect(u, mo, pos, rot);
            if (this.holds?.mag) magHold = Math.max(magHold, grab);
            joltAt('grab', 0.56, 0.8);
            joltAt('show', 0.22, 0.5);
            break;
          }
          if (g.id === 'm200') {
            m200Pose(M200_INSPECT, u, mo, pos, rot);
            joltAt('turn', 0.6, 0.6);
            break;
          }
          // MP5: rola mostrando um lado e o outro, a esquerda confere o pente (`mp5.ts`)
          if (g.id === 'mp5') {
            const m = mp5Play(MP5_INSPECT, u, mo, pos, rot);
            if (this.holds?.mag) magHold = Math.max(magHold, m);
            joltAt('faceA', 0.2, 0.8);
            joltAt('faceB', 0.56, 0.8);
            joltAt('grab', 0.58, 0.8);
            joltAt('end', 0.92, 1);
            break;
          }
          if (g.id === 'mpx') {
            magHold = Math.max(magHold, this.mpxInspect(u, mo, pos, rot, joltAt));
            break;
          }
          if (g.id === 'deagle') {
            leftAway = Math.max(leftAway, this.deagleInspect(u, mo, pos, rot, joltAt));
            break;
          }
          if (this.bfrHam) {
            // BFR: o lado esquerdo (tambor) sem a mão na frente, depois o direito e o topo (`BFR_INSPECT`)
            const m = bfrMove(BFR_INSPECT, u, BM);
            pos.x += m.px;
            pos.y += m.py;
            pos.z += m.pz;
            rot.x += m.rx * mo;
            rot.y += m.ry * mo;
            rot.z += m.rz * mo;
            leftAway = Math.max(leftAway, m.away);
            joltAt('stop1', 0.22, 0.6);
            joltAt('stop2', 0.6, 0.6);
            break;
          }
          if (g.id === 'kar98k') {
            // Kar98k (comprida: virando 1 rad de lado, como as outras, a coronha atravessava meia tela perto da
            // câmera): mostra o ferrolho de perto e a mão confere a câmara (levanta a alavanca, puxa um pouco e fecha),
            // depois rola para o outro lado e mostra a esquerda; volta passando um pouco do ponto
            const pre = hump(u, 0, 0.04, 0.05, 0.12);
            const s1 = hump(u, 0.06, 0.2, 0.46, 0.58);
            const s2 = hump(u, 0.52, 0.64, 0.78, 0.9);
            const settle = Math.sin(seg(u, 0.88, 1) * Math.PI) * (1 - seg(u, 0.88, 1));
            // o primeiro lado: o cano sobe (a coronha desce para fora da tela) e a arma rola com a direita para cima
            rot.y += pre * 0.06 * mo + s1 * 0.15 * mo + s2 * 0.15 * mo;
            rot.z += s1 * 0.5 * mo - s2 * 0.55 * mo;
            rot.x += s1 * 0.25 * mo + s2 * 0.1 * mo - settle * 0.04 * mo;
            pos.x -= s1 * 0.06 + s2 * 0.03;
            pos.y += s2 * 0.03;
            pos.z += s1 * 0.08;
            rightK = hump(u, 0.16, 0.24, 0.42, 0.5);
            boltRot = hump(u, 0.24, 0.29, 0.36, 0.41) * 1.2;
            boltBack = hump(u, 0.28, 0.31, 0.33, 0.36) * 0.035;
            rightCurl = lerp(rightCurl, PINCH[0], rightK);
            rightThumb = lerp(rightThumb, PINCH[1], rightK);
            rightIndex = lerp(rightIndex, PINCH[2], rightK);
            joltAt('check', 0.31, -0.5);
            joltAt('shut', 0.41, 0.8);
            break;
          }
          if (g.id === 'rhino') {
            // Rhino: a arma deita e vira como na recarga (o tambor para a câmera); a esquerda abre o tambor segurando por
            // baixo, os dedos dão um peteleco e ele gira sozinho, perdendo a força; a mão o fecha com um tranco, solta, e
            // a arma rola para mostrar o lado direito e o topo antes de voltar, passando um pouco do ponto
            const a = hump(u, 0.04, 0.18, 0.6, 0.72);
            const pre = hump(u, 0, 0.05, 0.06, 0.14);
            const side2 = hump(u, 0.64, 0.74, 0.84, 0.94);
            const settle = Math.sin(seg(u, 0.92, 1) * Math.PI) * (1 - seg(u, 0.92, 1));
            rot.y += (0.08 * pre + 0.4 * a - 0.25 * side2) * mo;
            rot.z -= (0.5 * a + 0.45 * side2) * mo;
            rot.x += (-0.1 * a + 0.3 * side2 - 0.04 * settle) * mo;
            pos.x += 0.02 * side2 - 0.03 * a;
            pos.y += 0.06 * a + 0.015 * side2;
            pos.z -= 0.03 * a + 0.03 * side2;
            const open = ease(seg(u, 0.16, 0.24)) * (1 - ease(seg(u, 0.54, 0.6)));
            magPull = CYL_OUT;
            MAG.copy(CYL_OUT).multiplyScalar(open);
            handOut = open;
            magHold = ease(seg(u, 0.06, 0.18)) * (1 - ease(seg(u, 0.6, 0.68)));
            rhinoFlick = hump(u, 0.26, 0.29, 0.3, 0.35);
            cylSpin = 7 * expOut(seg(u, 0.28, 0.54));
            joltAt('out', 0.24, -0.8);
            joltAt('close', 0.6, 1.6);
            leftAway = Math.max(leftAway, hump(u, 0.62, 0.72, 0.86, 0.96));
            break;
          }
          // a inspeção comum das armas longas: o arco (`inspectArc`); a mão de apoio vai ao pente se ele é pela lateral
          if (spec.cls !== 'pistol' && !OLD_INSPECT.has(g.id)) {
            const s2 = inspectArc(u, mo, pos, rot, ARC_TUNE[g.id]);
            if (this.holds?.mag && SIDE_MAG.has(g.id)) {
              magHold = Math.max(magHold, s2);
              joltAt('grab', 0.56, 0.8);
            }
            break;
          }
          // pistolas, e as armas que se acertaram em cima da inspeção antiga (RS9, StG 44, AK-47, Ballista): duas
          // paradas, com peso: um pequeno recuo antes (antecipação), a arma vira e mostra o lado esquerdo (para),
          // depois rola e mostra o lado direito e o topo, com a mão de apoio no pente; volta passando um pouco do ponto
          const w = hump(u, 0.04, 0.22, 0.82, 1);
          const pre = hump(u, 0, 0.05, 0.06, 0.14);
          // RS9: o segundo lado volta direto para casa, junto com a arma (antes, ele saía primeiro e a arma passava de
          // novo pelo lado esquerdo antes de voltar)
          const side2 = g.id === 'rs9' ? hump(u, 0.46, 0.6, 0.82, 1) : hump(u, 0.46, 0.6, 0.74, 0.86);
          const settle = Math.sin(seg(u, 0.86, 1) * Math.PI) * (1 - seg(u, 0.86, 1));
          // StG 44: no segundo lado o cano vai para a esquerda e quase não sobe, com a arma mais longe: o lado direito
          // fica de frente (com o cano para cima, a coronha comprida vinha para a câmera e só se via a soleira)
          // e do segundo lado ela volta direto para casa (passar de novo pelo primeiro fazia a coronha virar para a câmera)
          const stg = g.id === 'stg44';
          const side1 = stg && u > 0.6 ? 0 : 1 - side2;
          const lt = INSPECT_TUNE[g.id];
          rot.y += pre * 0.08 * mo - w * (lt?.yaw ?? 1.0) * side1 + side2 * (stg ? S2_STG.yaw : -0.25);
          rot.z += w * (lt?.roll ?? 0.5) * side1 - side2 * (stg ? S2_STG.roll : 0.45) * mo;
          rot.x += side2 * (stg ? S2_STG.pitch : 0.3) * mo - settle * 0.04 * mo;
          if (stg) pos.z -= side2 * S2_STG.push;
          pos.x -= w * (lt?.x ?? 0.08) - side2 * 0.02;
          pos.y += w * 0.04 + side2 * 0.015;
          // arma comprida: vai para a frente antes de girar e só volta depois (senão a coronha passa pela câmera)
          pos.z += (lt ? hump(u, 0, 0.12, 0.88, 1) : w) * (lt?.z ?? 0.03);
          // AK: a coronha de madeira é comprida: virada de lado, ela tapava metade da tela (e no segundo lado a arma
          // ficava em pé no meio). Vira menos, longe do rosto e mais à direita; no segundo lado, menos empinada
          if (g.id === 'ak47') {
            rot.y += (side2 * 0.8 - w * 0.2 * (1 - side2)) * mo;
            rot.x -= side2 * 0.2 * mo;
            rot.z += side2 * 0.8 * mo;
            pos.z -= w * 0.1 + side2 * 0.03;
            pos.x += w * 0.05 - side2 * 0.03;
          }
          // a mão de apoio vai ao pente no segundo lado (fuzis e submetralhadoras de pente pela lateral)
          if (spec.cls !== 'pistol' && this.holds?.mag && SIDE_MAG.has(g.id)) {
            magHold = Math.max(magHold, side2);
            joltAt('grab', 0.56, 0.8);
          }
          // pistola: inspeciona com uma mão só (a de apoio não tem onde segurar com a arma virada), um pouco mais longe
          if (spec.cls === 'pistol') {
            leftAway = Math.max(leftAway, w);
            pos.z -= 0.06 * w;
            pos.x += 0.04 * w;
          }
          break;
        }
      }
      if (u >= 1) this.action = null;
    }
    // BFR: o cão e o polegar. Sem gesto da ação: depois do tiro o polegar arma o cão (passado o coice); parado com o
    // cão abaixado (uma recarga cortada), arma também
    let bfrReach = 0;
    let bfrHamNow = 1;
    if (this.bfrArm && bfrRl < 0) this.bfrArm.visible = false;
    if (this.bfrHam) {
      if (!bfrGesture) {
        const busy = this.action && this.action.kind !== 'fire' && this.action.kind !== 'inspect';
        if (Number.isNaN(this.bfrCockT) && this.bfrCocked < 1 && !busy) this.bfrCockT = 0;
        if (!Number.isNaN(this.bfrCockT)) {
          this.bfrCockT += dt * 1000;
          if (this.bfrCockT >= 0) {
            cockAt(this.bfrCockT, false, CK);
            bfrGesture = bfrCockSpin = true;
          }
          if (this.bfrCockT >= COCK_MS) {
            this.bfrCockT = Number.NaN;
            CK.ham = 1;
          }
        }
      }
      if (bfrGesture) {
        bfrReach = CK.reach;
        this.bfrCocked = CK.ham;
      }
      bfrHamNow = this.bfrCocked;
      poseHammer(this.bfrHam, bfrHamNow);
      // armar gira o tambor um furo (5 furos: parado ele fica igual)
      if (bfrCockSpin) cylSpin += BFR_CHAMBER * bfrHamNow;
      // o polegar na espora: a mão sobe um pouco no punho (a arma rola na mão)
      if (bfrReach > 0) GRIP_R.addScaledVector(W2.copy(COCK_SHIFT_DOWN).lerp(COCK_SHIFT_UP, bfrHamNow), bfrReach);
    }
    spin = KD.spin;
    open = KD.open;
    const L = this.last;
    L.px = pos.x - p0x;
    L.py = pos.y - p0y;
    L.pz = pos.z - p0z;
    L.rx = rot.x - r0x;
    L.ry = rot.y - r0y;
    L.rz = rot.z - r0z;
    L.ex = KD.ex;
    L.ey = KD.ey;
    L.ez = KD.ez;
    L.pro = KD.pro;
    L.roll = KD.roll;
    L.spin = spin;
    L.twist = KD.twist;
    L.slide = KD.slide;
    L.open = open;
    L.shut = KD.shut;
    L.bite = KD.bite;
    L.bladeX = KD.bladeX;
    L.lx = KD.lx;
    L.ly = KD.ly;
    L.lz = KD.lz;
    // o que sobrou da ação cortada volta para casa
    if (this.carryT < CARRY_MS) {
      this.carryT += dt * 1000;
      const c = this.carry;
      const w = 1 - ease(Math.min(1, this.carryT / CARRY_MS));
      pos.x += c.px * w;
      pos.y += c.py * w;
      pos.z += c.pz * w;
      rot.x += c.rx * w;
      rot.y += c.ry * w;
      rot.z += c.rz * w;
      KD.ex += c.ex * w;
      KD.ey += c.ey * w;
      KD.ez += c.ez * w;
      KD.pro += c.pro * w;
      KD.roll += c.roll * w;
      KD.twist += wrapAngle(c.twist) * w;
      KD.slide += c.slide * w;
      KD.lx += c.lx * w;
      KD.ly += c.ly * w;
      KD.lz += c.lz * w;
      KD.shut += c.shut * w;
      KD.bite += c.bite * w;
      KD.bladeX += c.bladeX * w;
      spin += wrapAngle(c.spin) * w;
      open = Math.max(open, c.open * w);
    }
    // dedos soltos enquanto a faca gira. Karambit: os três de baixo bem abertos, o polegar fechado e o indicador mais
    // dobrado segurando a argola (medido: assim a volta inteira passa livre da mão)
    if (open > 0 && g.flip) {
      // balisong: os dedos meio fechados (esticam quando o cabo de morder passa por baixo do punho) e o polegar fechado
      // por cima (medido: a lâmina e o cabo de morder passam livres da mão a volta inteira)
      const spread = 1 - balSpread(KD.shut);
      rightCurl = lerp(rightCurl, BAL_FLIP_CURL.fingers * spread, open);
      rightThumb = lerp(rightThumb, BAL_FLIP_CURL.thumb, open);
      rightIndex = lerp(rightIndex, BAL_FLIP_CURL.index * spread, open);
    } else if (open > 0 && kar) {
      rightCurl = lerp(rightCurl, KAR_SPIN_CURL.fingers, open);
      rightThumb = lerp(rightThumb, KAR_SPIN_CURL.thumb, open);
      rightIndex = lerp(rightIndex, KAR_SPIN_CURL.index, open);
    } else if (open > 0 && g.id === 'bayonet') {
      rightCurl = lerp(rightCurl, BAY_OPEN.fingers, open);
      rightThumb = lerp(rightThumb, BAY_OPEN.thumb, open);
      rightIndex = lerp(rightIndex, BAY_OPEN.index, open);
    } else if (open > 0) {
      rightCurl = lerp(rightCurl, OPEN_CURL, open);
      rightThumb = lerp(rightThumb, OPEN_THUMB, open);
      rightIndex = lerp(rightIndex, OPEN_CURL, open);
    }
    // gesto da recarga vazia (calculado no `emptyGesture`)
    if (a?.kind === 'reloadEmpty' && a.t < a.ms) {
      boltBack = Math.max(boltBack, EG.bolt);
      chargeBack = EG.charge;
      chargeRot = EG.chargeRot;
      rightK = Math.max(rightK, EG.rightK);
      boltRot = Math.max(boltRot, EG.boltRot);
      if (EG.rightK > 0) {
        rightCurl = lerp(rightCurl, PINCH[0], EG.rightK);
        rightThumb = lerp(rightThumb, PINCH[1], EG.rightK);
        rightIndex = lerp(rightIndex, PINCH[2], EG.rightK);
      }
      rightThumb = lerp(rightThumb, 0.05, EG.thumbR);
      leftAlt = EG.alt;
      altQ = EG.altQ;
      shoulderOut = EG.alt * EG.out;
      leftCurl = lerp(leftCurl, EG.curl, EG.alt);
      leftThumb = lerp(leftThumb, EG.thumb, EG.alt);
    }

    this.sway.position.set(0, 0, 0);
    this.holder.position.copy(pos);
    this.holder.rotation.copy(rot);
    // faca: giro extra no espaço da câmera (o braço inteiro) e em volta do antebraço (o pulso vira as faces)
    if (knife) {
      KQ.setFromEuler(KE.set((KD.ex + RUN_E.x) * mo, (KD.ey + RUN_E.y) * mo, (KD.ez + RUN_E.z) * mo, 'ZYX'));
      if (KD.pro !== 0) KQ.premultiply(KQ2.setFromAxisAngle(this.foreAxis, KD.pro * mo));
      this.holder.quaternion.premultiply(KQ);
      if (KD.roll !== 0) this.holder.quaternion.multiply(KQ2.setFromAxisAngle(Z_AXIS, KD.roll * mo));
    }
    // o colete (espaço da câmera) levado para o espaço da arma, como deslocamento do pente a partir do lugar dele
    if (magPouch > 0 || (magHold > 0 && handPouch > 0)) {
      this.holder.updateMatrixWorld(true);
      this.holder.worldToLocal(POUCH.copy(POUCH_L)).sub(this.magHome);
    }
    if (magPouch > 0) MAG.lerp(POUCH, magPouch).addScaledVector(ARC_POUCH, 4 * magPouch * (1 - magPouch));
    if (akMag >= 0 && g.parts.mag) {
      akRock(AK_ROCK * akTurn(akMag), M1).premultiply(AK_M.makeTranslation(MAG.x, MAG.y, MAG.z));
      posePart(g, g.parts.mag, M1);
    } else movePart(g.parts.mag, MAG, cylSpin);
    // os cartuchos só aparecem com o pente fora do lugar (o modelo é oco: no lugar, eles vazavam pela culatra); o pente
    // que sai e o novo estão com bala (o vazio que cai é uma cópia sem eles)
    // revólver: depois que os estojos vazios caem, o tambor fica vazio até o carregador rápido empurrar os cartuchos
    if (g.rounds) g.rounds.visible = MAG.lengthSq() > 1e-6 && !(cylU >= CYL_DUMP_AT && cylU < MAG_SEAT_AT);
    // pente vazio: o ferrolho fica lá atrás (no tiro, só depois de chegar lá)
    if (this.slideHeld && !(a?.kind === 'fire' && a.t < a.ms * SLIDE_LOCK_AT))
      boltBack = Math.max(boltBack, SLIDE_LOCK_BACK);
    movePart(g.parts.bolt, V.set(0, 0, boltBack), 0);
    movePart(g.parts.slide, V.set(0, 0, boltBack));
    movePart(g.parts.charge, V.set(0, 0, chargeBack), chargeRot);
    movePart(g.parts.boltRot, V.set(0, 0, boltBack), boltRot);
    // Kar98k: a alavanca (filha do ferrolho, com o pivô no eixo dele) sobe girando antes de o ferrolho vir para trás
    // (sem isso o ferrolho só deslizava, com a alavanca sempre para baixo)
    if (g.id === 'kar98k') movePart(g.parts.charge, V.set(0, 0, chargeBack), KAR_LIFT * boltRot);
    movePart(g.parts.trigger, V.set(0, 0, 0.004 * trig));
    // faca: gira em volta do pivô (a argola no indicador, ou o meio do cabo), com a mão parada nela
    if (knife) {
      SPIN_Q.setFromAxisAngle(this.spinAxis, spin).multiply(TWIST_Q.setFromAxisAngle(Z_AXIS, KD.twist));
      g.root.quaternion.copy(SPIN_Q);
      g.root.position.copy(this.spinPivot).sub(V.copy(this.spinPivot).applyQuaternion(SPIN_Q));
      // karambit: a argola escorrega para fora no indicador enquanto gira (o cabo passa longe da palma)
      if (KD.slide !== 0)
        g.root.position.add(
          V.fromArray(g.id === 'bayonet' ? BAY_TOSS : KAR_SLIDE)
            .normalize()
            .multiplyScalar(KD.slide),
        );
      // balisong: a lâmina e o cabo de morder giram nos pinos (aberta, fechando ou nos floreios); fechada, a pilha
      // desce na mão (o punho fica em volta dela) e, girando com os dedos soltos, ela descola da palma
      if (g.flip) {
        setBalisong(g, 1 - KD.shut, KD.bite, KD.bladeX);
        g.root.position.y += balShift(KD.shut);
        g.root.position.x += BAL_LIFT * open;
      }
    }
    this.holder.updateMatrixWorld(true);
    // recarga: a mão esquerda segue o fundo do pente de verdade (já no lugar deste quadro), a palma por baixo dele
    const mh = this.holds?.mag ?? null;
    const akRocks = akMag >= 0 && mh !== null;
    if (magHold > 0) {
      // a pegada medida no pente (holds.ts), andando o mesmo que ele: descido do poço e indo ao colete
      V.copy(magPull)
        .multiplyScalar(akRocks ? akSlide(akHand) : handOut)
        .lerp(POUCH, handPouch);
      V.addScaledVector(ARC_POUCH, 4 * handPouch * (1 - handPouch));
      // AK: a mão gira junto com o pente na trava da frente
      if (akRocks) {
        akRock(AK_ROCK * akTurn(akHand), AK_M);
        V.add(W1.copy(mh.pos).applyMatrix4(AK_M));
        AK_HQ.copy(AK_Q).multiply(mh.quat);
      } else if (mh) V.add(mh.pos);
      else V.add(this.magBottom).add(W1.set(-0.046, -0.04, 0));
      // Desert Eagle: no tapa do encaixe, a palma vai para baixo da base (na pegada do pente ela fica à esquerda dela)
      if (g.id === 'deagle') V.x += 0.03 * magPalm;
      LEFT.lerp(V, magHold);
      // no meio do caminho entre o apoio e o pente, por fora: em linha reta, a mão passava por dentro da arma (Desert
      // Eagle: o apoio fica logo acima do pente, um arco curto e a mão meio fechada bastam)
      const arc = 4 * magHold * (1 - magHold) * (g.id === 'deagle' ? 0.35 : 1);
      LEFT.addScaledVector(ARC_OUT, arc);
      // no ar, meio fechada e solta (`LEFT_TRANSIT`): os acertos dos dedos de cada pegada somem no caminho. Antes ela
      // abria de todo (0,15) para os dedos não atravessarem o guarda-mão ao sair, e ficava 2–3 quadros espalmada no ar;
      // o arco já a leva para fora da arma antes de fechar
      leftCurl = lerp(leftCurl, LEFT_TRANSIT[0], arc);
      leftThumb = lerp(leftThumb, LEFT_TRANSIT[1], arc);
      leftTransit = arc;
      // a forma da pegada do pente (em geral aberta, pela lateral) só na segunda metade do caminho, chegando nele
      magFit = mh ? ease(seg(magHold, 0.5, 1)) : magHold;
      if (mh) {
        leftCurl = lerp(leftCurl, mh.curl[0], magFit);
        leftThumb = lerp(leftThumb, mh.curl[1], magFit);
      }
    }
    // fim do encaixe: os dedos soltam e a palma empurra a base
    leftCurl = lerp(leftCurl, 0.15, magPalm);
    leftThumb = lerp(leftThumb, 0.15, magPalm);
    // BFR: a esquerda embaixo do tambor (andando com ele; a palma empurra a vareta), no cinto e com o carregador
    // rápido (a mão fica onde o carregador tem que estar: alinhado atrás dos furos, depois empurrando)
    if (bfrRl >= 0 && mh) {
      W1.copy(mh.pos).add(MAG);
      W1.z += 0.015 * BR.rod;
      LEFT.lerp(W1, BR.cradle).addScaledVector(ARC_OUT, 4 * BR.cradle * (1 - BR.cradle));
      leftCurl = lerp(leftCurl, mh.curl[0], BR.cradle);
      leftThumb = lerp(leftThumb, mh.curl[1] + 0.35 * BR.rod, BR.cradle);
      if (BR.belt > 0) {
        this.holder.worldToLocal(W1.copy(POUCH_L));
        LEFT.lerp(W1, BR.belt).addScaledVector(ARC_OUT, 4 * BR.belt * (1 - BR.belt));
      }
      if (BR.loader > 0) {
        W1.copy(this.loaderSeat).add(MAG);
        W1.z += BR.lz;
        LEFT.lerp(W1.sub(W2.copy(BFR_IN_HAND).applyQuaternion(BFR_LQ)), BR.loader);
      }
      const hold = Math.max(BR.belt, BR.loader);
      leftCurl = lerp(leftCurl, 0.8, hold);
      leftThumb = lerp(leftThumb, 0.5, hold);
    }
    // Rhino: a mão que segura o tambor bate na vareta do extrator, para trás ao longo do eixo (o polegar estica)
    if (rhinoRod > 0) {
      LEFT.z += 0.016 * rhinoRod;
      leftThumb = lerp(leftThumb, 0.05, rhinoRod);
    }
    if (rhinoFlick > 0) {
      LEFT.y += 0.025 * rhinoFlick;
      leftCurl = lerp(leftCurl, 0.2, rhinoFlick);
    }
    // gesto da recarga vazia: a mão esquerda vai pela lateral (ou por baixo) até a peça
    if (leftAlt > 0) LEFT.lerp(EG.at, leftAlt).addScaledVector(EG.arc, 4 * leftAlt * (1 - leftAlt));
    // ferrolho: a mão direita anda junto com a alavanca (já no lugar deste quadro: sobe girando com o ferrolho e vem
    // para trás), na pegada medida em volta da bola dela
    const pinch = this.holds?.pinch ?? null;
    const lever = g.parts.boltRot ?? (g.id === 'kar98k' ? g.parts.charge : undefined);
    let pinchQ = 0;
    const boltHand = BOLT_HAND[g.id];
    if (rightK > 0 && pinch && lever && boltHand) {
      // a pinça segue a bola da alavanca, mas o pulso gira só uma parte do giro dela, em volta da bola
      holderSpace(lever.obj, this.holder, M2).multiply(this.handleRestInv);
      M2.decompose(W1, LEVER_Q, S1);
      KNOB_NOW.copy(boltHand.knob).applyMatrix4(M2);
      LEVER_Q.slerp(KNOB_Q.identity(), 1 - boltHand.roll);
      HANDLE.copy(pinch.pos).sub(boltHand.knob).applyQuaternion(LEVER_Q).add(KNOB_NOW);
      RIGHT_Q.copy(LEVER_Q).multiply(pinch.quat);
      GRIP_R.lerp(HANDLE, rightK);
      pinchQ = rightK;
    } else if (rightK > 0 && pinch && lever) {
      M1.compose(pinch.pos, pinch.quat, S1.set(1, 1, 1));
      M1.premultiply(holderSpace(lever.obj, this.holder, M2).multiply(this.handleRestInv));
      M1.decompose(HANDLE, RIGHT_Q, S1);
      GRIP_R.lerp(HANDLE, rightK);
      pinchQ = rightK;
    } else if (rightK > 0 && a?.kind === 'reloadEmpty' && EMPTY_GESTURE[g.id] === 'rack') {
      GRIP_R.lerp(EG.rat, rightK);
      RIGHT_Q.copy(RACK_Q);
      pinchQ = rightK;
    } else if (rightK > 0) {
      const handle = g.parts.charge ?? g.parts.boltRot ?? g.parts.bolt;
      if (handle) GRIP_R.lerp(partNow(handle, this.holder, HANDLE).add(V.set(0.034, -0.03, 0.062)), rightK);
    }
    // Kar98k: a direita vai na cartucheira (fora da tela, embaixo à direita) e volta com o pente-lâmina até o guia
    if (rightPouch > 0) GRIP_R.lerp(this.holder.worldToLocal(W1.copy(POUCH_R)), rightPouch);
    const cp = clipNow;
    if (clipK > 0 && cp)
      GRIP_R.lerp(
        W1.copy(CLIP_GUIDE)
          .add(this.clipHand)
          // o polegar desce junto com as balas que já foram para o depósito (até a última, que ele empurra para dentro
          // sem entrar na caixa), e mais um pouco a cada empurrão
          .add(V.set(0, -0.005 * cp.press - CLIP_PITCH * Math.min(cp.stripped, CLIP_ROUNDS - 1), 0)),
        clipK,
      );
    if (this.clip) {
      const c = this.clip;
      c.root.visible = !!cp?.clipShown;
      if (cp?.clipShown) {
        // na mão até chegar ao guia; depois fica nele e as balas descem para o depósito a cada empurrão
        const seated = cp.clip >= 0.999 || cp.stripped > 0;
        if (seated) c.root.position.copy(CLIP_GUIDE);
        else c.root.position.copy(GRIP_R).sub(this.clipHand);
        c.rounds.forEach((r, i) => {
          r.position.y = -0.0055 - (i + cp.stripped) * CLIP_PITCH;
          r.visible = i + cp.stripped < CLIP_ROUNDS - 0.5;
        });
      }
    }
    this.handR.root.position.copy(GRIP_R);
    // no pente-lâmina, a mão volta para o giro da pegada do delgado (a alavanca levantada não a gira)
    pinchQ *= 1 - clipK;
    if (this.holds) this.handR.root.quaternion.copy(this.holds.right.quat).slerp(RIGHT_Q, pinchQ);
    // quanto o indicador está no gatilho (1) ou fora dele, sobre a armação (0)
    const span = this.rightCurl[2] - trigOff;
    const onTrigger = Math.abs(span) > 1e-3 ? Math.max(0, Math.min(1, (rightIndex - trigOff) / span)) : 1;
    const offR = this.rightOffsets(rightK, onTrigger, clipK, kar || g.id === 'bayonet' || g.flip ? open : 0);
    // BFR: o polegar estica por cima da armação até a espora do cão e anda com ela
    if (bfrReach > 0 && offR === OFF_R) {
      OFF_R[4] = lerp(OFF_R[4], lerp(COCK_THUMB_DOWN[0], COCK_THUMB_UP[0], bfrHamNow) - rightThumb, bfrReach);
      OFF_R[5] = lerp(OFF_R[5], lerp(COCK_THUMB_DOWN[1], COCK_THUMB_UP[1], bfrHamNow), bfrReach);
    }
    this.handR.setCurl(rightCurl, rightThumb, rightIndex, offR);
    // a mão esquerda solta e desce para fora da tela (o braço não estica até a arma). A conta é no espaço da câmera:
    // no da arma, que gira ~0,9 rad saindo da tática, a mão passava pelo meio da tela, aberta e solta
    if (leftAway > 1e-3) {
      this.holder.localToWorld(LEFT).lerp(LEFT_OFF, leftAway);
      this.holder.worldToLocal(LEFT);
    }
    this.handL.root.position.copy(LEFT);
    this.placeLoader(cylU);
    this.handL.root.quaternion.copy(LEFT_Q.copy(this.leftQ).slerp(altQ, leftAlt));
    if (mh && magHold > 0) this.handL.root.quaternion.slerp(akRocks ? AK_HQ : mh.quat, magHold);
    let leftFit = magFit;
    if (bfrRl >= 0) {
      if (mh) this.handL.root.quaternion.slerp(mh.quat, BR.cradle);
      this.handL.root.quaternion.slerp(BFR_LQ, BR.loader);
      this.placeBfrLoader(bfrRl, cylSpin);
      leftFit = BR.cradle * (1 - Math.max(BR.belt, BR.loader));
      leftAway = Math.max(leftAway, BR.belt, BR.loader);
    }
    // Rhino: com o carregador rápido, os dedos fecham menos (só em volta dele, sem passar por cima do tambor)
    if (g.id === 'rhino') leftCurl = lerp(leftCurl, 0.3, this.rhinoLoader(cylU));
    this.handL.setCurl(
      leftCurl,
      leftThumb,
      leftCurl,
      this.leftOffsets(leftFit, leftAlt, magPalm, Math.max(leftAway, leftTransit)),
    );
    if (kp) this.knifeGuard(now, inp, mo);
    this.handR.root.updateMatrixWorld(true);
    this.handL.root.updateMatrixWorld(true);
    // braços: do ombro (fixo na câmera) até o pulso de cada mão
    // faca: o antebraço segue a mão (pulso quase reto, com o desvio natural de cada pegada)
    if (kp) {
      this.handR.root.getWorldQuaternion(HQ);
      FORE_DIR.copy(kp.fore).applyQuaternion(HQ);
      this.foreAxis.copy(FORE_DIR);
    }
    if (this.arms.build()) {
      elbowHint(this.handR.root.getWorldPosition(W1), 1, ELBOW, 0, kp ? 1 : 0, FORE_DIR);
      this.arms.solve(1, shoulderAt(1, 0, SH), ELBOW);
      // empunhadura vertical: o antebraço esquerdo segue a linha da mão (vem de baixo e de trás, o pulso reto)
      const vg = g.foregrip?.kind === 'vertical' ? (1 - magHold) * (1 - leftAlt) * (1 - leftAway) : 0;
      if (vg > 0) FORE_L.set(0, 0, -1).applyQuaternion(this.handL.root.getWorldQuaternion(HQ));
      elbowHint(this.handL.root.getWorldPosition(W1), -1, ELBOW, shoulderOut, 0.85 * vg, FORE_L);
      this.arms.solve(-1, shoulderAt(-1, shoulderOut, SH), ELBOW);
    }
    // ferrolho aberto: o estojo sai (com a arma já no lugar deste quadro); peças soltas caindo
    if (this.ejectAfter) {
      this.ejectAfter = false;
      this.eject(true);
    }
    if (this.dumpAfter) {
      this.dumpAfter = false;
      this.dumpCylinder();
    }
    this.stepDebris(dt);
    // clarão da boca
    const on = now < this.flashUntil;
    this.flash.visible = on;
    this.flash.position.copy(g.muzzle).add(V.set(0, 0, -0.03));
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = on ? 3 : 0;
    // mira de ponto: o retículo onde a linha do olho cruza o vidro (fica no centro da tela)
    aimReticles(g, this.camera);
  }

  /**
   * Arma com animação feita à mão (`fpanim.ts`, ADR-0061): o clipe dá a arma, as mãos, os dedos, o pente e a alavanca
   * no espaço em que foi escrito (a câmera em repouso, a arma na pose de quadril); aqui ficam as camadas de código por
   * cima, as mesmas das outras armas: mirar (a mesma conta da linha de mira), balanço do mouse, passo, coice pelas
   * molas, deslizar e pulo. Elas mexem nesse espaço inteiro, então mão e arma andam juntas; o braço é resolvido do
   * pulso até o ombro, com o cotovelo do clipe.
   */
  private updateAuthored(g: GunModel, spec: GunSpec, au: AuthoredArms, dt: number, now: number, inp: VmInput) {
    const mo = this.motion;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.sprintK += ((inp.sprint && !inp.slide ? 1 : 0) - this.sprintK) * k(10);
    this.tacK += ((inp.tactical && !inp.slide ? 1 : 0) - this.tacK) * k(10);
    this.slideK += ((inp.slide ? 1 : 0) - this.slideK) * k(12);
    this.airK += ((inp.airborne ? 1 : 0) - this.airK) * k(8);
    const swayK = (1 - inp.ads * 0.85) * mo;
    const lx = clamp(inp.lookX, LOOK_MAX);
    const ly = clamp(inp.lookY, LOOK_MAX);
    this.swayX = clamp(this.swayX + (-lx * 0.9 * swayK - this.swayX) * k(14), SWAY_MAX);
    this.swayY = clamp(this.swayY + (ly * 0.9 * swayK - this.swayY) * k(14), SWAY_MAX);
    const pace = inp.sprint ? (inp.tactical ? 15 : 12) : 8;
    if (inp.moving > 0.05 && !inp.airborne && !inp.slide) this.bob += dt * pace;
    this.adsNow = inp.ads;
    const vk = spec.recoil.vm;
    for (const s of [this.kBack, this.kRise, this.kRoll, this.kSide]) stepSpring(s, vk.k, vk.c, dt);
    // o que o jogo pergunta (`busy`) e as peças do tiro (ferrolho e gatilho) continuam por aqui
    let boltBack = 0;
    let trig = 0;
    const a = this.action;
    if (a) {
      a.t += dt * 1000;
      const u = Math.min(1, a.t / a.ms);
      if (a.kind === 'fire') {
        boltBack = Math.sin(Math.min(1, u * 1.2) * Math.PI) * 0.035;
        trig = hump(u, 0, 0.12, 0.4, 0.6);
      }
      if (u >= 1) this.action = null;
    }
    const ads = ease(inp.ads);
    au.update(dt, { ads, sprint: this.sprintK, tac: this.tacK, stride: this.bob });
    // a linha de mira: a mesma conta das outras armas
    const eyeZ = g.adsEye ?? ADS_EYE[g.id] ?? (spec.cls === 'smg' ? -0.25 : -0.2);
    const sPitch = g.sightPitch ?? 0;
    const pc = Math.cos(sPitch);
    const ps = Math.sin(sPitch);
    AIM.set(-g.sight.x, -(g.sight.y * pc - g.sight.z * ps), eyeZ - (g.sight.y * ps + g.sight.z * pc));
    // no quadril, a arma fica onde as outras armas longas ficam (HIP_LONG, cano um pouco para o centro): a pose de
    // quadril do clipe é a da câmera da referência, perto e no meio demais (a arma tapava metade da tela); o clipe
    // inteiro anda junto, então as mãos continuam na arma
    const pos = POS.copy(HIP_LONG).lerp(AIM, ads);
    const rot = ROT.set(sPitch * ads, 0.06 * (1 - ads), -0.08 * (1 - ads), 'YXZ');
    // o passo (a corrida tem o dela no clipe), o balanço e o resto, como nas outras armas
    const bobA = inp.moving * (1 - ads * 0.85) * (inp.crouch ? 0.6 : 1) * mo * (1 - this.sprintK);
    pos.x += Math.sin(this.bob) * 0.012 * bobA;
    pos.y += Math.abs(Math.cos(this.bob)) * -0.012 * bobA;
    const steady = 1 - ads * 0.9;
    rot.y += this.swayX;
    rot.x += this.swayY;
    pos.x += this.swayX * 0.05 * steady;
    pos.y -= this.swayY * 0.05 * steady;
    rot.z += this.slideK * 0.45 * mo * steady;
    pos.y += (this.slideK * 0.02 + this.airK * 0.015) * steady;
    pos.z = Math.min(pos.z + this.kBack.x, Math.max(pos.z, KICK_Z_MAX));
    rot.x += this.kRise.x;
    rot.z += this.kRoll.x;
    rot.y += this.kSide.x;
    // o espaço do clipe: a pose de quadril dele vai para a pose de agora
    const P = au.pose;
    AU_ROOT.compose(pos, AU_Q.setFromEuler(rot), AU_ONE).multiply(au.hipInv);
    AU_M.multiplyMatrices(AU_ROOT, P.gun).decompose(this.holder.position, this.holder.quaternion, AU_S);
    this.holder.scale.set(1, 1, 1);
    this.sway.position.set(0, 0, 0);
    // peças
    posePart(g, g.parts.mag, P.mag);
    if (g.rounds) g.rounds.visible = P.rounds && AU_V.setFromMatrixPosition(P.mag).lengthSq() > 1e-6;
    movePart(g.parts.charge, V.set(0, 0, P.charge));
    movePart(g.parts.bolt, V.set(0, 0, boltBack), 0);
    movePart(g.parts.trigger, V.set(0, 0, 0.004 * trig));
    this.holder.updateMatrixWorld(true);
    // braços: a mão e o cotovelo do clipe, o braço até o ombro; os dedos do clipe
    if (this.arms.build()) {
      // direita: no punho o tempo todo, na pegada medida na malha (indicador no gatilho, polegar fechado por cima do
      // punho), presa à arma; no MP7 de verdade ela não sai do punho (pente e alavanca são com a esquerda). A do clipe
      // vinha da referência com o indicador esticado na armação e, na tática, soltava da arma
      if (this.holds) {
        this.handR.root.position.copy(this.holds.right.pos);
        this.handR.root.quaternion.copy(this.holds.right.quat);
        this.handR.setCurl(
          this.rightCurl[0],
          this.rightCurl[1],
          this.rightCurl[2] + TRIGGER_SQUEEZE * trig,
          authoredThumb(this.rightOffsets(0, 1, 0)),
        );
        this.handR.root.updateMatrixWorld(true);
        elbowHint(this.handR.root.getWorldPosition(W1), 1, ELBOW, 0, 0, FORE_DIR);
        this.arms.solve(1, shoulderAt(1, 0, SH), ELBOW);
      }
      for (let s = this.holds ? 1 : 0; s < 2; s++) {
        const side = s === 0 ? 1 : -1;
        AU_M.multiplyMatrices(AU_ROOT, P.hand[s]!);
        ELBOW.copy(P.elbow[s]!).applyMatrix4(AU_ROOT);
        this.arms.solveHand(side, AU_M, shoulderAt(side, 0, SH), ELBOW);
        this.arms.setFingerQuats(side, P.fingers[s]!);
      }
    }
    if (this.ejectAfter) {
      this.ejectAfter = false;
      this.eject(true);
    }
    this.stepDebris(dt);
    const on = now < this.flashUntil;
    this.flash.visible = on;
    this.flash.position.copy(g.muzzle).add(V.set(0, 0, -0.03));
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = on ? 3 : 0;
    aimReticles(g, this.camera);
  }

  /**
   * Saque da faca no momento `u` (0–1), mexendo na pose (`pos`, `rot`) e preenchendo `KD`: o braço inteiro anda, não só
   * a faca. Karambit: as trilhas de `KAR_DRAW` (`karambit.ts`). Baioneta: a mão sobe de baixo com a lâmina em pé e, enquanto o braço desce para a guarda, a lâmina deita
   * até a ponta apontar para o meio da tela. A esquerda sobe para a guarda logo atrás. Com "reduzir movimento", a faca
   * não gira na mão e os giros do braço ficam em ~30%.
   */
  private knifeDraw(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    const kar = this.gun?.id === 'karambit';
    const full = mo >= 1;
    if (this.gun?.flip) {
      this.balisongPlay(BAL_DRAW, u, full, pos);
      if (full) {
        joltAt('bite', 0.38, 0.9);
        joltAt('lock', 0.56, 1.8);
      }
      joltAt('catch', 0.62, 1.4);
      return;
    }
    if (this.gun?.id === 'bowie') {
      this.karambitPlay(BOWIE_DRAW, u, full, pos);
      joltAt('catch', 0.52, 2.2);
      return;
    }
    if (this.gun?.id === 'kabar') {
      this.karambitPlay(KB_DRAW, u, full, pos);
      turnInto(u, KB_DRAW_T, KD);
      joltAt('catch', 0.38, 2);
      return;
    }
    if (kar) {
      this.karambitPlay(KAR_DRAW, u, full, pos);
      joltAt('catch', 0.6, 2.2);
      return;
    }
    if (this.gun?.id === 'kukri') {
      kukriPlay(KUK_DRAW, u, pos, KD);
      joltAt('catch', 0.5, 2.4);
      return;
    }
    if (this.gun?.id === 'bayonet') {
      this.karambitPlay(BAY_DRAW, u, full, pos);
      joltAt('catch', 0.5, 2.2);
      return;
    }
    // passa um pouco do ponto ao chegar na guarda e volta
    const settle = hump(u, 0.72, 0.8, 0.84, 1);
    pos.y -= 0.02 * settle;
    joltAt('catch', 0.8, 2.4);
    if (kar) {
      // entra pelo alto à direita (fora da tela), fica erguida enquanto gira e desce
      const entry = 1 - ease(seg(u, 0, 0.2));
      const high = 1 - ease(seg(u, 0.52, 0.8));
      pos.x += -0.03 * high + 0.16 * entry;
      pos.y += 0.15 * high + 0.16 * entry;
      pos.z -= 0.05 * high;
      KD.ez = -0.7 * high;
      KD.ex = 0.5 * high;
      const sU = ease(seg(u, 0.12, 0.52));
      KD.spin = full ? -Math.PI * 2 * sU : 0;
      KD.open = full ? hump(u, 0.08, 0.16, 0.48, 0.56) : 0;
      // o pulso vira com o giro (a faca não gira sozinha)
      KD.pro = Math.sin(sU * Math.PI) * 0.6;
    } else {
      // sobe de baixo com a lâmina em pé e deita descendo para a guarda
      const entry = 1 - ease(seg(u, 0, 0.3));
      const high = 1 - ease(seg(u, 0.4, 0.78));
      pos.x += 0.05 * entry + 0.02 * high;
      pos.y += 0.1 * high - 0.26 * entry;
      pos.z -= 0.06 * high;
      KD.ez = -1.1 * high;
      KD.ex = 0.3 * high;
      // em pé, o antebraço virado mostra a face da lâmina (de fio, ela some)
      KD.pro = 0.7 * high;
      KD.open = full ? hump(u, 0.38, 0.46, 0.6, 0.7) * 0.4 : 0;
    }
    rot.x += 0.05 * settle * mo;
    // a esquerda sobe para a guarda logo depois da direita
    KD.ly = -0.2 * (1 - ease(seg(u, 0.25, 0.75)));
    KD.lz = 0.05 * (1 - ease(seg(u, 0.25, 0.75)));
  }

  /**
   * Inspeção da faca no momento `u` (0–1): o braço levanta a faca para o meio-direita da tela e mais perto do rosto; o
   * antebraço gira devagar mostrando uma face da lâmina (pausa) e a outra (pausa); depois o floreio — a baioneta fica em
   * pé e gira no próprio comprimento entre os dedos — e volta para a guarda (a karambit usa `KAR_INSPECT`). A faca nunca gira sozinha: a mão e o braço vão junto o tempo todo. A esquerda baixa um pouco, fora do caminho.
   */
  private knifeInspect(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    const kar = this.gun?.id === 'karambit';
    const full = mo >= 1;
    if (this.gun?.flip) {
      this.balisongPlay(BAL_INSPECT, u, full, pos);
      joltAt('faceA', 0.12, 0.8);
      joltAt('faceB', 0.4, 0.8);
      if (full) {
        joltAt('half', 0.62, 0.8);
        joltAt('shut', 0.72, 1.2);
        joltAt('half2', 0.82, 0.8);
        joltAt('lock2', 0.88, 1.6);
      }
      return;
    }
    if (this.gun?.id === 'bowie') {
      this.karambitPlay(BOWIE_INSPECT, u, full, pos);
      joltAt('faceA', 0.12, 0.8);
      joltAt('faceB', 0.44, 0.8);
      joltAt('catch', 0.72, 0.6);
      joltAt('settle', 0.95, 1.2);
      return;
    }
    if (this.gun?.id === 'kabar') {
      this.karambitPlay(KB_INSPECT, u, full, pos);
      turnInto(u, KB_INSPECT_T, KD);
      joltAt('faceA', 0.2, 0.8);
      joltAt('faceB', 0.55, 0.8);
      joltAt('catch', 0.9, 1.4);
      return;
    }
    if (kar) {
      this.karambitPlay(KAR_INSPECT, u, full, pos);
      joltAt('faceA', 0.2, 0.8);
      joltAt('faceB', 0.44, 0.8);
      joltAt('catch', 0.86, 1.6);
      return;
    }
    if (this.gun?.id === 'kukri') {
      kukriPlay(KUK_INSPECT, u, pos, KD);
      joltAt('faceA', 0.12, 0.8);
      joltAt('faceB', 0.42, 0.8);
      joltAt('cut', 0.78, 1.6);
      return;
    }
    if (this.gun?.id === 'bayonet') {
      this.karambitPlay(BAY_INSPECT, u, full, pos);
      joltAt('faceA', 0.14, 0.8);
      joltAt('faceB', 0.43, 0.8);
      joltAt('catch', 0.85, 1.8);
      return;
    }
    const lift = hump(u, 0, 0.1, 0.88, 1);
    pos.x -= 0.06 * lift;
    pos.y += 0.07 * lift;
    pos.z += 0.09 * lift;
    KD.ex = 0.15 * lift;
    // uma face, pausa, a outra, pausa (o antebraço gira: pronação e supinação)
    const faceA = ease(seg(u, 0.08, 0.2));
    const faceB = ease(seg(u, 0.3, 0.42));
    const back = ease(seg(u, 0.52, 0.6));
    const faces = (faceA - 2 * faceB + back) * lift;
    // karambit: o antebraço gira (a garra fica de frente para a câmera); baioneta: a lâmina sai do punho quase em ângulo
    // reto com o antebraço, então o giro que mostra as faces é no comprimento da lâmina (o pulso dobra junto)
    if (kar) KD.pro = 0.9 * faces;
    else KD.roll = 1.1 * faces;
    joltAt('faceA', 0.2, 0.8);
    joltAt('faceB', 0.42, 0.8);
    // floreio
    const fl = hump(u, 0.56, 0.62, 0.84, 0.9);
    const sU = ease(seg(u, 0.62, 0.82));
    if (kar) {
      pos.y += 0.05 * fl;
      KD.ez -= 0.3 * fl;
      KD.spin = full ? -Math.PI * 2 * sU : 0;
      KD.open = full ? hump(u, 0.58, 0.63, 0.8, 0.85) : 0;
    } else {
      // em pé (a ponta para cima) e girando no comprimento entre os dedos soltos
      KD.ez = -0.9 * fl;
      KD.ex += 0.2 * fl;
      KD.twist = full ? Math.PI * 2 * sU : 0;
      KD.open = full ? hump(u, 0.58, 0.63, 0.8, 0.85) * 0.45 : 0;
    }
    joltAt('catch', 0.86, 1.4);
    rot.x += 0.03 * hump(u, 0.86, 0.9, 0.92, 1);
    KD.ly = -0.05 * lift;
    KD.lx = -0.02 * lift;
  }

  /**
   * Golpe leve da faca (`s` ±1, alternando os lados): antecipa (o braço recua para o lado de onde vem o corte, ~100 ms),
   * corta num arco rápido passando pela mira, segue e volta. A esquerda recua um pouco no corte (o corpo gira junto).
   */
  private knifeSlash(
    u: number,
    s: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    if (this.gun?.id === 'bowie') {
      this.karambitPlay(s > 0 ? BOWIE_SLASH_R : BOWIE_SLASH_L, u, mo >= 1, pos);
      joltAt('cut', 0.32, 1.8);
      return;
    }
    if (this.gun?.id === 'karambit') {
      this.karambitPlay(s > 0 ? KAR_SLASH_R : KAR_SLASH_L, u, mo >= 1, pos);
      joltAt('cut', 0.3, 1.4);
      return;
    }
    if (this.gun?.id === 'kukri') {
      kukriPlay(s > 0 ? KUK_CHOP_R : KUK_CHOP_L, u, pos, KD);
      joltAt('cut', 0.3, 2);
      return;
    }
    if (this.gun?.id === 'bayonet') {
      this.karambitPlay(s > 0 ? BAY_SLASH_R : BAY_SLASH_L, u, mo >= 1, pos);
      joltAt('cut', 0.32, 1.4);
      return;
    }
    if (this.gun?.flip) {
      this.balisongPlay(s > 0 ? BAL_SLASH_R : BAL_SLASH_L, u, mo >= 1, pos);
      joltAt('cut', 0.3, 1.4);
      return;
    }
    if (this.gun?.id === 'kabar') {
      this.karambitPlay(s > 0 ? KB_SLASH_R : KB_SLASH_L, u, mo >= 1, pos);
      turnInto(u, s > 0 ? KB_SLASH_R_T : KB_SLASH_L_T, KD);
      joltAt('cut', 0.3, 1.4);
      return;
    }
    const w = hump(u, 0, 0.18, 0.7, 1);
    const wind = hump(u, 0, 0.16, 0.18, 0.28);
    pos.z += 0.05 * wind;
    pos.y += 0.03 * wind;
    rot.y += 0.35 * s * wind;
    KD.pro = 0.4 * s * wind;
    const sw = expOut(seg(u, 0.2, 0.45));
    joltAt('cut', 0.32, 1.4);
    // o arco dos dois lados cruza o centro da tela (o da esquerda começa mais para dentro)
    const inward = s < 0 ? -0.08 : 0;
    pos.x += (lerp(0.12 * s, -0.16 * s, sw) + inward) * w;
    pos.y += 0.05 * w;
    pos.z -= 0.12 * w;
    rot.y += lerp(0.9 * s, -0.9 * s, sw) * w;
    rot.z += lerp(-0.8 * s, 0.8 * s, sw) * w * mo;
    KD.lz = 0.04 * w;
    KD.ly = -0.025 * w;
    KD.lx = -0.02 * w;
  }

  /**
   * Golpe pesado: antecipação longa (a mão recua e sobe), estocada reta para a frente com a ponta para a frente, tranco
   * forte no fim e volta devagar. A esquerda puxa para trás na estocada.
   */
  /**
   * Coronhada da M9 com as duas mãos: antecipa (a arma recua e o cano sobe, ~60 ms), estoca para a frente e para a
   * esquerda com o cano descendo (o golpe com a frente da armação chega em 0,32, junto com o acerto do `game.ts`), dá o
   * tranco e volta devagar, passando um pouco do ponto
   */
  private pistolBash(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    const pre = hump(u, 0, 0.12, 0.14, 0.28);
    const hit = expOut(seg(u, 0.12, 0.32)) * (1 - ease(seg(u, 0.42, 0.9)));
    const settle = Math.sin(seg(u, 0.82, 1) * Math.PI) * (1 - seg(u, 0.82, 1));
    pos.z += 0.035 * pre - 0.16 * hit;
    pos.y += 0.012 * pre - 0.015 * hit;
    pos.x -= 0.07 * hit;
    rot.x += (0.16 * pre - 0.3 * hit + 0.03 * settle) * mo;
    rot.z += (-0.05 * pre + 0.45 * hit) * mo;
    rot.y += 0.12 * hit * mo;
    joltAt('hit', 0.32, 2.2);
  }

  private knifeStab(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    if (this.gun?.id === 'bowie') {
      this.karambitPlay(BOWIE_HEAVY, u, mo >= 1, pos);
      joltAt('stab', 0.47, 3.4);
      return;
    }
    if (this.gun?.id === 'karambit') {
      this.karambitPlay(KAR_HEAVY, u, mo >= 1, pos);
      joltAt('stab', 0.47, 3);
      return;
    }
    if (this.gun?.id === 'kukri') {
      kukriPlay(KUK_HEAVY, u, pos, KD);
      joltAt('stab', 0.45, 3.4);
      return;
    }
    if (this.gun?.id === 'bayonet') {
      this.karambitPlay(BAY_HEAVY, u, mo >= 1, pos);
      joltAt('stab', 0.47, 3);
      return;
    }
    if (this.gun?.flip) {
      this.balisongPlay(BAL_HEAVY, u, mo >= 1, pos);
      joltAt('stab', 0.47, 3);
      return;
    }
    if (this.gun?.id === 'kabar') {
      this.karambitPlay(KB_HEAVY, u, mo >= 1, pos);
      turnInto(u, KB_HEAVY_T, KD);
      joltAt('stab', 0.45, 3);
      return;
    }
    const wind = ease(seg(u, 0, 0.35)) * (1 - expOut(seg(u, 0.35, 0.5)));
    const thrust = expOut(seg(u, 0.35, 0.5)) * (1 - ease(seg(u, 0.68, 1)));
    joltAt('stab', 0.47, 3);
    pos.z += 0.06 * wind - 0.2 * thrust;
    pos.y += 0.04 * wind + 0.02 * thrust;
    pos.x -= 0.06 * thrust;
    // a ponta inclina para a frente só até a metade: alinhada com a vista, a lâmina some atrás da mão
    rot.x += 0.2 * wind * mo - 0.22 * thrust;
    rot.y -= 0.1 * thrust;
    KD.lz = 0.03 * wind + 0.06 * thrust;
    KD.ly = -0.03 * thrust;
  }

  /**
   * Uma animação da karambit (`KarTracks`) no momento `u`: o braço anda no espaço da câmera e gira em volta da faca, o
   * antebraço vira, a faca gira no indicador e os dedos soltam. Com "reduzir movimento" (`full` falso), a faca não gira
   * na mão (os giros do braço já ficam em ~30% no `update`).
   */
  private karambitPlay(t: KarTracks, u: number, full: boolean, pos: THREE.Vector3) {
    pos.x += track(u, t.px);
    pos.y += track(u, t.py);
    pos.z += track(u, t.pz);
    KD.ex += track(u, t.ex);
    KD.ey += track(u, t.ey);
    KD.ez += track(u, t.ez);
    KD.pro += track(u, t.pro);
    KD.spin = full ? track(u, t.spin) : 0;
    KD.slide = full ? track(u, t.slide) : 0;
    KD.open = full ? track(u, t.open) : 0;
    KD.lx += track(u, t.lx);
    KD.ly += track(u, t.ly);
    KD.lz += track(u, t.lz);
  }

  /**
   * Inspeção da MPX (virando o cano para a direita, a coronha comprida varria a câmera e tampava metade da tela):
   * antecipação curta, o cano vai para a esquerda e a arma mostra o lado esquerdo (para, com uma deriva lenta), rola
   * para a direita mostrando o poço e o pente enquanto a esquerda pega nele (para) e volta direto para casa, passando
   * um pouco do ponto; a coronha fica sempre para a direita, fora do caminho. Devolve o quanto a esquerda segura o pente.
   */
  private mpxInspect(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ): number {
    const P = MPX_INSPECT;
    const pre = hump(u, 0, 0.05, 0.05, 0.12);
    const s1 = hump(u, 0.05, 0.22, 0.46, 0.6);
    const s2 = hump(u, 0.46, 0.62, 0.8, 0.97);
    const d1 = (seg(u, 0.22, 0.46) - 0.5) * s1;
    const d2 = (seg(u, 0.62, 0.8) - 0.5) * s2;
    const settle = Math.sin(seg(u, 0.9, 1) * Math.PI) * (1 - seg(u, 0.9, 1));
    rot.y += (pre * 0.06 - s1 * P.yaw1 + s2 * P.yaw2 + d1 * 0.08) * mo;
    rot.z += (s1 * P.roll1 - s2 * P.roll2 + d2 * 0.08) * mo;
    rot.x += (-pre * 0.05 + s1 * P.pitch1 + s2 * P.pitch2 - settle * 0.05) * mo;
    pos.x += -s1 * P.x1 + s2 * P.x2;
    pos.y += s1 * P.y1 + s2 * P.y2 - pre * 0.01;
    pos.z += pre * 0.015 - s1 * P.push1 - s2 * P.push2;
    joltAt('grab', 0.6, 0.8);
    joltAt('home', 0.97, 1);
    return hump(u, 0.48, 0.6, 0.8, 0.93);
  }

  /**
   * Golpe com a MPX (antes: a arma ia para a frente sem antecipação e ficava parada 25% do tempo): recua e cai para a
   * direita, sai rápida para a frente e para a esquerda rolando (acerto a 30%, com tranco e um rebote curto) e volta.
   */
  private mpxMelee(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    const pre = hump(u, 0, 0.14, 0.14, 0.28);
    const hit = ease(seg(u, 0.14, 0.3)) * (1 - ease(seg(u, 0.36, 0.92)));
    // o tranco do acerto: a arma volta um pouco logo depois de bater
    const back = hump(u, 0.3, 0.36, 0.36, 0.5);
    pos.z += 0.03 * pre - 0.16 * hit + 0.02 * back;
    pos.x += 0.025 * pre - 0.08 * hit;
    pos.y -= 0.01 * pre;
    rot.z += (-0.2 * pre + 0.6 * hit) * mo;
    rot.x += (0.12 * pre - 0.06 * hit) * mo;
    rot.y += (-0.1 * pre + 0.15 * hit) * mo;
    joltAt('hit', 0.3, -1.4);
  }

  /**
   * Uma animação da balisong (`BalTracks`) no momento `u`: o braço anda e gira em volta da faca, o antebraço vira, ela
   * fecha e abre nos pinos e os dedos soltam. Com "reduzir movimento" (`full` falso), ela fica aberta e os dedos fechados.
   */
  private balisongPlay(t: BalTracks, u: number, full: boolean, pos: THREE.Vector3) {
    pos.x += track(u, t.px);
    pos.y += track(u, t.py);
    pos.z += track(u, t.pz);
    KD.ex += track(u, t.ex);
    KD.ey += track(u, t.ey);
    KD.ez += track(u, t.ez);
    KD.pro += track(u, t.pro);
    KD.shut = full ? track(u, t.shut) : 0;
    KD.open = full ? track(u, t.open) : 0;
    KD.lx += track(u, t.lx);
    KD.ly += track(u, t.ly);
    KD.lz += track(u, t.lz);
  }

  /**
   * A esquerda de guarda com faca: baixa à esquerda, meio fechada, respirando e balançando com o passo e o mouse; na
   * corrida desce, e as animações da faca a deslocam (`KD.l*`). A conta é no espaço da câmera e vai para o da arma, onde
   * a mão mora.
   */
  private knifeGuard(now: number, inp: VmInput, mo: number) {
    const bobA = inp.moving * (inp.crouch ? 0.6 : 1) * mo;
    const bay = this.gun?.id === 'bayonet';
    const bw = this.gun?.id === 'bowie';
    GL.copy(bay ? BAY_GUARD.at : bw ? BOWIE_GUARD_L : GUARD_L);
    GL.x += Math.sin(this.bob + 0.6) * 0.01 * bobA + this.swayX * 0.04 + KD.lx;
    GL.y +=
      Math.abs(Math.cos(this.bob + 0.6)) * -0.01 * bobA +
      Math.sin(now / 900 + 0.8) * 0.003 * mo -
      this.swayY * 0.04 -
      (bw ? 0.12 : 0.08) * this.sprintK +
      KD.ly;
    GL.z += 0.04 * this.sprintK + KD.lz;
    this.handL.root.position.copy(this.holder.worldToLocal(GL));
    this.holder.getWorldQuaternion(HQ);
    const bal = !!this.gun?.flip;
    this.handL.root.quaternion.copy(
      HQ.invert().multiply(bay ? BAY_GUARD.quat : bal ? BAL_GUARD_Q : bw ? BOWIE_GUARD_Q : GUARD_Q),
    );
    // mão solta, sem cerrar (cerrada, virava um toco): os dedos em cascata e o polegar ao lado do indicador
    // baioneta, balisong, Bowie, Ka-Bar e kukri: os dedos da esquerda de cada uma (a Ka-Bar e a kukri num punho meio
    // fechado: a garra aberta parecia segurar uma bola invisível)
    if (bay) this.handL.setCurl(BAY_GUARD.curl, BAY_GUARD.thumb, BAY_GUARD.index);
    else if (bal) this.handL.setCurl(BAL_GUARD.curl, BAL_GUARD.thumb, BAL_GUARD.index);
    else if (bw) this.handL.setCurl(0.6, 0.3, 0.48);
    else if (this.gun?.id === 'kabar') this.handL.setCurl(KABAR_GUARD_L.curl, KABAR_GUARD_L.thumb, KABAR_GUARD_L.index);
    else {
      const gc = this.gun?.id === 'kukri' ? KUK_GUARD_CURL : null;
      this.handL.setCurl(gc?.[0] ?? GUARD_CURL, gc?.[1] ?? GUARD_THUMB, gc?.[2] ?? GUARD_INDEX);
    }
  }

  /** os acertos dos dedos da direita: os da pegada, indo para os da alavanca; soltos no pente-lâmina */
  private rightOffsets(toLever: number, onTrigger: number, clip: number, open = 0): FingerOffsets {
    const h = this.holds;
    // faca: o acerto medido no cabo; a karambit solta ele junto com os dedos quando gira
    if (!h && open <= 0) return this.knifeOff;
    if (!h) {
      for (let i = 0; i < 6; i++) OFF_R[i] = (this.knifeOff[i] ?? 0) * (1 - open);
      return OFF_R;
    }
    const th = this.gun ? RIGHT_THUMB[this.gun.id] : undefined;
    for (let i = 0; i < 6; i++) {
      // o acerto do indicador é o do gatilho: fora dele (correndo, recarregando), não vale
      let grip = (h.right.off[i] ?? 0) * (i === 0 ? onTrigger : 1);
      if (th && i === 4) grip = th[0] - h.right.curl[1];
      if (th && i === 5) grip = th[1];
      OFF_R[i] = lerp(grip, h.pinch?.off[i] ?? 0, toLever) * (1 - clip);
    }
    // Kar98k, no pente-lâmina: o polegar aberto para o lado, deitado de través em cima das balas
    if (clip > 0) OFF_R[5] += CLIP_THUMB_AB * clip;
    return OFF_R;
  }

  /** os acertos dos dedos da esquerda: apoio, pente, gesto da recarga vazia; soltos empurrando a base ou fora */
  private leftOffsets(mag: number, gesture: number, palm: number, away: number): FingerOffsets {
    const h = this.holds;
    if (!h) return NO_OFF;
    for (let i = 0; i < 6; i++) {
      let o = lerp(h.left.off[i] ?? 0, h.mag?.off[i] ?? 0, mag);
      o = lerp(o, this.egOff[i] ?? 0, gesture);
      OFF_L[i] = o * (1 - palm) * (1 - away);
    }
    return OFF_L;
  }

  /**
   * Peças da recarga desta arma (no `setGun`): a alavanca parada (a mão anda junto com ela), a cópia do pente vazio
   * que cai, o pente-lâmina da Kar98k e o acerto do gesto da recarga vazia (palma encostada na peça).
   */
  private prepareGunParts(g: GunModel, spec: GunSpec) {
    this.disposeExtras();
    this.holder.updateMatrixWorld(true);
    const handle = g.parts.boltRot ?? (g.id === 'kar98k' ? g.parts.charge : undefined);
    if (handle) {
      movePart(handle, V.set(0, 0, 0));
      handle.obj.updateMatrixWorld(true);
      this.handleRestInv.copy(holderSpace(handle.obj, this.holder, M1)).invert();
    }
    this.magGhost = magMesh(g);
    const cyl = spec.revolver && g.parts.mag ? partBox(g, g.parts.mag) : null;
    if (cyl) {
      // os furos ficam a ~30% do diâmetro do tambor a partir do eixo
      const size = cyl.getSize(V);
      const ring = 0.3 * Math.min(size.x, size.y);
      this.loader = speedLoader(spec.mag, ring).root;
      this.holder.add(this.loader);
      this.loaderSeat.set((cyl.min.x + cyl.max.x) / 2, (cyl.min.y + cyl.max.y) / 2, cyl.max.z);
      this.bfrRing = ring;
      this.bfrFront = cyl.min.z + 0.004;
    }
    // BFR: o cão separado da armação (o polegar arma antes de cada tiro), armado
    if (g.id === 'bfr') {
      this.bfrHam = splitHammer(g);
      this.bfrCocked = 1;
      this.bfrCockT = Number.NaN;
      if (this.bfrHam) poseHammer(this.bfrHam, 1);
      this.bfrArm = craneArm();
      this.holder.add(this.bfrArm);
    }
    if (g.id === 'kar98k') {
      this.clip = stripperClip();
      this.holder.add(this.clip.root);
      // o polegar em cima do pente-lâmina e a palma por fora da caixa da culatra (o acerto só afasta a palma se ela
      // entrar; os dedos ficam na pose fixa, medida sem entrar na coronha)
      const at = CLIP_GUIDE.clone().add(CLIP_HAND);
      // medido com o ferrolho aberto (para trás, ele fica embaixo da mão)
      const q = this.holds?.right.quat ?? this.handR.root.quaternion;
      const h = fitAt(g, 1, at, q.clone(), [...CLIP_CURL], () => {
        movePart(g.parts.bolt, V.set(0, 0, 0.09), 0);
        movePart(g.parts.charge, V.set(0, 0, 0.09));
      });
      movePart(g.parts.bolt, V.set(0, 0, 0), 0);
      movePart(g.parts.charge, V.set(0, 0, 0));
      this.clipHand.copy(h.pos).sub(CLIP_GUIDE);
    }
    // o gesto da recarga vazia no pico (a mão na peça): mede o encaixe ali e guarda o acerto
    this.egFix.set(0, 0, 0);
    this.egOff = NO_OFF;
    const peak: Partial<Record<string, number>> = { slap: 0.76, under: 0.72, front: 0.72 };
    const at = peak[EMPTY_GESTURE[g.id] ?? ''];
    if (at !== undefined && spec.cls !== 'pistol') {
      this.emptyGesture(at, () => {});
      const q = EG.alt > 0 ? EG.altQ : this.leftQ;
      const h = fitAt(g, -1, EG.at.clone(), q.clone(), [EG.curl, EG.thumb, EG.curl]);
      this.egFix.copy(h.pos).sub(EG.at);
      this.egOff = h.off;
    }
    // StG 44: o vão dos dedos fechados na haste da alavanca e os dedos fechando até encostar nela
    if (EMPTY_GESTURE[g.id] === 'hook') {
      this.hookAt.copy(HOOK_AT).sub(FIST_HOLE.clone().applyQuaternion(HOOK_Q));
      const f = fitHand(soupOf(g.root, { at: HOOK_AT, r: 0.18 }), -1, this.hookAt, HOOK_Q, [0.5, 0.6, 0.5], {
        fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
        maxCurl: 1.4,
      });
      this.hookAt.copy(f.pos);
      this.egOff = [
        f.offsets[0] + 0.5 - 0.95,
        f.offsets[1] + 0.5 - 0.95,
        f.offsets[2] + 0.5 - 0.95,
        f.offsets[3] + 0.5 - 0.95,
        f.offsets[4],
        0,
      ];
    }
    // AKS-74U: a direita na alavanca, de punho fechado (os dedos fecham até encostar na lateral da caixa; sem isso,
    // fechados, eles entravam ~3 cm nela); vira a pegada de alavanca dela
    if (EMPTY_GESTURE[g.id] === 'rack' && this.chargeHome && this.holds) {
      const at = this.chargeHome.clone().add(RACK_AT_OF[g.id] ?? RACK_AT);
      const f = fitHand(soupOf(g.root, { at, r: 0.18 }), 1, at, RACK_Q, PINCH, {
        fingers: ['index', 'middle', 'ring', 'pinky', 'thumb'],
      });
      this.holds.pinch = { pos: at, quat: RACK_Q.clone(), curl: [...PINCH], off: f.offsets };
    }
  }

  /**
   * O carregador rápido: aparece na mão quando ela volta do cinto, os cartuchos na frente dos dedos; encosta atrás do
   * tambor aberto, alinhado com os furos, e empurra os cartuchos para dentro (no som deles); depois sai junto com a mão
   * (some — os cartuchos ficam no tambor).
   */
  private placeLoader(u: number) {
    const ld = this.loader;
    if (!ld || this.gun?.id === 'rhino') return;
    ld.visible = u >= LOADER_SHOW && u < LOADER_GONE;
    if (!ld.visible) return;
    const seat = ease(seg(u, LOADER_SHOW + 0.06, LOADER_SHOW + 0.14));
    const push = ease(seg(u, LOADER_SHOW + 0.14, MAG_SEAT_AT));
    // na mão: à frente da palma, onde os dedos fecham nele
    W1.copy(LOADER_IN_HAND).applyQuaternion(this.handL.root.quaternion).add(this.handL.root.position);
    // no tambor (que está fora, deslocado por `MAG`): os cartuchos ainda atrás dos furos, depois dentro
    V.copy(this.loaderSeat)
      .add(MAG)
      .add(W2.set(0, 0, 0.03 * (1 - push)));
    ld.position.copy(W1).lerp(V, seat);
    ld.quaternion.identity();
  }

  /**
   * BFR: o carregador rápido na mão desde o cinto (os cartuchos para a frente, girados para os furos do tambor), atrás
   * do tambor e empurrando; largado, o corpo vazio cai e os cartuchos ficam nos furos (girando com o tambor) até ele
   * fechar.
   */
  private placeBfrLoader(u: number, spin: number) {
    const ld = this.loader;
    if (!ld) return;
    ld.visible = u >= BFR_LOADER_SHOW && u < BFR_CLOSE_AT;
    if (!ld.visible) return;
    // o primeiro cartucho no furo de cima (90°), com o tambor girado `spin`
    BFR_Q.setFromAxisAngle(Z_AXIS, Math.PI / 2 + spin);
    const held = u < BFR_LOADER_DROP;
    if (held) {
      ld.position.copy(BFR_IN_HAND).applyQuaternion(this.handL.root.quaternion).add(this.handL.root.position);
      ld.quaternion.copy(this.handL.root.quaternion).multiply(BFR_LQ_INV).multiply(BFR_Q);
    } else {
      ld.position.copy(this.loaderSeat).add(MAG);
      ld.quaternion.copy(BFR_Q);
    }
    // os dois primeiros filhos são o disco e o botão (o corpo); os outros, os cartuchos
    const kids = ld.children;
    for (let i = 0; i < kids.length; i++) kids[i]!.visible = held || i >= 2;
    if (!held && !this.bfrDropped) {
      this.bfrDropped = true;
      const body = ld.clone();
      for (let i = 0; i < body.children.length; i++) body.children[i]!.visible = i < 2;
      ld.updateMatrixWorld(true);
      this.toss(body, ld.matrixWorld, V.set(-0.35, -0.3, 0.25), W1.set(2.5, 1, 4));
    }
  }

  /**
   * Rhino: o carregador rápido fica na mão do cinto até cair. A mão (com ele nos dedos) vai para trás do tambor aberto,
   * alinha, empurra os cartuchos (no som deles), gira o botão, puxa o carregador vazio para trás e para fora e solta;
   * depois volta para baixo do tambor e o fecha. `u` é a fração da recarga (−1 fora dela).
   */
  private rhinoLoader(u: number): number {
    const ld = this.loader;
    if (!ld) return 0;
    if (u >= RHINO_LOADER_TOSS && !this.joltDone.has('loader')) {
      this.joltDone.add('loader');
      const empty = ld.clone();
      empty.children.forEach((c, i) => (c.visible = i < 2));
      this.toss(empty, ld.matrixWorld, V.set(-0.5, -0.4, 0.15), W1.set(3, 1.5, 5));
    }
    ld.visible = u >= LOADER_SHOW && u < RHINO_LOADER_TOSS;
    if (!ld.visible) return 0;
    const hand = this.handL.root;
    // volta do cinto já virando a mão para pegar o carregador pela esquerda
    const side = ease(seg(u, 0.44, 0.54)) * (1 - ease(seg(u, RHINO_LOADER_TOSS, 0.76)));
    hand.quaternion.slerp(RHINO_LOADER_Q, side);
    // nos dedos, à frente da palma
    W1.copy(LOADER_IN_HAND).applyQuaternion(hand.quaternion).add(hand.position);
    // a mão anda até o carregador ficar alinhado atrás dos furos do tambor (que está fora, deslocado por `MAG`) e
    // empurra; puxa de volta o vazio e volta para baixo do tambor
    const align = ease(seg(u, 0.5, 0.57)) * (1 - ease(seg(u, RHINO_LOADER_TOSS, 0.76)));
    const push = ease(seg(u, 0.57, MAG_SEAT_AT));
    V.copy(this.loaderSeat)
      .add(MAG)
      .add(W2.set(0, 0, 0.03 * (1 - push)))
      .sub(W1)
      .multiplyScalar(align)
      .addScaledVector(RHINO_PULL, hump(u, 0.61, 0.66, RHINO_LOADER_TOSS, 0.76));
    hand.position.add(V);
    ld.position.copy(W1).add(V);
    // o polegar gira o botão e solta os cartuchos, que ficam no tambor
    ld.quaternion.setFromAxisAngle(Z_AXIS, 0.6 * ease(seg(u, MAG_SEAT_AT, 0.62)));
    for (let i = 2; i < ld.children.length; i++) ld.children[i]!.visible = u < MAG_SEAT_AT;
    return side;
  }

  /** solta o que a arma anterior deixou (pente que caía, pente-lâmina) */
  private disposeExtras() {
    this.clearDebris();
    if (this.magGhost) disposeOwnGeo(this.magGhost);
    this.magGhost = null;
    if (this.clip) {
      this.clip.root.removeFromParent();
      disposeTree(this.clip.root);
    }
    this.clip = null;
    if (this.loader) {
      this.loader.removeFromParent();
      disposeTree(this.loader);
    }
    this.loader = null;
    if (this.bfrArm) {
      this.bfrArm.removeFromParent();
      disposeTree(this.bfrArm);
    }
    this.bfrArm = null;
  }

  /** as peças soltas são cópias (geometria do pente vazio e do pente-lâmina, liberadas com eles) */
  private clearDebris() {
    for (const d of this.debris) d.obj.removeFromParent();
    this.debris.length = 0;
  }

  /**
   * Solta uma peça (cópia) no espaço da câmera: começa na matriz `world` (onde ela está na arma agora) e cai com a
   * velocidade `vel` (espaço da arma) e o giro `spin`; some depois de `DEBRIS_MS` (já saiu da tela).
   */
  private toss(obj: THREE.Object3D, world: THREE.Matrix4, vel: THREE.Vector3, spin: THREE.Vector3) {
    if (this.debris.length >= DEBRIS_MAX) {
      const old = this.debris.shift()!;
      old.obj.removeFromParent();
    }
    world.decompose(obj.position, obj.quaternion, obj.scale);
    this.holder.getWorldQuaternion(Q1);
    this.scene.add(obj);
    obj.visible = true;
    this.debris.push({ obj, vel: vel.clone().applyQuaternion(Q1), spin: spin.clone(), t: 0 });
  }

  /** as peças soltas caindo (espaço da câmera: o "para baixo" é o da tela, e elas saem dela em ~0,4 s) */
  private stepDebris(dt: number) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.t += dt * 1000;
      d.vel.y -= DEBRIS_G * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.t < DEBRIS_MS) continue;
      d.obj.removeFromParent();
      this.debris.splice(i, 1);
    }
  }

  /** um estojo sai pela janela de ejeção (espaço da câmera), para o `game.ts` levar para o mundo */
  private eject(bolt: boolean) {
    const g = this.gun;
    const port = g ? PORT[g.id] : undefined;
    if (!g || !port || this.ejects.length >= EJECT_MAX) return;
    this.holder.updateMatrixWorld(true);
    const at = this.holder.localToWorld(new THREE.Vector3(...port));
    this.holder.getWorldQuaternion(Q1);
    const kind = ejectKind(g.id, bolt);
    const vel = ejectVelocity(kind, Math.random(), Math.random(), Math.random(), new THREE.Vector3()).applyQuaternion(
      Q1,
    );
    const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(Q1);
    this.ejects.push({ at, vel, axis, kind });
  }

  /**
   * Revólver: os estojos vazios saem do tambor aberto (espaço da câmera) e caem para baixo, quase juntos, um pouco
   * espalhados (até o limite de peças soltas por quadro).
   */
  private dumpCylinder() {
    const g = this.gun;
    const cyl = g?.parts.mag?.obj;
    if (!g || !cyl || !this.spec) return;
    this.holder.updateMatrixWorld(true);
    const c = cyl.getWorldPosition(new THREE.Vector3());
    this.holder.getWorldQuaternion(Q1);
    const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(Q1);
    const kind: EjectKind = g.id === 'bfr' ? 'rifle' : 'pistol';
    const n = Math.min(this.spec.mag, EJECT_MAX - this.ejects.length);
    // BFR: saem dos furos (no raio deles), pela face de trás do tambor
    const ring = g.id === 'bfr' ? this.bfrRing : 0.012;
    const back = g.id === 'bfr' ? 0.045 : 0;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const at = new THREE.Vector3(Math.cos(a) * ring, Math.sin(a) * ring, back).applyQuaternion(Q1).add(c);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.6 - Math.random() * 0.5, 0.1 + Math.random() * 0.2);
      this.ejects.push({ at, vel, axis: axis.clone(), kind });
    }
  }

  /** o gesto da recarga vazia no momento `u` (0–1): preenche `EG` (ver `EMPTY_GESTURE`) */
  /**
   * Golpe da AK-47 (coronhada curta com a arma inteira): antecipação (a arma recolhe para trás e para a direita,
   * armando o giro), estocada rápida para a frente e para a esquerda rolando a arma no acerto (30%), tranco, um
   * instante parada e volta desacelerando, passando um pouco do ponto.
   */
  private akMelee(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    const pre = hump(u, 0, 0.15, 0.17, 0.3);
    const hit = ease(seg(u, 0.15, 0.3)) * (1 - ease(seg(u, 0.4, 0.92)));
    const settle = Math.sin(seg(u, 0.82, 1) * Math.PI) * (1 - seg(u, 0.82, 1));
    pos.z += 0.045 * pre - 0.17 * hit + 0.012 * settle;
    pos.x += 0.025 * pre - 0.1 * hit;
    pos.y += 0.012 * pre + 0.02 * hit;
    rot.z += (-0.18 * pre + 0.5 * hit) * mo;
    rot.y += (-0.1 * pre + 0.18 * hit) * mo;
    rot.x += (0.08 * pre - 0.06 * hit - 0.03 * settle) * mo;
    joltAt('hit', 0.3, 2.2);
  }

  private emptyGesture(u: number, joltAt: (key: string, at: number, v: number) => void) {
    EG.bolt = EG.charge = EG.chargeRot = EG.boltRot = EG.rightK = EG.thumbR = EG.alt = EG.out = 0;
    EG.altQ = SIDE_Q;
    EG.present = 0;
    EG.arc.copy(ARC_OUT);
    const kind = this.gun ? EMPTY_GESTURE[this.gun.id] : undefined;
    const ch = this.chargeHome;
    switch (kind) {
      case 'slap': {
        // o ferrolho ficou aberto: a palma bate no retém pela esquerda e ele fecha
        EG.bolt = u < 0.76 ? 0.05 : 0;
        EG.alt = hump(u, 0.64, 0.72, 0.8, 0.9);
        EG.at.copy(this.slapAt).add(V.set(-0.012 * (1 - ease(seg(u, 0.7, 0.76))), 0, 0));
        EG.curl = 0.25;
        EG.thumb = 0.25;
        EG.out = 0.3;
        joltAt('release', 0.76, 2);
        break;
      }
      case 'under': {
        // a mão passa por baixo do receptor, palma para cima, os dedos puxam a alavanca da direita e soltam
        if (!ch) break;
        const pull = hump(u, 0.7, 0.75, 0.77, 0.82);
        EG.charge = EG.bolt = pull * 0.07;
        EG.alt = hump(u, 0.64, 0.7, 0.82, 0.9);
        EG.altQ = this.leftQ;
        // à frente do poço do pente (atrás, a palma entrava no pente ao puxar)
        EG.at.copy(ch).add(V.set(-0.075, -0.05, -0.065 + EG.charge));
        EG.curl = 0.92;
        EG.thumb = 0.8;
        joltAt('release', 0.82, 2);
        break;
      }
      case 'rack': {
        if (!ch) break;
        const pull = ease(seg(u, 0.71, 0.76));
        const release = ease(seg(u, 0.78, 0.795));
        EG.charge = EG.bolt = RACK_PULL * pull * (1 - release);
        EG.rightK = hump(u, 0.63, 0.7, 0.8, 0.9);
        // a mão anda com a alavanca até soltar; depois fica atrás (o ferrolho volta sem ela)
        EG.rat
          .copy(ch)
          .add((this.gun && RACK_AT_OF[this.gun.id]) ?? RACK_AT)
          .add(V.set(0, 0, RACK_PULL * pull));
        joltAt('release', 0.79, 2);
        break;
      }
      case 'front': {
        // alavanca da frente, à esquerda do tubo: a mão vai pela lateral, puxa para trás e solta com um tapa
        if (!ch) break;
        const pull = hump(u, 0.7, 0.74, 0.76, 0.8);
        EG.charge = EG.bolt = pull * 0.06;
        EG.alt = hump(u, 0.64, 0.7, 0.82, 0.9);
        EG.at.copy(ch).add(V.set(-0.02 - PALM_HALF, -0.01, 0.046 + EG.charge));
        EG.curl = 0.85;
        EG.thumb = 0.7;
        EG.out = 0.4;
        joltAt('release', 0.8, 2);
        break;
      }
      case 'hook': {
        const pull = ease(seg(u, 0.7, 0.75));
        const snap = ease(seg(u, 0.765, 0.78));
        EG.charge = EG.bolt = HOOK_PULL * pull * (1 - snap);
        EG.alt = hump(u, 0.6, 0.68, 0.82, 0.9);
        EG.altQ = HOOK_Q;
        // a mão fica atrás depois de soltar (e abre um pouco); a alavanca volta sem ela
        EG.at.copy(this.hookAt).add(V.set(0, 0.004 * snap, HOOK_PULL * pull + 0.012 * snap));
        EG.curl = lerp(0.95, 0.7, snap);
        EG.thumb = 0.6;
        EG.out = 0.3;
        joltAt('release', 0.78, 2);
        break;
      }
      case 'hk':
        if (ch) hkGesture(u, ch, SIDE_Q, EG, joltAt);
        break;
      case 'pistol':
        // o ferrolho ficou aberto: o polegar direito aperta o retém e ele fecha (a mão esquerda não sai do apoio)
        EG.bolt = u < 0.8 ? 0.035 : 0;
        EG.thumbR = hump(u, 0.72, 0.77, 0.8, 0.86);
        joltAt('release', 0.8, 2);
        break;
      case 'bolt':
        // sniper: depois do pente, a mão direita trabalha o ferrolho
        EG.rightK = hump(u, 0.64, 0.7, 0.9, 0.97);
        EG.boltRot = hump(u, 0.7, 0.75, 0.84, 0.88) * 1.2;
        EG.bolt = hump(u, 0.75, 0.79, 0.8, 0.84) * 0.09;
        joltAt('release', 0.86, 1.8);
        break;
    }
    // a palma encostada na peça (o acerto medido no `setGun`)
    EG.at.add(this.egFix);
  }

  /**
   * Inspeção da Desert Eagle, com o peso dela: a esquerda solta o punho, a arma dá um pequeno mergulho (antecipação),
   * vira e mostra o lado direito com o cano para a direita (para), atravessa pesada pela frente (o cano cai um pouco no
   * meio do caminho), mostra o lado esquerdo com o cano para a esquerda (para), volta passando um pouco do ponto e a
   * esquerda bate de volta no punho. Devolve o quanto a esquerda está fora (0–1).
   */
  private deagleInspect(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ): number {
    const pre = hump(u, 0, 0.05, 0.06, 0.13);
    const toA = ease(seg(u, 0.08, 0.28));
    const toB = ease(seg(u, 0.44, 0.64));
    const home = ease(seg(u, 0.8, 0.94));
    const swing = hump(u, 0.44, 0.54, 0.54, 0.64);
    const settle = Math.sin(seg(u, 0.9, 1) * Math.PI) * (1 - seg(u, 0.9, 1));
    const out = toA * (1 - home);
    rot.y += lerp(-0.95 * toA, 1.05, toB) * (1 - home) * mo;
    rot.z += lerp(0.3 * toA, -0.3, toB) * (1 - home) * mo;
    rot.x += (0.12 * out - 0.16 * swing - 0.05 * pre - 0.06 * settle) * mo;
    pos.x -= 0.05 * out;
    pos.y += 0.03 * out - 0.012 * swing - 0.01 * pre;
    pos.z += 0.02 * out;
    joltAt('showA', 0.28, 0.6);
    joltAt('showB', 0.64, 0.8);
    joltAt('grab', 0.94, 1.4);
    return hump(u, 0.02, 0.12, 0.84, 0.94);
  }

  /**
   * Coronhada da Desert Eagle: a esquerda solta, a arma arma o golpe para trás e para a direita (antecipação), bate
   * para a frente e para a esquerda virando de lado (o tranco no acerto), segue um pouco e volta; a esquerda volta ao
   * punho no fim. Devolve o quanto a esquerda está fora (0–1).
   */
  private deagleBash(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ): number {
    const wind = hump(u, 0, 0.18, 0.2, 0.32);
    const hit = hump(u, 0.18, 0.34, 0.4, 0.82);
    // depois do acerto a arma ainda anda um pouco no mesmo sentido, desacelerando (sem ficar parada no fim do golpe)
    const follow = ease(seg(u, 0.34, 0.5)) * (1 - ease(seg(u, 0.5, 0.86)));
    const settle = Math.sin(seg(u, 0.82, 1) * Math.PI) * (1 - seg(u, 0.82, 1));
    pos.x += 0.03 * wind - 0.1 * hit - 0.025 * follow;
    pos.y += 0.015 * wind + 0.01 * hit;
    pos.z += 0.03 * wind - 0.12 * hit;
    rot.z += (-0.3 * wind + 0.75 * hit + 0.18 * follow) * mo;
    rot.y += (-0.2 * wind + 0.45 * hit + 0.08 * follow) * mo;
    rot.x += (0.12 * wind - 0.15 * hit + 0.04 * settle) * mo;
    joltAt('hit', 0.34, -1.6);
    return hump(u, 0.02, 0.15, 0.7, 0.92);
  }

  /** desenha por cima do que já está na tela */
  render(r: THREE.WebGLRenderer, visible: boolean) {
    if (!visible || !this.gun) return;
    const auto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }

  /** libera tudo: a arma, os braços e o clarão */
  dispose() {
    this.authored?.dispose();
    this.authored = null;
    if (this.gun) disposeGun(this.gun);
    this.gun = null;
    this.arms.dispose();
    this.flash.geometry.dispose();
    this.flash.material.dispose();
    this.flashLight.dispose();
  }
}

/**
 * O pivô e o eixo do giro da faca na mão (espaço da faca). Karambit: o centro da argola (a malha em anel do modelo) e o
 * eixo dela, por onde passa o indicador. Baioneta (ou sem argola): o meio do cabo, no eixo perpendicular à lâmina.
 */
function knifeSpinFrame(g: GunModel, pivot: THREE.Vector3, axis: THREE.Vector3) {
  pivot.copy(g.handle ?? V.set(0, 0, 0));
  axis.set(1, 0, 0);
  g.root.position.set(0, 0, 0);
  g.root.quaternion.identity();
  g.root.updateMatrixWorld(true);
  let ring: THREE.Mesh | null = null;
  g.root.traverse((o) => {
    if (!ring && o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry) ring = o;
  });
  const r = ring as THREE.Mesh | null;
  if (!r) return;
  r.geometry.computeBoundingBox();
  const box = r.geometry.boundingBox;
  if (box) box.getCenter(pivot);
  pivot.applyMatrix4(r.matrix);
  // o furo do anel aponta para o lado mais fino da caixa dele (a geometria já vem girada no modelo)
  if (box) {
    const sz = box.getSize(W1);
    if (sz.x <= sz.y && sz.x <= sz.z) axis.set(1, 0, 0).transformDirection(r.matrix);
    else if (sz.y <= sz.z) axis.set(0, 1, 0).transformDirection(r.matrix);
    else axis.set(0, 0, 1).transformDirection(r.matrix);
  }
}

/** a matriz de um objeto no espaço do `holder` (a arma) */
function holderSpace(o: THREE.Object3D, holder: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  return out.copy(holder.matrixWorld).invert().multiply(o.matrixWorld);
}

/** libera só as geometrias feitas para esta cópia (o material é da arma) */
function disposeOwnGeo(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh && x.userData.ownGeo) x.geometry.dispose();
  });
}

/** libera geometrias e materiais de um grupo feito aqui (o pente-lâmina) */
function disposeTree(o: THREE.Object3D) {
  const done = new Set<object>();
  o.traverse((x) => {
    if (!(x instanceof THREE.Mesh)) return;
    if (!done.has(x.geometry)) {
      done.add(x.geometry);
      x.geometry.dispose();
    }
    const m = x.material as THREE.Material;
    if (!done.has(m)) {
      done.add(m);
      m.dispose();
    }
  });
}

/** a posição de uma peça agora, no espaço do `holder` (a arma) */
function partNow(p: Part, holder: THREE.Object3D, out: THREE.Vector3) {
  p.obj.getWorldPosition(out);
  return holder.worldToLocal(out);
}
/** a posição da peça parada (o pente no lugar) */
function partHome(p: Part, holder: THREE.Object3D, out: THREE.Vector3) {
  movePart(p, V.set(0, 0, 0));
  p.obj.updateMatrixWorld(true);
  return partNow(p, holder, out);
}

/**
 * Coronhada da SCAR-L (`BASH`: 500 ms, acerto em 160 ms = 32%): a arma recua e cai para a direita (antecipação), sai
 * rápida para a frente e para a esquerda rolando a lateral para o alvo, segura um instante e volta devagar
 */
function scarBash(u: number, mo: number, pos: THREE.Vector3, rot: THREE.Euler) {
  const pre = hump(u, 0, 0.16, 0.16, 0.3);
  const hit = ease(seg(u, 0.14, 0.32)) * (1 - ease(seg(u, 0.42, 0.96)));
  pos.z += 0.035 * pre - 0.16 * hit;
  pos.x += 0.025 * pre - 0.085 * hit;
  pos.y += -0.012 * pre - 0.005 * hit;
  rot.z += (-0.18 * pre + 0.65 * hit) * mo;
  rot.x += (0.12 * pre - 0.06 * hit) * mo;
  rot.y += (-0.06 * pre + 0.14 * hit) * mo;
}

/** os dois lados da inspeção da SCAR-L: giro (rad) e deslocamento (m) */
const SCAR_S1 = { yaw: 0.7, roll: 0.4, pitch: 0.05, x: 0.01, y: 0.03, z: -0.07 };
const SCAR_S2 = { yaw: 0.5, roll: 0.35, pitch: 0.12, x: -0.06, y: 0.03, z: -0.05 };
/**
 * Inspeção da SCAR-L (2400 ms): um pequeno recuo (antecipação), a arma vira e mostra o lado direito com a janela de
 * ejeção (para), cruza para o lado esquerdo com a alavanca de manejo e o pente (para; a esquerda segura o pente) e volta
 * direto para casa, passando um pouco do ponto. A arma vai mais para a frente que nas outras (a caixa e a coronha da
 * SCAR são altas e tapavam metade da tela). Devolve quanto a esquerda está no pente (0–1).
 */
function scarInspect(u: number, mo: number, pos: THREE.Vector3, rot: THREE.Euler): number {
  const pre = hump(u, 0, 0.05, 0.06, 0.14);
  const s1 = hump(u, 0.05, 0.22, 0.4, 0.54);
  // a arma vai para a frente antes de virar: virando no lugar, a coronha passava rente à câmera
  const f1 = hump(u, 0.03, 0.15, 0.4, 0.54);
  const s2 = hump(u, 0.44, 0.6, 0.78, 0.93);
  const settle = Math.sin(seg(u, 0.9, 1) * Math.PI) * (1 - seg(u, 0.9, 1));
  rot.y += (pre * 0.08 - s1 * SCAR_S1.yaw + s2 * SCAR_S2.yaw) * mo;
  rot.z += (s1 * SCAR_S1.roll - s2 * SCAR_S2.roll) * mo;
  rot.x += (s1 * SCAR_S1.pitch + s2 * SCAR_S2.pitch - settle * 0.04) * mo;
  pos.x += f1 * SCAR_S1.x + s2 * SCAR_S2.x;
  pos.y += f1 * SCAR_S1.y + s2 * SCAR_S2.y - pre * 0.008;
  pos.z += f1 * SCAR_S1.z + s2 * SCAR_S2.z + pre * 0.012;
  return hump(u, 0.46, 0.6, 0.78, 0.9);
}

function curlOf(h: ArmHand): [number, number, number] {
  return (h.root.userData.curl as [number, number, number] | undefined) ?? [0.8, 0.6, 0.8];
}
function setGrip(h: ArmHand, c: number, t: number, i: number) {
  h.root.userData.curl = [c, t, i];
  h.setCurl(c, t, i);
}

const ELBOW = new THREE.Vector3();
const SH = new THREE.Vector3();
const DIRV = new THREE.Vector3();
const POLE = new THREE.Vector3();
const W2 = new THREE.Vector3();
/**
 * O ombro no espaço da câmera. Com `over` (a mão por cima da arma), o ombro esquerdo abre para fora e para a frente: o
 * braço chega à alavanca vindo do lado, sem atravessar a tela na frente da arma.
 */
function shoulderAt(side: number, over: number, out: THREE.Vector3) {
  // o ombro esquerdo um pouco mais aberto: o antebraço de apoio entra pela diagonal do canto de baixo à esquerda
  const s = side < 0 ? SHOULDER_L : SHOULDER;
  return out.set(s.x * side * (1 + 0.7 * over), s.y + 0.05 * over, s.z - 0.1 * over);
}

/**
 * Braço de dois ossos no espaço da câmera: ombro fixo, pulso em `at`, cotovelo pela lei dos cossenos, dobrando para
 * baixo e para fora. O cotovelo nunca chega perto da câmera (senão a manga cobre a tela na corrida tática).
 */
export function solveElbow(at: THREE.Vector3, side: number, out: THREE.Vector3, over = 0): THREE.Vector3 {
  shoulderAt(side, over, SH);
  DIRV.copy(at).sub(SH);
  const d = Math.max(Math.abs(UPPER - FORE) + 1e-3, Math.min(UPPER + FORE - 1e-3, DIRV.length()));
  DIRV.normalize();
  const along = (UPPER * UPPER - FORE * FORE + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER * UPPER - along * along));
  // `over` (a mão por cima da arma, puxando a alavanca): o cotovelo vai mais para fora e para longe da câmera
  POLE.set(lerp(side * 0.7, side, over), lerp(-1, -0.6, over), lerp(0.15, 0, over));
  POLE.addScaledVector(DIRV, -POLE.dot(DIRV)).normalize();
  out.copy(SH).addScaledVector(DIRV, along).addScaledVector(POLE, h);
  out.z = Math.min(out.z, lerp(ELBOW_MAX_Z, ELBOW_MAX_Z_OVER, over));
  return out;
}

/**
 * O cotovelo pedido para o braço (`arms.ts` resolve do pulso para ele): o da IK de dois ossos a partir do ombro e,
 * com faca (`along`), o antebraço saindo do pulso na direção `alongDir` (do cotovelo para o pulso, que segue a mão):
 * o pulso fica reto com a mão em qualquer giro (pegada, saque, inspeção).
 */
function elbowHint(
  at: THREE.Vector3,
  side: number,
  out: THREE.Vector3,
  over = 0,
  along = 0,
  alongDir?: THREE.Vector3,
): THREE.Vector3 {
  solveElbow(at, side, out, over);
  if (along > 0 && alongDir) {
    W2.copy(at).addScaledVector(alongDir, -FORE);
    // num golpe a mão gira muito: o cotovelo nunca passa para o outro lado do pulso nem sobe acima dele (o braço
    // entraria pelo canto de cima ou pelo outro lado da tela, cobrindo a vista)
    W2.x = side > 0 ? Math.max(W2.x, at.x + 0.05) : Math.min(W2.x, at.x - 0.05);
    W2.y = Math.min(W2.y, at.y - 0.03);
    W2.z = Math.min(W2.z, ELBOW_MAX_Z);
    // a mão apontando para longe da câmera: o antebraço viria reto para o rosto (a manga cobre a tela); aí vale a IK
    out.lerp(W2, along * (1 - seg(-alongDir.z, 0.55, 0.8)));
  }
  return out;
}

/**
 * Inspeção da M4 no momento `u` (0–1), mexendo na pose (`pos`, `rot`) e no pente (`mag`); devolve o quanto a mão de
 * apoio está no pente. Um pequeno recuo (antecipação), a arma sobe um pouco para o meio e deita mostrando o lado
 * esquerdo (retém do ferrolho, do pente e seletor; pausa), rola para mostrar o lado direito e o topo (janela de ejeção)
 * enquanto a esquerda pega o pente e dá um puxão para conferir que está preso (pausa), e volta direto para o quadril,
 * passando um pouco do ponto. Os giros ficam pequenos o bastante para a coronha não tomar a tela (na conta das outras
 * armas longas, a arma virava ~60° e a coronha cobria metade da tela) e a volta não passa de novo pelo primeiro lado.
 */
function m4Inspect(
  u: number,
  mo: number,
  pos: THREE.Vector3,
  rot: THREE.Euler,
  mag: THREE.Vector3,
  joltAt: (key: string, at: number, v: number) => void,
): number {
  const pre = hump(u, 0, 0.04, 0.05, 0.12);
  const w = ease(seg(u, 0.05, 0.24)) * (1 - ease(seg(u, 0.78, 0.95)));
  const b = ease(seg(u, 0.44, 0.6));
  const settle = Math.sin(seg(u, 0.9, 1) * Math.PI) * (1 - seg(u, 0.9, 1));
  // nas pausas a arma não fica parada: um respiro lento de poucos graus
  const drift = Math.sin(u * Math.PI * 5) * 0.025 * w;
  pos.y -= 0.012 * pre;
  rot.z += 0.06 * pre * mo;
  rot.y += (lerp(M4_INSPECT_A.ry, M4_INSPECT_B.ry, b) * w + drift) * mo;
  rot.z += lerp(M4_INSPECT_A.rz, M4_INSPECT_B.rz, b) * w * mo;
  rot.x += (lerp(M4_INSPECT_A.rx, M4_INSPECT_B.rx, b) * w + drift * 0.5) * mo - settle * 0.05 * mo;
  pos.x += lerp(M4_INSPECT_A.px, M4_INSPECT_B.px, b) * w;
  pos.y += lerp(M4_INSPECT_A.py, M4_INSPECT_B.py, b) * w;
  pos.z += lerp(M4_INSPECT_A.pz, M4_INSPECT_B.pz, b) * w;
  joltAt('sideA', 0.24, 0.6);
  joltAt('sideB', 0.6, 0.6);
  // a esquerda no pente no segundo lado, com um puxão curto para baixo e o empurrão de volta
  const hold = hump(u, 0.5, 0.6, 0.72, 0.8);
  mag.y -= 0.004 * hump(u, 0.62, 0.65, 0.66, 0.69);
  joltAt('grab', 0.6, 0.5);
  joltAt('tug', 0.68, 0.9);
  return hold;
}
/**
 * Golpe com a M4 no momento `u` (0–1): arma recua para a direita e engatilha o giro (antecipação), bate para a frente
 * e para a esquerda girando a coronha para a frente (o cano vai para a esquerda), com tranco no impacto, segura um
 * instante e volta passando um pouco do ponto. Antes era um empurrão com a arma deitada, parada metade do tempo.
 */
function m4Bash(
  u: number,
  mo: number,
  pos: THREE.Vector3,
  rot: THREE.Euler,
  joltAt: (key: string, at: number, v: number) => void,
) {
  const wind = ease(seg(u, 0, 0.2)) * (1 - ease(seg(u, 0.2, 0.32)));
  const hit = expOut(seg(u, 0.2, 0.38)) * (1 - ease(seg(u, 0.46, 0.85)));
  const settle = Math.sin(seg(u, 0.8, 1) * Math.PI) * (1 - seg(u, 0.8, 1));
  pos.x += 0.03 * wind - 0.08 * hit;
  pos.y += -0.012 * wind + 0.03 * hit;
  pos.z += 0.04 * wind - 0.15 * hit;
  rot.y += (-0.22 * wind + 0.42 * hit) * mo;
  rot.z += (-0.12 * wind + 0.45 * hit) * mo;
  rot.x += (0.1 * wind - 0.28 * hit + 0.04 * settle) * mo;
  joltAt('hit', 0.36, 2);
}
/** as duas poses da inspeção da M4 (somadas à do quadril): o lado esquerdo e o lado direito com o topo */
const M4_INSPECT_A = { rx: 0.12, ry: 0.45, rz: -0.55, px: -0.06, py: 0.035, pz: -0.02 };
const M4_INSPECT_B = { rx: 0.32, ry: -0.6, rz: 0.4, px: -0.05, py: 0.05, pz: -0.08 };

/** põe a mão na pegada (posição, giro e dedos) e guarda os dedos para a animação voltar a eles */
function applyGrip(h: ArmHand, g: Grip) {
  h.root.position.copy(g.pos);
  h.root.quaternion.copy(g.quat);
  setGrip(h, g.curl[0], g.curl[1], g.curl[2]);
}

/**
 * O polegar da direita nas armas de animação feita à mão (MP7): dá a volta por trás do punho e deita na lateral
 * esquerda, atrás do gatilho e por cima dos dedos. O encaixe medido (`holds.ts`) deixava ele em pé do lado direito,
 * encostado na caixa (fechamento e abertura para o lado da palma conferidos no harness, vistos da câmera e da esquerda).
 */
const AUTHORED_THUMB: readonly [number, number] = [0.2, 1.1];
const THUMB_OFF: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
function authoredThumb(o: FingerOffsets): FingerOffsets {
  for (let i = 0; i < 4; i++) THUMB_OFF[i] = o[i] ?? 0;
  THUMB_OFF[4] = AUTHORED_THUMB[0];
  THUMB_OFF[5] = AUTHORED_THUMB[1];
  return THUMB_OFF;
}

/**
 * Armas longas que ficam na inspeção antiga (vira, rola para o outro lado e volta pelo primeiro), acertada em cima dela
 * por arma: RS9, StG 44, AK-47 e Ballista (`INSPECT_TUNE`). As outras sem inspeção própria usam o arco (`inspectArc`,
 * feito na MCX): na antiga, a coronha das armas compridas vinha para a câmera no segundo lado e a volta passava de novo
 * pelo primeiro.
 */
const OLD_INSPECT: ReadonlySet<string> = new Set(['rs9', 'stg44', 'ak47', 'ballista']);

/**
 * Acerto do arco por arma: `yaw` é o giro do primeiro lado (rad; o comum é 1) e `push` leva a arma para longe (m,
 * negativo) durante toda a inspeção. Snipers compridas (L115, SV-98): virando 1 rad, a coronha enchia a metade esquerda
 * da tela no primeiro lado; giram menos e vão para a frente antes de virar. MP7: a coronha esticada é comprida para a
 * arma, e perto da câmera ela atravessava a metade de baixo à esquerda; vai mais para longe (girando menos ela apontava
 * a soleira para a câmera).
 */
interface ArcTune {
  yaw: number;
  push: number;
}
const ARC_TUNE: Partial<Record<string, ArcTune>> = {
  l115: { yaw: 0.8, push: -0.15 },
  sv98: { yaw: 0.8, push: -0.15 },
  mp7: { yaw: 0.9, push: -0.15 },
};

/**
 * Inspeção em arco: antecipação curta, a arma vira e mostra o lado direito (para), depois o cano vai para a esquerda e
 * ela mostra o lado esquerdo e o pente (a mão de apoio vai nele) quase sem empinar, com a coronha saindo pela direita
 * da tela, e volta direto da segunda pose para o lugar, passando um pouco do ponto. Devolve o quanto a esquerda segura
 * o pente.
 */
function inspectArc(u: number, mo: number, pos: THREE.Vector3, rot: THREE.Euler, tune?: ArcTune): number {
  const w = hump(u, 0.04, 0.22, 0.8, 0.97);
  const pre = hump(u, 0, 0.05, 0.06, 0.14);
  const s2 = ease(seg(u, 0.46, 0.62));
  const settle = Math.sin(seg(u, 0.9, 1) * Math.PI) * (1 - seg(u, 0.9, 1));
  rot.y += pre * 0.08 * mo + w * lerp(-(tune?.yaw ?? 1), IA.ry, s2) * mo;
  rot.z += w * lerp(0.5, IA.rz, s2) * mo;
  rot.x += w * lerp(0, IA.rx, s2) * mo - settle * 0.04 * mo;
  pos.x += w * lerp(-0.08, IA.px, s2);
  pos.y += w * lerp(0.04, IA.py, s2);
  // virando de uma pose para a outra, a coronha varre a frente da câmera: a arma vai um pouco para longe e para baixo
  const turn = 4 * s2 * (1 - s2) * w;
  pos.z += w * lerp(0.03, IA.pz, s2) - 0.05 * turn;
  pos.y -= 0.02 * turn;
  if (tune) pos.z += tune.push * hump(u, 0, 0.12, 0.86, 1);
  return hump(u, 0.48, 0.62, 0.74, 0.86);
}
/** a segunda pose da inspeção em arco (giro YXZ e posição somados à de quadril) */
const IA = { rx: 0.1, ry: 0.35, rz: -0.35, px: -0.06, py: 0.05, pz: -0.02 };

/**
 * Coronhada com peso: a arma recua e arma para a direita (antecipação), vai rápido para a frente e para a esquerda
 * rolando (no acerto, em 0,32 — o `game.ts` conta o golpe em 160 ms de 500), dá o tranco, segue um pouco e volta
 * devagar, assentando.
 */
function gunBash(
  u: number,
  mo: number,
  pos: THREE.Vector3,
  rot: THREE.Euler,
  joltAt: (key: string, at: number, v: number) => void,
) {
  const a = hump(u, 0, 0.16, 0.18, 0.3);
  const s = expOut(seg(u, 0.17, 0.32)) * (1 - ease(seg(u, 0.44, 0.95)));
  const f = hump(u, 0.3, 0.4, 0.44, 0.7);
  const settle = Math.sin(seg(u, 0.85, 1) * Math.PI) * (1 - seg(u, 0.85, 1));
  pos.z += 0.035 * a - 0.16 * s - 0.012 * f;
  pos.x += 0.02 * a - 0.085 * s;
  pos.y += 0.012 * a + 0.008 * s - 0.006 * f;
  rot.z += (-0.15 * a + 0.62 * s + 0.06 * f) * mo;
  rot.y += (0.1 * a + 0.16 * s) * mo;
  rot.x += (0.08 * a - 0.08 * s - 0.03 * settle) * mo;
  joltAt('hit', 0.32, -1.4);
}
