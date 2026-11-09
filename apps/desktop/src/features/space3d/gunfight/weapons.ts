/**
 * Gunfight do Espaço 3D (zona 8, todos contra todos): as armas e as contas do tiro. Sem three.js aqui: tudo puro e
 * testado (dano pela distância, cadência, recuo, dispersão, acerto do raio na cabeça e no corpo).
 * Os números são nossos, pensados para partidas curtas entre amigos: fuzil mata com 3–5 tiros no corpo (a AK bate mais
 * forte e sobe mais; o M4 é mais rápido e controlável), submetralhadora com 4 de perto (de perto ela mata mais rápido
 * que o M4; de longe cai muito), L115 e M200 com 1 no peito
 * (a Kar98k só na cabeça, em troca do ferrolho e da mira rápidos), pistola com 2–6, faca com 1.
 */
import type { GunId } from '@opencord/contracts';
import type { GunBuild } from './attachments';

export type GunClass = 'ar' | 'smg' | 'sniper' | 'pistol' | 'knife';
export type GunSlot = 'primary' | 'secondary' | 'melee';
/** retículo da tela de luneta: sniper (padrão), variável, prisma (3x dos fuzis) e poste (a clássica da Kar98k) */
export type ScopeStyle = 'sniper' | 'lpvo' | 'prism' | 'post';

export interface GunSpec {
  id: GunId;
  name: string;
  cls: GunClass;
  slot: GunSlot;
  /** disparos por minuto (no ferrolho, o ciclo manda) */
  rpm: number;
  auto: boolean;
  /** dano perto e longe, e as distâncias (m) em que começa a cair e em que chega ao mínimo */
  dmg: [number, number];
  range: [number, number];
  /** multiplicador na cabeça */
  head: number;
  mag: number;
  reserve: number;
  /** recarga com bala na câmara e com o pente vazio (ms) */
  reloadMs: number;
  emptyReloadMs: number;
  /** tempo para mirar (ms) e o zoom da mira (1 = sem zoom) */
  adsMs: number;
  zoom: number;
  /** luneta (tela de mira preta em volta) */
  scope: boolean;
  /** recuo: o padrão da mira, a volta, o tranco da câmera, o coice da arma e a abertura da dispersão */
  recoil: RecoilSpec;
  /** dispersão (rad, meio ângulo): no quadril, mirando, e o acréscimo andando */
  spread: { hip: number; ads: number; move: number };
  /** velocidade de andar (1 = normal) */
  move: number;
  /** ferrolho: tempo para engatilhar o próximo tiro (ms) */
  boltMs?: number;
  /** faca: dano do golpe rápido e do pesado (botão direito), alcance (m) e duração do golpe rápido (ms) */
  melee?: { dmg: number; heavy: number; range: number; ms: number };
  /** com acessórios (`applyAttachments`): o retículo da luneta, tiro abafado, sem clarão e a montagem */
  scopeStyle?: ScopeStyle;
  quiet?: boolean;
  noFlash?: boolean;
  build?: GunBuild;
}

/**
 * Um trecho do padrão de recuo, até o tiro `to` (contando de 1): cada tiro sobe `up` graus e vai `side` graus para o
 * lado (+ direita), mais um balanço `swing`·sen(2π·i/`period`). Depois do último trecho, ele continua valendo.
 */
export interface RecoilSeg {
  to: number;
  up: number;
  side?: number;
  swing?: number;
  period?: number;
}

/** coice de uma mola (1ª pessoa): picos no quadril (m e rad) e a mola (k, c) */
export interface VmKick {
  /** para trás (m), subida do cano, rolagem e lado (rad) */
  back: number;
  rise: number;
  roll: number;
  side: number;
  k: number;
  c: number;
}

