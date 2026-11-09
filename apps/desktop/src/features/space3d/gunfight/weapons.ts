/**
 * Gunfight do Espaço 3D (zona 8, todos contra todos): as armas e as contas do tiro. Sem three.js aqui: tudo puro e
 * testado (dano pela distância, cadência, recuo, dispersão, acerto do raio na cabeça e no corpo).
 * Os números são nossos, pensados para partidas curtas entre amigos: fuzil mata com 3–5 tiros no corpo (a AK bate mais
 * forte e sobe mais; o M4 é mais rápido e controlável), submetralhadora com 4 de perto (de perto ela mata mais rápido
 * que o M4; de longe cai muito), L115 e M200 com 1 no peito
 * (a Kar98k só na cabeça, em troca do ferrolho e da mira rápidos), pistola com 2–6, faca com 1.
 */
import type { GunId } from '@opencord/contracts';

export type GunClass = 'ar' | 'smg' | 'sniper' | 'pistol' | 'knife';
export type GunSlot = 'primary' | 'secondary' | 'melee';

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
  /** recuo por tiro (rad): para cima e para o lado (o lado sorteia o sinal com viés) */
  recoil: { up: number; side: number };
  /** dispersão (rad, meio ângulo): no quadril, mirando, e o acréscimo andando */
  spread: { hip: number; ads: number; move: number };
  /** velocidade de andar (1 = normal) */
  move: number;
  /** ferrolho: tempo para engatilhar o próximo tiro (ms) */
  boltMs?: number;
  /** faca: dano, alcance (m) e duração do golpe (ms) */
  melee?: { dmg: number; range: number; ms: number };
}

const g = (s: GunSpec) => s;

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
    recoil: { up: 0.011, side: 0.005 },
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
    recoil: { up: 0.017, side: 0.009 },
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
    recoil: { up: 0.008, side: 0.006 },
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
    recoil: { up: 0.009, side: 0.005 },
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
    recoil: { up: 0.06, side: 0.01 },
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
    recoil: { up: 0.07, side: 0.012 },
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
    recoil: { up: 0.05, side: 0.008 },
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
    recoil: { up: 0.02, side: 0.006 },
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
    recoil: { up: 0.055, side: 0.012 },
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
    recoil: { up: 0, side: 0 },
    spread: { hip: 0, ads: 0, move: 0 },
    move: 1.12,
    melee: { dmg: 150, range: 2, ms: 450 },
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
    recoil: { up: 0, side: 0 },
    spread: { hip: 0, ads: 0, move: 0 },
    move: 1.1,
    melee: { dmg: 150, range: 2.2, ms: 550 },
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
/** partida: quem chegar primeiro a tantos abates ganha */
export const FFA_TARGET = 30;
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

/** dispersão atual (rad): mira (0–1 de transição) e movimento (0–1) */
export function spreadNow(spec: GunSpec, ads: number, moving: number, crouch: boolean): number {
  const base = spec.spread.hip + (spec.spread.ads - spec.spread.hip) * ads;
  return Math.max(0, base * (crouch ? 0.8 : 1) + spec.spread.move * moving * (1 - ads * 0.7));
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
  let t0 = 0;
  let t1 = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return Infinity;
      continue;
    }
    let a = (b.min[k] - o[k]) / d[k];
    let c = (b.max[k] - o[k]) / d[k];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
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
  /** null = parede ou nada */
  target: string | null;
  head: boolean;
  dist: number;
}

/** o que o raio (direção unitária) acerta primeiro: alvo (cabeça ou corpo) ou parede, até `max` metros */
export function castShot(o: V3, d: V3, targets: Target[], boxes: Box[], max = 200): RayHit {
  let best: RayHit = { target: null, head: false, dist: max };
  for (const b of boxes) {
    const t = rayBox(o, d, b);
    if (t < best.dist) best = { target: null, head: false, dist: t };
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
  return Math.max(Math.round(spec.dmg[0] * spec.head), spec.melee?.dmg ?? 0, BASH.dmg);
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
  const yy = yaw + Math.cos(a) * r;
  // frente da câmera: −z girado pelo yaw (convenção da cena: a câmera fica atrás olhando para −(sin, cos))
  return { x: -Math.sin(yy) * Math.cos(py), y: -Math.sin(py), z: -Math.cos(yy) * Math.cos(py) };
}
