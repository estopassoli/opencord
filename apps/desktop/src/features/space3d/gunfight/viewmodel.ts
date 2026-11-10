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
import { ARM_RIG } from './armsrig';
import { PORT, ejectKind, ejectVelocity, type EjectKind } from './casings';
import { fitHand, soupOf } from './contact';
import { flashTexture } from './fx';
import { ARM_HAND_FIT, type FingerOffsets } from './handrig';
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
import { AuthoredArms, hasAuthored } from './fpanim';
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
/** distância do olho mirando (z da câmera onde fica o ponto `sight`): a M4 encosta mais para o furo de trás abrir */
const ADS_EYE: Partial<Record<GunId, number>> = { m4: -0.15, mp5: -0.2, mp7: -0.18 };
/**
 * Facas paradas (posição e giro YXZ do `holder`, sem mirar). Baioneta em martelo: o polegar por cima, o cabo atravessando
 * o punho fechado (a ponta do cabo aparece do lado do mindinho) e a lâmina para a frente e para cima, com o pulso
 * dobrado para o lado do mindinho, como quem segura de verdade. Karambit em reversa: o punho quase em pé no terço direito,
 * o antebraço entrando pelo canto de baixo, a argola em cima com o indicador e a garra saindo por baixo do punho e
 * curvando para o meio da tela, com a face à vista (a pegada é `KARAMBIT_ARM`, em `handrig.ts`).
 */
const KNIFE_POSE: Record<
  'bayonet' | 'karambit',
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
};
const HIP_PISTOL = new THREE.Vector3(0.09, -0.085, -0.33);
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
/** o coice nunca traz a arma para mais perto da câmera que isto (z no espaço da câmera do viewmodel) */
const KICK_Z_MAX = -0.12;
/** meia espessura da palma (palpite para os gestos da recarga; o encaixe medido corrige) */
const PALM_HALF = 0.017;
/**
 * Recarga vazia, por arma, sem o braço esquerdo passar por cima da arma (cobria 1/3 da tela): tapa no retém do
 * ferrolho pela esquerda (M4, MP7), alavanca da direita puxada por baixo (AK), alavanca da frente puxada pela esquerda
 * (MP5), o polegar direito solta o ferrolho da pistola, a mão direita trabalha o ferrolho da sniper.
 */
type EmptyKind = 'slap' | 'under' | 'front' | 'pistol' | 'bolt';
const EMPTY_GESTURE: Partial<Record<string, EmptyKind>> = {
  m4: 'slap',
  mp7: 'slap',
  ak47: 'under',
  mp5: 'front',
  l115: 'bolt',
  m200: 'bolt',
  m9: 'pistol',
  deagle: 'pistol',
  scarl: 'slap',
  mcx: 'slap',
  mpx: 'slap',
  pdw: 'slap',
  msmc: 'slap',
  aks74u: 'under',
  stg44: 'front',
  rs9: 'bolt',
  ballista: 'bolt',
  sv98: 'bolt',
  automag3: 'pistol',
};
/**
 * O polegar da direita no punho, por arma: [fechamento, abertura para o lado da palma], no lugar do encaixe medido. Dá a
 * volta por trás do punho e deita na lateral esquerda, atrás do gatilho. O encaixe deixava o da StG 44 em pé do lado
 * direito, encostado na caixa (medido no harness: a ponta passa de x +3,6 cm para −2,6 cm, a ~2 mm da malha).
 */