export interface RecoilSpec {
  /** padrão no quadril, em graus por tiro (o mesmo a cada pente: dá para aprender e compensar) */
  pattern: RecoilSeg[];
  /** variação sorteada por cima do padrão (fração, para mais e para menos) */
  noise: number;
  /** a mira volta sozinha: depois de `delay` ms sem atirar, `frac` do que subiu volta em ~`tau` s */
  recover: { delay: number; tau: number; frac: number };
  /** tranco só da vista (volta sozinho): pico por tiro no quadril e rolagem (rad), e a mola */
  punch: { up: number; roll: number; k: number; c: number };
  /** coice da arma na 1ª pessoa (o boneco usa o mesmo, maior) */
  vm: VmKick;
  /** a dispersão abre a cada tiro da rajada (rad por tiro, no quadril e mirando), até `BLOOM_SHOTS` tiros */
  bloom: { hip: number; ads: number };
  /** 3ª pessoa: o tronco vai para trás no tiro (rad) */
  body: number;
}

const D = Math.PI / 180;
const g = (s: GunSpec) => s;
/** recuo de quem não atira (faca) */
const NO_RECOIL: RecoilSpec = {
  pattern: [{ to: 1, up: 0 }],
  noise: 0,
  recover: { delay: 0, tau: 0.1, frac: 0 },
  punch: { up: 0, roll: 0, k: 400, c: 40 },
  vm: { back: 0, rise: 0, roll: 0, side: 0, k: 300, c: 30 },
  bloom: { hip: 0, ads: 0 },
  body: 0,
};

export const GUNS: Record<GunId, GunSpec> = {
  m4: g({
    id: 'm4',
    name: 'M4',
    cls: 'ar',
    slot: 'primary',
    rpm: 800,
    auto: true,
    dmg: [28, 20],
    range: [22, 45],
    head: 1.5,
    mag: 30,
    reserve: 120,
    reloadMs: 2100,
    emptyReloadMs: 2600,
    adsMs: 250,
    zoom: 1.45,
    scope: false,
    recoil: {
      // reto nos 6 primeiros, puxa um pouco para a direita e depois balança pouco: o fuzil controlável
      pattern: [
        { to: 6, up: 0.55 },
        { to: 14, up: 0.45, side: 0.12 },
        { to: 99, up: 0.3, swing: 0.25, period: 8 },
      ],
      noise: 0.15,
      recover: { delay: 100, tau: 0.14, frac: 0.78 },
      punch: { up: 0.25 * D, roll: 0.3 * D, k: 400, c: 40 },
      vm: { back: 0.012, rise: 1.5 * D, roll: 0.8 * D, side: 0.2 * D, k: 260, c: 24 },
      bloom: { hip: 0.0015, ads: 0.0004 },
      body: 0.03,
    },
    spread: { hip: 0.045, ads: 0.002, move: 0.02 },
    move: 0.95,
  }),
  ak47: g({
    id: 'ak47',
    name: 'AK-47',
    cls: 'ar',
    slot: 'primary',
    rpm: 600,
    auto: true,
    dmg: [34, 25],
    range: [24, 48],
    head: 1.5,
    mag: 30,
    reserve: 120,
    reloadMs: 2400,
    emptyReloadMs: 2900,
    adsMs: 280,
    zoom: 1.45,
    scope: false,
    recoil: {
      // um "S": sobe forte nos 5 primeiros, vai para a esquerda até o 14 (~3°), volta para a direita cruzando o centro
      // no tiro ~21 e depois serpenteia em volta do centro, subindo pouco
      pattern: [
        { to: 5, up: 1.0 },
        { to: 14, up: 0.7, side: -0.35 },
        { to: 22, up: 0.35, side: 0.42 },
        { to: 99, up: 0.3, side: -0.03, swing: 0.4, period: 6 },
      ],
      noise: 0.18,
      recover: { delay: 110, tau: 0.15, frac: 0.75 },
      punch: { up: 0.35 * D, roll: 0.45 * D, k: 360, c: 36 },
      vm: { back: 0.016, rise: 2.2 * D, roll: 1.4 * D, side: 0.6 * D, k: 220, c: 20 },
      bloom: { hip: 0.0018, ads: 0.0005 },
      body: 0.04,
    },
    spread: { hip: 0.05, ads: 0.003, move: 0.024 },
    move: 0.93,
  }),
  mp7: g({
    id: 'mp7',
    name: 'MP7',
    cls: 'smg',
    slot: 'primary',
    rpm: 950,
    auto: true,
    dmg: [26, 14],
    range: [12, 26],
    head: 1.35,
    mag: 40,
    reserve: 160,
    reloadMs: 1900,
    emptyReloadMs: 2300,
    adsMs: 180,
    zoom: 1.25,
    scope: false,
    recoil: {
      // rápida e baixa: sobe pouco, treme de um lado para o outro e escapa de leve para a direita no fim
      pattern: [
        { to: 6, up: 0.3 },
        { to: 10, up: 0.2, swing: 0.15, period: 4 },
        { to: 99, up: 0.18, side: 0.04, swing: 0.15, period: 4 },
      ],
      noise: 0.25,
      recover: { delay: 80, tau: 0.12, frac: 0.8 },
      punch: { up: 0.15 * D, roll: 0.2 * D, k: 600, c: 50 },
      vm: { back: 0.008, rise: 1.0 * D, roll: 1.0 * D, side: 0.3 * D, k: 320, c: 30 },
      bloom: { hip: 0.001, ads: 0.0003 },
      body: 0.02,
    },
    spread: { hip: 0.03, ads: 0.004, move: 0.01 },
    move: 1.05,
  }),
  mp5: g({
    id: 'mp5',
    name: 'MP5',
    cls: 'smg',
    slot: 'primary',
    rpm: 860,
    auto: true,
    dmg: [27, 16],
    range: [14, 28],
    head: 1.4,
    mag: 30,
    reserve: 150,
    reloadMs: 2000,
    emptyReloadMs: 2500,
    adsMs: 190,
    zoom: 1.25,
    scope: false,
    recoil: {
      // macia: sobe um pouco mais que a MP7 e escapa de leve para a esquerda depois do 12º tiro
      pattern: [
        { to: 6, up: 0.34 },
        { to: 12, up: 0.22, swing: 0.1, period: 5 },
        { to: 99, up: 0.2, side: -0.05, swing: 0.1, period: 5 },
      ],
      noise: 0.2,
      recover: { delay: 80, tau: 0.12, frac: 0.8 },
      punch: { up: 0.18 * D, roll: 0.2 * D, k: 560, c: 48 },
      vm: { back: 0.009, rise: 1.1 * D, roll: 0.8 * D, side: 0.2 * D, k: 300, c: 28 },
      bloom: { hip: 0.001, ads: 0.0003 },
      body: 0.02,
    },
    spread: { hip: 0.032, ads: 0.004, move: 0.011 },
    move: 1.04,
  }),
  l115: g({
    id: 'l115',
    name: 'L115',
    cls: 'sniper',
    slot: 'primary',
    rpm: 50,
    auto: false,
    dmg: [140, 120],
    range: [60, 120],
    head: 2,
    mag: 5,
    reserve: 25,
    reloadMs: 3200,
    emptyReloadMs: 3600,
    // a L115 é a sniper ágil (mira mais rápida); a M200 tem pente maior e mais zoom, mas é mais lenta
    adsMs: 360,
    zoom: 4,
    scope: true,
    recoil: {
      // um coice forte por tiro: a mira sobe e volta quase toda até o ferrolho fechar; a luneta pula e desce devagar
      pattern: [{ to: 99, up: 2.5, side: 0.25 }],
      noise: 0.15,
      recover: { delay: 200, tau: 0.3, frac: 0.9 },
      punch: { up: 4 * D, roll: 1 * D, k: 120, c: 18 },
      vm: { back: 0.06, rise: 8 * D, roll: 2 * D, side: 0, k: 70, c: 12 },
      bloom: { hip: 0, ads: 0 },
      body: 0.08,
    },
    spread: { hip: 0.12, ads: 0, move: 0.06 },
    move: 0.86,
    boltMs: 1150,
  }),
  m200: g({
    id: 'm200',
    name: 'M200',
    cls: 'sniper',
    slot: 'primary',
    rpm: 45,
    auto: false,
    dmg: [150, 130],
    range: [70, 140],
    head: 2,
    mag: 7,
    reserve: 28,
    reloadMs: 3500,
    emptyReloadMs: 3900,
    adsMs: 450,
    zoom: 4.5,
    scope: true,
    recoil: {
      pattern: [{ to: 99, up: 2.8, side: 0.25 }],
      noise: 0.15,
      recover: { delay: 200, tau: 0.3, frac: 0.9 },
      punch: { up: 4.5 * D, roll: 1.2 * D, k: 120, c: 18 },
      vm: { back: 0.065, rise: 8 * D, roll: 2.5 * D, side: 0, k: 70, c: 12 },
      bloom: { hip: 0, ads: 0 },
      body: 0.08,
    },
    spread: { hip: 0.13, ads: 0, move: 0.07 },
    move: 0.83,
    boltMs: 1300,
  }),
  kar98k: g({
    id: 'kar98k',
    name: 'Kar98k',
    cls: 'sniper',
    slot: 'primary',
    rpm: 60,
    auto: false,
    dmg: [90, 80],
    range: [45, 90],
    head: 2.5,
    mag: 5,
    reserve: 25,
    reloadMs: 2600,
    emptyReloadMs: 2900,
    adsMs: 300,
    zoom: 2.4,
    scope: false,
    recoil: {
      pattern: [{ to: 99, up: 2.4, side: -0.2 }],
      noise: 0.15,
      recover: { delay: 180, tau: 0.26, frac: 0.9 },
      punch: { up: 3.5 * D, roll: 1 * D, k: 130, c: 20 },
      vm: { back: 0.05, rise: 7 * D, roll: 2 * D, side: 0, k: 80, c: 13 },
      bloom: { hip: 0, ads: 0 },
      body: 0.07,
    },
    spread: { hip: 0.09, ads: 0, move: 0.05 },
    move: 0.92,
    boltMs: 950,
  }),
  m9: g({
    id: 'm9',
    name: 'M9 Beretta',
    cls: 'pistol',
    slot: 'secondary',
    rpm: 520,
    auto: false,
    dmg: [30, 20],
    range: [10, 25],
    head: 1.4,
    mag: 15,
    reserve: 60,
    reloadMs: 1500,
    emptyReloadMs: 1800,
    adsMs: 150,
    zoom: 1.2,
    scope: false,
    recoil: {
      // leve: um pulso curto do cano que volta rápido
      pattern: [{ to: 99, up: 0.9, side: 0.08, swing: 0.2, period: 3 }],
      noise: 0.15,
      recover: { delay: 120, tau: 0.14, frac: 0.88 },
      punch: { up: 0.6 * D, roll: 0.5 * D, k: 450, c: 42 },
      vm: { back: 0.015, rise: 5 * D, roll: 1.5 * D, side: 0, k: 260, c: 26 },
      bloom: { hip: 0.003, ads: 0.0008 },
      body: 0.02,
    },
    spread: { hip: 0.028, ads: 0.004, move: 0.01 },
    move: 1.05,
  }),
  deagle: g({
    id: 'deagle',
    name: 'Desert Eagle',
    cls: 'pistol',
    slot: 'secondary',
    rpm: 180,
    auto: false,
    dmg: [60, 40],
    range: [14, 32],
    head: 1.7,
    mag: 7,
    reserve: 28,
    reloadMs: 1900,
    emptyReloadMs: 2200,
    adsMs: 180,
    zoom: 1.25,
    scope: false,
    recoil: {
      // alta e lenta: o cano sobe muito e volta devagar (o tiro seguinte espera a mira descer)
      pattern: [{ to: 99, up: 3.2, side: 0.3 }],
      noise: 0.2,
      recover: { delay: 150, tau: 0.22, frac: 0.85 },
      punch: { up: 2.5 * D, roll: 1.5 * D, k: 160, c: 22 },
      vm: { back: 0.03, rise: 12 * D, roll: 3 * D, side: 0.5 * D, k: 90, c: 13 },
      bloom: { hip: 0.006, ads: 0.0015 },
      body: 0.06,
    },
    spread: { hip: 0.04, ads: 0.004, move: 0.016 },
    move: 1.02,
  }),
  karambit: g({
    id: 'karambit',
    name: 'Karambit',
    cls: 'knife',
    slot: 'melee',
    rpm: 120,
    auto: false,
    dmg: [150, 150],
    range: [2, 2],
    head: 1,
    mag: 0,
    reserve: 0,
    reloadMs: 0,
    emptyReloadMs: 0,
    adsMs: 0,
    zoom: 1,
    scope: false,
    recoil: NO_RECOIL,
    spread: { hip: 0, ads: 0, move: 0 },
    move: 1.12,
    melee: { dmg: 55, heavy: 150, range: 2, ms: 450 },
  }),
  bayonet: g({
    id: 'bayonet',
    name: 'M9 Baioneta',
    cls: 'knife',
    slot: 'melee',
    rpm: 110,
    auto: false,
    dmg: [150, 150],
    range: [2.2, 2.2],
    head: 1,
    mag: 0,
    reserve: 0,
    reloadMs: 0,
    emptyReloadMs: 0,
    adsMs: 0,
    zoom: 1,
    scope: false,
    recoil: NO_RECOIL,
    spread: { hip: 0, ads: 0, move: 0 },
    move: 1.1,
    melee: { dmg: 55, heavy: 150, range: 2.2, ms: 550 },
  }),
};