const RIGHT_THUMB: Partial<Record<string, readonly [number, number]>> = {
  stg44: [0.5, 0.85],
  rs9: [0.63, 1.1],
};
/** inspeção da StG 44, segundo lado: giro (rad) e quanto a arma vai para longe (m) */
const S2_STG = { yaw: 0.45, roll: 0.3, pitch: 0.12, push: 0.04 };
/** pente dentro do punho (MP7, MSMC): ele cai e o novo entra por baixo, como na pistola */
const GRIP_MAG: ReadonlySet<string> = new Set(['mp7', 'msmc']);
/** o tambor do revólver sai para a esquerda e um pouco para baixo (espaço da arma) */
const CYL_OUT = new THREE.Vector3(-0.034, -0.01, 0);
/** o gesto da recarga vazia neste quadro (preenchido pelo `emptyGesture`; peças, mãos e o giro da esquerda) */
const EG = {
  bolt: 0,
  charge: 0,
  boltRot: 0,
  rightK: 0,
  thumbR: 0,
  alt: 0,
  altQ: SIDE_Q,
  out: 0,
  curl: 0.8,
  thumb: 0.5,
  at: new THREE.Vector3(),
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
/** o pente e a mão indo para o colete: por fora e pela frente (atrás ficam o punho e a mão direita) */
const ARC_POUCH = new THREE.Vector3(-0.08, -0.02, -0.06);
const POUCH_R = new THREE.Vector3(0.3, -0.55, -0.1);
/** quanto o pente desce para sair do poço (espaço da arma): fuzil e pistola */
const MAG_PULL = new THREE.Vector3(0, -0.12, 0.02);
const MAG_PULL_PISTOL = new THREE.Vector3(0, -0.09, 0.01);
/** a mão direita em relação ao pente-lâmina (espaço da arma): o polegar em cima dele, o pulso atrás e à direita */
const CLIP_HAND = new THREE.Vector3(0.035, 0.03, 0.075);
/** o guia do pente-lâmina em cima da janela da Kar98k (espaço da arma): a lâmina de pé, as balas para a frente */
const CLIP_GUIDE = new THREE.Vector3(0, 0.104, -0.045);
/** peças soltas (pente vazio caindo, lâmina vazia voando): quanto tempo ficam na tela (ms) e a gravidade (m/s²) */
const DEBRIS_MS = 900;
const DEBRIS_G = 9.8;
const DEBRIS_MAX = 4;
/** quantos estojos esperando o `game.ts` levar para o mundo, no máximo */
const EJECT_MAX = 8;
/** revólver: quando a vareta empurra os estojos para fora (fração da recarga, logo depois de o tambor abrir) */
const CYL_DUMP_AT = 0.26;
/** o carregador rápido: aparece na mão quando ela volta do cinto (`cylinderPose.pouch` no pico) e some com ela */
const LOADER_SHOW = 0.44;
const LOADER_GONE = 0.64;
/** onde a mão segura o carregador rápido (espaço da mão: à frente da palma, nos dedos) */
const LOADER_IN_HAND = new THREE.Vector3(0, -0.03, -0.085);
/** acertos dos dedos (misturados por quadro, sem alocar) */
const OFF_R: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const OFF_L: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
const NO_OFF: FingerOffsets = [0, 0, 0, 0, 0];
const M1 = new THREE.Matrix4();
const POUCH = new THREE.Vector3();
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
/** a guarda relaxada: dedos meio dobrados (o mindinho mais), o indicador um pouco mais aberto e o polegar solto */
const GUARD_CURL = 0.5;
const GUARD_INDEX = 0.38;
const GUARD_THUMB = 0.3;
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
  private readonly leftQ = new THREE.Quaternion();
  /** as pegadas medidas na malha da arma (`holds.ts`): palma encostada, cada dedo fechado até tocar */
  private holds: Holds | null = null;
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
    // o retém fica do lado esquerdo do receptor, logo acima e atrás do poço do pente: a palma encosta nele
    const top = box ? box.max.y : this.magHome.y;
    const bz = box ? box.max.z : this.magHome.z;
    this.slapAt.set(-0.025 - PALM_HALF, top - 0.04, bz + 0.046 - 0.01);
    if (!knife) this.prepareGunParts(g, spec);
    this.knifeOff = NO_OFF;
    if (knife) {
      knifeSpinFrame(g, this.spinPivot, this.spinAxis);
      // os dedos partem abertos e fecham até encostar no cabo, um por um. Karambit: o indicador (atravessando a argola)
      // e o médio (rente à frente dela) ficam no fechamento medido da pegada; o anelar e o mindinho partem dele
      const kar = g.id === 'karambit';
      const start: [number, number, number] = kar ? curlOf(this.handR) : [...KNIFE_OPEN];
      const f = fitHand(soupOf(g.root), 1, this.handR.root.position, this.handR.root.quaternion, start, {
        fingers: kar ? ['ring', 'pinky', 'thumb'] : ['index', 'middle', 'ring', 'pinky', 'thumb'],
        maxCurl: 1.6,
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
    // supressor e quebra-chamas: sem clarão na boca
    if (kind === 'fire' && !this.spec?.noFlash) {
      this.flashUntil = this.now + 45;
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flash.scale.setScalar(this.spec?.cls === 'sniper' ? 1.8 : this.spec?.cls === 'smg' ? 0.9 : 1.2);
    }
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
    const kp = knife ? KNIFE_POSE[g.id === 'karambit' ? 'karambit' : 'bayonet'] : null;
    const hip = kp ? kp.pos : spec.cls === 'pistol' ? HIP_PISTOL : HIP_LONG;
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
      rot.y += 0.06 * (1 - ads);
      rot.z += -0.08 * (1 - ads);
      rot.x += spec.cls === 'pistol' ? 0.05 * (1 - ads) : 0;
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
    RUN_E.set(0, 0, 0);
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
    if (!kar) {
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
    /** revólver: a fração da recarga (para o carregador rápido e os cartuchos do tambor); −1 fora dela */
    let cylU = -1;

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
          if (spec.cls !== 'pistol') {
            const arrive = ease(seg(u, 0.3, 0.62));
            leftAway = Math.max(leftAway, 1 - arrive);
            leftCurl = lerp(0.2, leftCurl, ease(seg(u, 0.6, 0.78)));
            leftThumb = lerp(0.2, leftThumb, ease(seg(u, 0.6, 0.78)));
            joltAt('slap', 0.62, 1.1);
          }
          joltAt('end', 0.8, 1.6);
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
            magPull = CYL_OUT;
            MAG.copy(CYL_OUT).multiplyScalar(cp.out);
            cylSpin = cp.spin;
            magHold = cp.hold;
            handOut = cp.out;
            handPouch = cp.pouch;
            magPalm = cp.palm;
            break;
          }
          // a MP7 e a MSMC têm o pente no punho, como a pistola: ele cai e o novo entra por baixo
          const rp = reloadPose(reloadStyle(empty, pistol || GRIP_MAG.has(g.id)), u, RP);
          rot.z -= rp.tilt * 0.55 * mo;
          rot.x += rp.tilt * (pistol ? 0.45 : 0.3);
          pos.y += rp.tilt * (pistol ? 0.1 : 0.06);
          pos.x -= rp.tilt * 0.03;
          joltAt('out', MAG_OUT_AT + 0.02, -1.2);
          joltAt('seat', MAG_SEAT_AT, 2.4);
          magPull = pistol ? MAG_PULL_PISTOL : MAG_PULL;
          MAG.copy(magPull).multiplyScalar(rp.out);
          magPouch = rp.pouch;
          magHold = rp.hold;
          handOut = rp.handOut;
          handPouch = rp.handPouch;
          magPalm = rp.palm;
          // o pente velho cai (cópia sem cartuchos, do lugar dele): o da arma já está no colete, fora da tela
          if (rp.dropped && !this.joltDone.has('drop')) {
            this.joltDone.add('drop');
            const mag = g.parts.mag;
            if (this.magGhost && mag) {
              const ghost = this.magGhost;
              this.holder.updateMatrixWorld(true);
              M2.compose(ghost.position, ghost.quaternion, ghost.scale).premultiply(this.holder.matrixWorld);
              this.toss(ghost.clone(), M2, V.set(-0.1, -0.35, 0.05), W1.set(-1.2, 0, 1.6));
            }
          }
          if (empty) this.emptyGesture(u, joltAt);
          break;
        }
        case 'reloadClip': {
          // pente-lâmina (Kar98k), tudo com a mão direita (a esquerda fica no guarda-mão): abre o ferrolho, vai na
          // cartucheira, volta com o pente-lâmina e encaixa no guia em cima da janela, o polegar empurra as balas duas
          // vezes, volta à alavanca e fecha o ferrolho (que joga a lâmina vazia fora) e volta ao delgado
          const cp = clipPose(u, CP);
          rot.z -= cp.tilt * 0.3 * mo;
          rot.x += cp.tilt * 0.15;
          pos.y += cp.tilt * 0.04;
          boltRot = cp.lift * 1.2;
          boltBack = cp.back * 0.09;
          rightK = cp.handle;
          rightPouch = cp.pouch;
          clipK = cp.clip;
          clipNow = cp;
          rightCurl = lerp(rightCurl, PINCH[0], rightK);
          rightThumb = lerp(rightThumb, PINCH[1], rightK);
          rightIndex = lerp(rightIndex, PINCH[2], rightK);
          // no pente-lâmina: dedos soltos, o polegar por cima empurrando
          // os outros dedos abertos, por cima da caixa da culatra (fechados, eles entravam nela)
          rightCurl = lerp(rightCurl, 0.15, clipK);
          rightIndex = lerp(rightIndex, 0.3, clipK);
          rightThumb = lerp(rightThumb, 0.25 + cp.press * 0.45, clipK);
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
          const w = hump(u, 0, 0.12, 0.85, 1);
          pos.y -= w * 0.02;
          rot.z -= w * 0.15 * mo;
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
          } else {
            // golpe com a arma: empurra a arma para a frente e para o lado
            // RS9: antes, recolhe a arma para trás e para a direita (antecipação) e só então empurra
            const rs9 = g.id === 'rs9';
            const w = rs9 ? hump(u, 0.12, 0.3, 0.5, 1) : hump(u, 0, 0.25, 0.5, 1);
            pos.z -= 0.15 * w;
            pos.x -= 0.08 * w;
            rot.z += 0.6 * w * mo;
            if (rs9) {
              const pre = hump(u, 0, 0.1, 0.12, 0.26);
              pos.z += 0.035 * pre;
              pos.x += 0.015 * pre;
              rot.z -= 0.12 * pre * mo;
              rot.x += 0.05 * pre * mo;
            }
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
          // duas paradas, com peso: um pequeno recuo antes (antecipação), a arma vira e mostra o lado esquerdo (para),
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
          rot.y += pre * 0.08 * mo - w * 1.0 * side1 + side2 * (stg ? S2_STG.yaw : -0.25);
          rot.z += w * 0.5 * side1 - side2 * (stg ? S2_STG.roll : 0.45) * mo;
          rot.x += side2 * (stg ? S2_STG.pitch : 0.3) * mo - settle * 0.04 * mo;
          if (stg) pos.z -= side2 * S2_STG.push;
          pos.x -= w * 0.08 - side2 * 0.02;
          pos.y += w * 0.04 + side2 * 0.015;
          pos.z += w * 0.03;
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
    if (open > 0 && kar) {
      rightCurl = lerp(rightCurl, KAR_SPIN_CURL.fingers, open);
      rightThumb = lerp(rightThumb, KAR_SPIN_CURL.thumb, open);
      rightIndex = lerp(rightIndex, KAR_SPIN_CURL.index, open);
    } else if (open > 0) {
      rightCurl = lerp(rightCurl, OPEN_CURL, open);
      rightThumb = lerp(rightThumb, OPEN_THUMB, open);
      rightIndex = lerp(rightIndex, OPEN_CURL, open);
    }
    // gesto da recarga vazia (calculado no `emptyGesture`)
    if (a?.kind === 'reloadEmpty' && a.t < a.ms) {
      boltBack = Math.max(boltBack, EG.bolt);
      chargeBack = EG.charge;
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
    movePart(g.parts.mag, MAG, cylSpin);
    // os cartuchos só aparecem com o pente fora do lugar (o modelo é oco: no lugar, eles vazavam pela culatra); o pente
    // que sai e o novo estão com bala (o vazio que cai é uma cópia sem eles)
    // revólver: depois que os estojos vazios caem, o tambor fica vazio até o carregador rápido empurrar os cartuchos
    if (g.rounds) g.rounds.visible = MAG.lengthSq() > 1e-6 && !(cylU >= CYL_DUMP_AT && cylU < MAG_SEAT_AT);
    movePart(g.parts.bolt, V.set(0, 0, boltBack), 0);
    movePart(g.parts.slide, V.set(0, 0, boltBack));
    movePart(g.parts.charge, V.set(0, 0, chargeBack));
    movePart(g.parts.boltRot, V.set(0, 0, boltBack), boltRot);
    movePart(g.parts.trigger, V.set(0, 0, 0.004 * trig));
    // faca: gira em volta do pivô (a argola no indicador, ou o meio do cabo), com a mão parada nela
    if (knife) {
      SPIN_Q.setFromAxisAngle(this.spinAxis, spin).multiply(TWIST_Q.setFromAxisAngle(Z_AXIS, KD.twist));
      g.root.quaternion.copy(SPIN_Q);
      g.root.position.copy(this.spinPivot).sub(V.copy(this.spinPivot).applyQuaternion(SPIN_Q));
      // karambit: a argola escorrega para fora no indicador enquanto gira (o cabo passa longe da palma)
      if (KD.slide !== 0) g.root.position.add(V.fromArray(KAR_SLIDE).normalize().multiplyScalar(KD.slide));
      // balisong: a lâmina e o cabo de morder giram nos pinos (aberta, fechando ou nos floreios)
      if (g.flip) setBalisong(g, 1 - KD.shut, KD.bite, KD.bladeX);
    }
    this.holder.updateMatrixWorld(true);
    // recarga: a mão esquerda segue o fundo do pente de verdade (já no lugar deste quadro), a palma por baixo dele
    const mh = this.holds?.mag ?? null;
    if (magHold > 0) {
      // a pegada medida no pente (holds.ts), andando o mesmo que ele: descido do poço e indo ao colete
      V.copy(magPull).multiplyScalar(handOut).lerp(POUCH, handPouch);
      V.addScaledVector(ARC_POUCH, 4 * handPouch * (1 - handPouch));
      if (mh) V.add(mh.pos);
      else V.add(this.magBottom).add(W1.set(-0.046, -0.04, 0));
      LEFT.lerp(V, magHold);
      // no meio do caminho entre o apoio e o pente, por fora: em linha reta, a mão passava por dentro da arma
      LEFT.addScaledVector(ARC_OUT, 4 * magHold * (1 - magHold));
      // e de dedos abertos (fechados, eles atravessavam o punho e o guarda-mão ao sair)
      leftCurl = lerp(leftCurl, 0.15, 4 * magHold * (1 - magHold));
      leftThumb = lerp(leftThumb, 0.15, 4 * magHold * (1 - magHold));
      if (mh) {
        leftCurl = lerp(leftCurl, mh.curl[0], magHold);
        leftThumb = lerp(leftThumb, mh.curl[1], magHold);
      }
    }
    // fim do encaixe: os dedos soltam e a palma empurra a base
    leftCurl = lerp(leftCurl, 0.15, magPalm);
    leftThumb = lerp(leftThumb, 0.15, magPalm);
    // gesto da recarga vazia: a mão esquerda vai pela lateral (ou por baixo) até a peça
    if (leftAlt > 0) LEFT.lerp(EG.at, leftAlt).addScaledVector(ARC_OUT, 4 * leftAlt * (1 - leftAlt));
    // ferrolho: a mão direita anda junto com a alavanca (já no lugar deste quadro: sobe girando com o ferrolho e vem
    // para trás), na pegada medida em volta da bola dela
    const pinch = this.holds?.pinch ?? null;
    const lever = g.parts.boltRot ?? (g.id === 'kar98k' ? g.parts.charge : undefined);
    let pinchQ = 0;
    if (rightK > 0 && pinch && lever) {
      M1.compose(pinch.pos, pinch.quat, S1.set(1, 1, 1));
      M1.premultiply(holderSpace(lever.obj, this.holder, M2).multiply(this.handleRestInv));
      M1.decompose(HANDLE, RIGHT_Q, S1);
      GRIP_R.lerp(HANDLE, rightK);
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
          .add(V.set(0, -0.012 * cp.press, 0)),
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
          r.position.y = -0.0055 - (i + cp.stripped) * 0.0102;
          r.visible = i + cp.stripped < CLIP_ROUNDS - 0.5;
        });
      }
    }
    this.handR.root.position.copy(GRIP_R);
    if (this.holds) this.handR.root.quaternion.copy(this.holds.right.quat).slerp(RIGHT_Q, pinchQ);
    // quanto o indicador está no gatilho (1) ou fora dele, sobre a armação (0)
    const span = this.rightCurl[2] - trigOff;
    const onTrigger = Math.abs(span) > 1e-3 ? Math.max(0, Math.min(1, (rightIndex - trigOff) / span)) : 1;
    this.handR.setCurl(rightCurl, rightThumb, rightIndex, this.rightOffsets(rightK, onTrigger, clipK, kar ? open : 0));
    // a mão esquerda solta e desce para fora da tela (o braço não estica até a arma). A conta é no espaço da câmera:
    // no da arma, que gira ~0,9 rad saindo da tática, a mão passava pelo meio da tela, aberta e solta
    if (leftAway > 1e-3) {
      this.holder.localToWorld(LEFT).lerp(LEFT_OFF, leftAway);
      this.holder.worldToLocal(LEFT);
    }
    this.handL.root.position.copy(LEFT);
    this.placeLoader(cylU);
    this.handL.root.quaternion.copy(LEFT_Q.copy(this.leftQ).slerp(altQ, leftAlt));
    if (mh && magHold > 0) this.handL.root.quaternion.slerp(mh.quat, magHold);
    this.handL.setCurl(leftCurl, leftThumb, leftCurl, this.leftOffsets(magHold, leftAlt, magPalm, leftAway));
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
    if (this.gun?.flip) return this.balisongDraw(u, full, pos, rot, joltAt);
    if (kar) {
      this.karambitPlay(KAR_DRAW, u, full, pos);
      joltAt('catch', 0.6, 2.2);
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
   * Saque da balisong: a mão sobe de baixo com ela fechada, de lado para a câmera; os dedos soltam e o cabo de morder dá
   * meia volta (tranco), a lâmina gira para fora e trava entre os cabos (tranco maior), o pulso batendo para um lado e
   * para o outro a cada meia volta; os dedos fecham e o braço desce para a guarda. Com "reduzir movimento", ela já
   * vem aberta.
   */
  private balisongDraw(
    u: number,
    full: boolean,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    const entry = 1 - ease(seg(u, 0, 0.24));
    const high = 1 - ease(seg(u, 0.66, 0.86));
    const settle = hump(u, 0.8, 0.86, 0.9, 1);
    pos.x += 0.06 * entry - 0.02 * high;
    pos.y += 0.06 * high - 0.24 * entry - 0.015 * settle;
    pos.z += 0.03 * high;
    KD.ez = -0.85 * high;
    KD.ex = 0.2 * high;
    KD.pro = 0.15 * high;
    if (full) {
      const o = ease(seg(u, 0.3, 0.64));
      KD.shut = 1 - o;
      // o pulso acompanha cada meia volta (vai e volta)
      KD.pro += 0.3 * Math.sin(o * Math.PI * 2);
      KD.open = hump(u, 0.22, 0.29, 0.64, 0.72) * 0.8;
      joltAt('bite', 0.47, 0.9);
      joltAt('lock', 0.64, 1.8);
    }
    joltAt('catch', 0.86, 1.4);
    rot.x += 0.04 * settle;
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
    const bal = !!this.gun?.flip;
    if (kar) {
      this.karambitPlay(KAR_INSPECT, u, full, pos);
      joltAt('faceA', 0.2, 0.8);
      joltAt('faceB', 0.44, 0.8);
      joltAt('catch', 0.86, 1.6);
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
    } else if (bal) {
      // balisong: em pé, fecha (a lâmina volta para dentro dos cabos, depois o cabo de morder) e abre de novo, com o
      // pulso batendo para cada lado a cada meia volta
      KD.ez = -0.8 * fl;
      KD.ex += 0.15 * fl;
      if (full) {
        const close = ease(seg(u, 0.6, 0.7));
        const reopen = ease(seg(u, 0.73, 0.84));
        KD.shut = close * (1 - reopen);
        KD.pro += 0.35 * Math.sin(close * Math.PI * 2) + 0.35 * Math.sin(reopen * Math.PI * 2);
        KD.open = hump(u, 0.57, 0.61, 0.83, 0.87) * 0.8;
        joltAt('shut', 0.7, 1);
        joltAt('lock2', 0.84, 1.4);
      }
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
    if (this.gun?.id === 'karambit') {
      this.karambitPlay(s > 0 ? KAR_SLASH_R : KAR_SLASH_L, u, mo >= 1, pos);
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
  private knifeStab(
    u: number,
    mo: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    joltAt: (key: string, at: number, v: number) => void,
  ) {
    if (this.gun?.id === 'karambit') {
      this.karambitPlay(KAR_HEAVY, u, mo >= 1, pos);
      joltAt('stab', 0.47, 3);
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
   * A esquerda de guarda com faca: baixa à esquerda, meio fechada, respirando e balançando com o passo e o mouse; na
   * corrida desce, e as animações da faca a deslocam (`KD.l*`). A conta é no espaço da câmera e vai para o da arma, onde
   * a mão mora.
   */
  private knifeGuard(now: number, inp: VmInput, mo: number) {
    const bobA = inp.moving * (inp.crouch ? 0.6 : 1) * mo;
    GL.copy(GUARD_L);
    GL.x += Math.sin(this.bob + 0.6) * 0.01 * bobA + this.swayX * 0.04 + KD.lx;
    GL.y +=
      Math.abs(Math.cos(this.bob + 0.6)) * -0.01 * bobA +
      Math.sin(now / 900 + 0.8) * 0.003 * mo -
      this.swayY * 0.04 -
      0.08 * this.sprintK +
      KD.ly;
    GL.z += 0.04 * this.sprintK + KD.lz;
    this.handL.root.position.copy(this.holder.worldToLocal(GL));
    this.holder.getWorldQuaternion(HQ);
    this.handL.root.quaternion.copy(HQ.invert().multiply(GUARD_Q));
    // mão solta, sem cerrar (cerrada, virava um toco): os dedos em cascata e o polegar ao lado do indicador
    this.handL.setCurl(GUARD_CURL, GUARD_THUMB, GUARD_INDEX);
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
    }
    if (g.id === 'kar98k') {
      this.clip = stripperClip();
      this.holder.add(this.clip.root);
      // o polegar em cima do pente-lâmina e a palma por fora da caixa da culatra (sem o acerto, ela entrava ~1,5 cm)
      const at = CLIP_GUIDE.clone().add(CLIP_HAND);
      // medido com o ferrolho aberto (para trás, ele fica embaixo da mão)
      const h = fitAt(g, 1, at, this.handR.root.quaternion.clone(), [0.15, 0.25, 0.3], () => {
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
  }

  /**
   * O carregador rápido: aparece na mão quando ela volta do cinto, os cartuchos na frente dos dedos; encosta atrás do
   * tambor aberto, alinhado com os furos, e empurra os cartuchos para dentro (no som deles); depois sai junto com a mão
   * (some — os cartuchos ficam no tambor).
   */
  private placeLoader(u: number) {
    const ld = this.loader;
    if (!ld) return;
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
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const at = new THREE.Vector3(Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0).applyQuaternion(Q1).add(c);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.6 - Math.random() * 0.5, 0.1 + Math.random() * 0.2);
      this.ejects.push({ at, vel, axis: axis.clone(), kind });
    }
  }

  /** o gesto da recarga vazia no momento `u` (0–1): preenche `EG` (ver `EMPTY_GESTURE`) */
  private emptyGesture(u: number, joltAt: (key: string, at: number, v: number) => void) {
    EG.bolt = EG.charge = EG.boltRot = EG.rightK = EG.thumbR = EG.alt = EG.out = 0;
    EG.altQ = SIDE_Q;
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