export const CLASS_LABEL: Record<GunClass, string> = {
  ar: 'Fuzil',
  smg: 'Submetralhadora',
  sniper: 'Sniper',
  pistol: 'Pistola',
  knife: 'Faca',
};

/** armas de cada espaço do equipamento, na ordem do menu */
export const SLOT_GUNS: Record<GunSlot, GunId[]> = {
  primary: ['m4', 'ak47', 'mp7', 'mp5', 'l115', 'm200', 'kar98k'],
  secondary: ['m9', 'deagle'],
  melee: ['karambit', 'bayonet'],
};

export interface Loadout {
  primary: GunId;
  secondary: GunId;
  melee: GunId;
}
export const DEFAULT_LOADOUT: Loadout = { primary: 'm4', secondary: 'm9', melee: 'karambit' };

export const MAX_HP = 100;
/** a vida volta sozinha depois de tanto tempo sem levar tiro (ms), a esta velocidade (por segundo) */
export const REGEN_DELAY_MS = 4500;
export const REGEN_PER_S = 40;
/** renascer depois de morrer (ms) */
export const RESPAWN_MS = 3000;
/** partida: quem chegar primeiro a tantos abates ganha (o alvo de uma partida cheia; menos gente, alvo menor) */
export const FFA_TARGET = 25;
/** a partida também acaba no tempo (ms): vence quem tiver mais abates (empate: menos mortes) */
export const MATCH_MS = 8 * 60 * 1000;

/**
 * O alvo de abates pelo tamanho da partida na hora do começo (eu, as pessoas e os bots): com pouca gente, 30 abates
 * levariam mais de 10 minutos e a partida nunca fecha.
 */
export function ffaTarget(players: number): number {
  return players <= 3 ? 15 : players <= 5 ? 20 : FFA_TARGET;
}
/** quanto tempo a tela do vencedor fica antes de a partida recomeçar sozinha (ms) */
export const WINNER_MS = 12000;

/** dano de um tiro a `dist` metros: cheio até range[0], cai em linha até range[1], mínimo depois */
export function damageAt(spec: GunSpec, dist: number, head: boolean): number {
  const [near, far] = spec.dmg;
  const [r0, r1] = spec.range;
  const k = dist <= r0 ? 0 : dist >= r1 ? 1 : (dist - r0) / (r1 - r0);
  const base = near + (far - near) * k;
  return Math.round(base * (head ? spec.head : 1));
}

/** intervalo entre tiros (ms): cadência ou o ferrolho, o que for maior */
export function shotInterval(spec: GunSpec): number {
  return Math.max(60000 / spec.rpm, spec.boltMs ?? 0);
}

/** tiros para matar no corpo a `dist` (para os textos e os testes de equilíbrio) */
export function shotsToKill(spec: GunSpec, dist: number, head = false): number {
  return Math.ceil(MAX_HP / Math.max(1, damageAt(spec, dist, head)));
}

// ---------------------------------------------------------------- recuo

/** o primeiro tiro de uma rajada sai com tanto do recuo (e da dispersão, no quadril) */
export const FIRST_SHOT = 0.6;
/** a dispersão abre até tantos tiros de rajada */
export const BLOOM_SHOTS = 10;
/** a rajada esfria em ~`BURST_COOL`× o tempo da volta da mira (mais devagar que a mira, para clicar rápido pesar) */
const BURST_COOL = 1.5;
/** dispersão a mais no ar (rad, no quadril; mirando, metade): pular atirando nunca é preciso, nem com a luneta */
const AIR_SPREAD: Record<GunClass, number> = { ar: 0.05, smg: 0.04, pistol: 0.04, sniper: 0.1, knife: 0 };
/** dispersão a mais deslizando (rad) */
const SLIDE_SPREAD = 0.02;

/**
 * O recuo do tiro `n` da rajada (de 1 em diante), no quadril, em rad: `up` para cima e `side` para a direita. O padrão
 * é fixo por arma (o mesmo a cada pente); `u1`, `u2` em [0,1) só variam um pouco por cima (`noise`).
 */
export function recoilKick(spec: GunSpec, n: number, u1 = 0.5, u2 = 0.5): { up: number; side: number } {
  const segs = spec.recoil.pattern;
  const i = Math.max(1, Math.floor(n));
  let start = 0;
  let seg = segs[segs.length - 1]!;
  for (const s of segs) {
    if (i <= s.to) {
      seg = s;
      break;
    }
    start = s.to;
  }
  const swing = seg.swing && seg.period ? seg.swing * Math.sin((2 * Math.PI * (i - start)) / seg.period) : 0;
  const nz = spec.recoil.noise;
  const first = firstShotK(spec, i);
  const up = seg.up * (1 + nz * (2 * u1 - 1)) * first;
  const side = ((seg.side ?? 0) + swing) * first + seg.up * nz * 0.3 * (2 * u2 - 1);
  return { up: up * (Math.PI / 180), side: side * (Math.PI / 180) };
}

/** o primeiro tiro da rajada recua menos (a sniper não: cada tiro dela é um tiro só) */
export function firstShotK(spec: GunSpec, n: number): number {
  return n <= 1 && spec.cls !== 'sniper' ? FIRST_SHOT : 1;
}

/** quanto do recuo vale: mirando (0–1) a subida cai 40% e o lado 50%; agachado, mais 15% */
export function recoilMul(ads: number, crouch: boolean): { up: number; side: number } {
  const c = crouch ? 0.85 : 1;
  return { up: (1 - 0.4 * ads) * c, side: (1 - 0.5 * ads) * c };
}

/**
 * Quantos tiros a rajada ainda conta (fração), `since` ms depois do último: até o `recover.delay` da arma, nada;
 * depois, cai por exponencial junto com a volta da mira (mais devagar que ela). Clicar rápido não volta ao primeiro
 * tiro (soltar o gatilho não zera); parar de atirar esfria. O próximo tiro é o `shotIndex` disso.
 */
export function burstNow(spec: GunSpec, n: number, since: number): number {
  const rc = spec.recoil.recover;
  if (since <= rc.delay) return n;
  return n * Math.exp(-(since - rc.delay) / (1000 * BURST_COOL * rc.tau));
}

/** o número do próximo tiro da rajada (1 = o primeiro, com o bônus), com a rajada esfriada `cooled` */
export function shotIndex(cooled: number): number {
  return Math.floor(cooled) + 1;
}

/** quanto a dispersão abriu com a rajada (rad): `n` tiros, mirando (0–1) */
export function bloomNow(spec: GunSpec, n: number, ads: number): number {
  const b = spec.recoil.bloom;
  return Math.min(n, BLOOM_SHOTS) * (b.hip + (b.ads - b.hip) * ads);
}

/** dispersão atual (rad): mira (0–1 de transição) e movimento (0–1) */
export function spreadNow(spec: GunSpec, ads: number, moving: number, crouch: boolean): number {
  const base = spec.spread.hip + (spec.spread.ads - spec.spread.hip) * ads;
  return Math.max(0, base * (crouch ? 0.8 : 1) + spec.spread.move * moving * (1 - ads * 0.7));
}

/** o estado de quem atira, para a dispersão do tiro */
export interface ShotState {
  /** mira (0–1) e movimento (0–1) */
  ads: number;
  moving: number;
  crouch: boolean;
  grounded: boolean;
  sliding: boolean;
  /** na luneta (sniper com a mira quase toda) */
  scoped: boolean;
  /** o número do tiro na rajada (1 = o primeiro) */
  n: number;
}

/**
 * A dispersão do tiro (rad, meio ângulo); a mira desenhada usa a mesma conta. O bônus do primeiro tiro só reduz a
 * parte parada (base e mira); andar, pular e deslizar somam por cima e nunca ficam perfeitos, nem mirando. A sniper não
 * tem bônus de primeiro tiro (com o ferrolho, todo tiro seria o primeiro): sem a luneta ela abre com a dispersão do
 * quadril, que cai com a mira; só na luneta é precisa.
 */
export function shotSpread(spec: GunSpec, s: ShotState): number {
  const sniper = spec.cls === 'sniper';
  let still = sniper && s.scoped ? spec.spread.ads : spreadNow(spec, s.ads, 0, s.crouch);
  if (!sniper && s.n <= 1) still *= FIRST_SHOT * (1 - 0.5 * s.ads);
  still += bloomNow(spec, s.n - 1, s.ads);
  const move = spec.spread.move * s.moving * (1 - s.ads * 0.7);
  const air = s.grounded ? 0 : AIR_SPREAD[spec.cls] * (1 - 0.5 * s.ads);
  return still + move + air + (s.sliding ? SLIDE_SPREAD : 0);
}

// ---------------------------------------------------------------- acerto

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** caixa alinhada aos eixos (parede, contêiner, caixote) */
export interface Box {
  min: V3;
  max: V3;
}

/** alvo: cabeça (esfera) e corpo (cilindro vertical) */
export interface Target {
  id: string;
  x: number;
  y: number;
  z: number;
  crouch: boolean;
}

/** medidas do boneco (1,31 m) */
export const HEAD_R = 0.14;
export const BODY_R = 0.24;
export const headY = (crouch: boolean) => (crouch ? 0.86 : 1.16);
export const bodyTop = (crouch: boolean) => (crouch ? 0.74 : 1.02);
export const EYE = { stand: 1.12, crouch: 0.82 };

/** distância ao longo do raio até a caixa (ou Infinity) */
export function rayBox(o: V3, d: V3, b: Box): number {
  return rayBoxAxis(o, d, b).t;
}

const AXES = ['x', 'y', 'z'] as const;
/** distância até a caixa e o eixo da face que o raio cruzou (−1 = começou dentro dela) */
function rayBoxAxis(o: V3, d: V3, b: Box): { t: number; axis: number } {
  let t0 = 0;
  let t1 = Infinity;
  let axis = -1;
  for (let i = 0; i < 3; i++) {
    const k = AXES[i]!;
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return { t: Infinity, axis: -1 };
      continue;
    }
    let a = (b.min[k] - o[k]) / d[k];
    let c = (b.max[k] - o[k]) / d[k];
    if (a > c) [a, c] = [c, a];
    if (a > t0) {
      t0 = a;
      axis = i;
    }
    t1 = Math.min(t1, c);
    if (t0 > t1) return { t: Infinity, axis: -1 };
  }
  return { t: t0, axis };
}

function raySphere(o: V3, d: V3, c: V3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** raio contra o cilindro vertical do corpo (do pé até `top`) */
function rayBody(o: V3, d: V3, t: Target): number {
  const ox = o.x - t.x;
  const oz = o.z - t.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return Infinity;
  const b = ox * d.x + oz * d.z;
  const c = ox * ox + oz * oz - BODY_R * BODY_R;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  for (const tt of [(-b - s) / a, (-b + s) / a]) {
    if (tt < 0) continue;
    const y = o.y + d.y * tt - t.y;
    if (y >= 0 && y <= bodyTop(t.crouch)) return tt;
  }
  return Infinity;
}

export interface RayHit {
  /** null = parede, chão ou nada */
  target: string | null;
  head: boolean;
  dist: number;
  /** acertou uma caixa ou o chão: a normal da face (para a marca do tiro); ausente em alvo ou no vazio */
  normal?: V3;
}

/** o que o raio (direção unitária) acerta primeiro: alvo (cabeça ou corpo), parede ou chão, até `max` metros */
export function castShot(o: V3, d: V3, targets: Target[], boxes: readonly Box[], max = 200): RayHit {
  let best: RayHit = { target: null, head: false, dist: max };
  // o chão (y = 0): a bala para nele (não some por baixo do mapa)
  if (d.y < -1e-6 && o.y >= 0) {
    const t = -o.y / d.y;
    if (t < best.dist) best = { target: null, head: false, dist: t, normal: { x: 0, y: 1, z: 0 } };
  }
  for (const b of boxes) {
    const h = rayBoxAxis(o, d, b);
    if (h.t < best.dist) {
      const k = AXES[h.axis];
      const normal = k ? { x: 0, y: 0, z: 0, [k]: d[k] > 0 ? -1 : 1 } : undefined;
      best = { target: null, head: false, dist: h.t, ...(normal ? { normal } : {}) };
    }
  }
  for (const tg of targets) {
    const h = raySphere(o, d, { x: tg.x, y: tg.y + headY(tg.crouch), z: tg.z }, HEAD_R);
    if (h < best.dist) best = { target: tg.id, head: true, dist: h };
    const bd = rayBody(o, d, tg);
    if (bd < best.dist) best = { target: tg.id, head: false, dist: bd };
  }
  return best;
}

/** dá para ver de `a` até `b` (nenhuma caixa no caminho)? */
export function lineOfSight(a: V3, b: V3, boxes: Box[]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  for (const box of boxes) if (rayBox(a, d, box) < len) return false;
  return true;
}

/** ângulos (yaw, pitch) da câmera para olhar de `a` para `b` (a convenção de `aimDir`) */
export function lookAt(a: V3, b: V3): { yaw: number; pitch: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const h = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: -Math.atan2(dy, h) };
}

/** o dano mais alto que um golpe desta arma pode dar (tiro na cabeça de perto, faca ou coronhada) */
export function maxDamage(spec: GunSpec): number {
  return Math.max(Math.round(spec.dmg[0] * spec.head), spec.melee?.heavy ?? 0, spec.melee?.dmg ?? 0, BASH.dmg);
}

/** coronhada com a arma na mão (F) */
export const BASH = { dmg: 55, range: 1.7, ms: 500 } as const;
/** golpe pesado da faca (botão direito): mais lento e mais longe */
export const HEAVY = { ms: 1.5, range: 1.3 } as const;
/** golpe só vale com o alvo nesta diferença de altura (m) */
export const MELEE_DY = 1.2;

/** direção da mira (yaw, pitch) desviada pela dispersão: `u1`,`u2` em [0,1) (sorteio de quem chama) */
export function aimDir(yaw: number, pitch: number, spread: number, u1: number, u2: number): V3 {
  const r = spread * Math.sqrt(u1);
  const a = u2 * Math.PI * 2;
  const py = pitch + Math.sin(a) * r;
  // o yaw gira em volta do eixo vertical: olhando para cima ou para baixo, o mesmo ângulo de yaw abre menos na tela
  const yy = yaw + (Math.cos(a) * r) / Math.max(0.2, Math.cos(py));
  // frente da câmera: −z girado pelo yaw (convenção da cena: a câmera fica atrás olhando para −(sin, cos))
  return { x: -Math.sin(yy) * Math.cos(py), y: -Math.sin(py), z: -Math.cos(yy) * Math.cos(py) };
}
