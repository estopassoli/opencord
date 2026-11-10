/**
 * Magnum BFR na primeira pessoa (dados e contas puras; o `viewmodel.ts` aplica, sempre guardado por `g.id === 'bfr'`).
 *
 * O BFR é de ação simples: o cão precisa ser armado pelo polegar antes de cada tiro, e armar o cão gira o tambor um
 * furo (5 furos, 72°). O cão vem na malha da armação: `splitHammer` separa os triângulos dele numa peça que gira no
 * pino. Recarga: o jogo usa tambor que abre para o lado com carregador rápido (o BFR de verdade tem portinhola, um
 * cartucho por vez); a ordem é a de um revólver de tambor basculante: desarma o cão, o tambor sai no braço (gira em
 * volta de um eixo embaixo à esquerda e sai da armação), cano para cima e o polegar empurra a vareta (os estojos caem),
 * cano para baixo, a mão traz o carregador rápido do cinto, alinha e empurra os cartuchos, larga o carregador vazio,
 * fecha o tambor (gira até parar num furo) e o polegar arma o cão.
 *
 * Trilhas de chaves como as da karambit (`track`): [fração, valor, curva].
 */
import * as THREE from 'three';
import { track, type Key } from './karambit';
import type { GunModel } from './models';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (u: number) => u * u * (3 - 2 * u);
const seg = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));

/** 5 furos: um furo do tambor (rad) */
export const BFR_CHAMBER = (Math.PI * 2) / 5;
/** o cão armado: giro para trás em volta do pino (rad) */
export const BFR_COCK = 0.55;

/** a malha que traz o cão (com o gatilho e peças pequenas) e a caixa dos triângulos do cão (espaço da arma) */
const HAMMER_MESH = 'Cube001_0002_2';
const HAMMER_MIN_Y = 0.035;
const HAMMER_MIN_Z = -0.035;
const HAMMER_X = -0.005;
const HAMMER_HALF_X = 0.0045;
/** o pino do cão (espaço da arma) */
const HAMMER_PIVOT = new THREE.Vector3(-0.005, 0.038, -0.002);

export interface Hammer {
  obj: THREE.Mesh;
  /** o eixo do pino (o +x da arma) no espaço da malha */
  axis: THREE.Vector3;
}

/**
 * Separa o cão da malha da armação (uma cópia da geometria só desta arma; a do arquivo fica) numa malha filha com a
 * origem no pino. Uma vez, no `setGun`.
 */
export function splitHammer(g: GunModel): Hammer | null {
  let src: THREE.Mesh | null = null;
  g.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === HAMMER_MESH) src = o;
  });
  const mesh = src as THREE.Mesh | null;
  if (!mesh || !mesh.geometry.index) return null;
  g.root.updateMatrixWorld(true);
  const toGun = new THREE.Matrix4().copy(g.root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const geo = mesh.geometry.clone();
  const idx = geo.index!;
  const pos = geo.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const keep: number[] = [];
  const ham: number[] = [];
  for (let t = 0; t + 2 < idx.count; t += 3) {
    a.fromBufferAttribute(pos, idx.getX(t)).applyMatrix4(toGun);
    b.fromBufferAttribute(pos, idx.getX(t + 1)).applyMatrix4(toGun);
    c.fromBufferAttribute(pos, idx.getX(t + 2)).applyMatrix4(toGun);
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const isHam = cy > HAMMER_MIN_Y && cz > HAMMER_MIN_Z && Math.abs(cx - HAMMER_X) < HAMMER_HALF_X;
    (isHam ? ham : keep).push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
  }
  if (!ham.length) {
    geo.dispose();
    return null;
  }
  geo.setIndex(keep);
  // o pino no espaço da malha: o cão gira em volta dele
  const fromGun = toGun.clone().invert();
  const pivot = HAMMER_PIVOT.clone().applyMatrix4(fromGun);
  const hg = mesh.geometry.clone();
  hg.setIndex(ham);
  hg.translate(-pivot.x, -pivot.y, -pivot.z);
  mesh.geometry = geo;
  mesh.userData.own = true;
  const obj = new THREE.Mesh(hg, mesh.material);
  obj.name = 'hammer';
  obj.userData.own = true;
  obj.position.copy(pivot);
  obj.frustumCulled = false;
  mesh.add(obj);
  const axis = new THREE.Vector3(1, 0, 0).transformDirection(fromGun);
  return { obj, axis };
}

/** o cão no giro `cocked` (0 abaixado, 1 armado) */
export function poseHammer(h: Hammer, cocked: number) {
  h.obj.quaternion.setFromAxisAngle(h.axis, BFR_COCK * cocked);
}

/**
 * O gesto do polegar no cão, em ms desde o começo (o `speed` encurta): sobe até a espora (`reach` 0–1), puxa (ou segura
 * descendo, `decock`) e volta para o punho. `ham` é o cão (0 abaixado, 1 armado), sempre com o polegar nele enquanto
 * `reach` > 0.
 */
export const COCK_MS = 380;
export interface CockPose {
  reach: number;
  ham: number;
}
export function cockAt(ms: number, decock: boolean, out: CockPose): CockPose {
  out.reach = ease(seg(ms, 0, 110)) * (1 - ease(seg(ms, 270, COCK_MS)));
  const pull = ease(seg(ms, 110, 260));
  out.ham = decock ? 1 - pull : pull;
  return out;
}

/**
 * A mão direita enquanto o polegar está no cão (espaço da arma; medido com a ponta do polegar na espora): a mão sobe
 * um pouco no punho (a arma rola na mão, como num revólver de ação simples de verdade) e o polegar estica por cima da
 * armação. Com o cão abaixado (espora alta) e armado (espora atrás e mais baixa).
 */
export const COCK_SHIFT_DOWN = new THREE.Vector3(0.006, 0.02, -0.006);
export const COCK_SHIFT_UP = new THREE.Vector3(0.008, 0.008, 0.006);
/** o polegar: [fechamento total, abertura para o lado da palma] com o cão abaixado e armado */
export const COCK_THUMB_DOWN: readonly [number, number] = [0, 0.32];
export const COCK_THUMB_UP: readonly [number, number] = [0, 0.45];

/**
 * O tambor no braço (guindaste): gira em volta de um eixo paralelo ao cano, embaixo e à esquerda dele, e sai inteiro
 * da armação. `out` 0–1 → deslocamento do centro do tambor (espaço da arma, escreve em `d`).
 */
const CRANE = { x: -0.03, y: 0.03, open: 1.5 };
export function craneOffset(center: THREE.Vector3, out: number, d: THREE.Vector3): THREE.Vector3 {
  const rx = center.x - CRANE.x;
  const ry = center.y - CRANE.y;
  const a = CRANE.open * out;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return d.set(CRANE.x + rx * ca - ry * sa - center.x, CRANE.y + rx * sa + ry * ca - center.y, 0);
}

/**
 * O braço do tambor (o modelo não tem): uma barra curta da armação (no eixo do guindaste) até o centro do tambor, na
 * frente dele. Só aparece com o tambor fora; sem ela, o tambor aberto parecia solto no ar.
 */
export function craneArm(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 0.007, 0.006).translate(0.5, 0, 0);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x9a9da3, metalness: 0.8, roughness: 0.35 }),
  );
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

/** põe o braço do tambor: do eixo do guindaste até o centro do tambor deslocado `d`, em `z` (face da frente) */
export function placeCraneArm(arm: THREE.Mesh, center: THREE.Vector3, d: THREE.Vector3, z: number, out: number) {
  arm.visible = out > 0.02;
  if (!arm.visible) return;
  const dx = center.x + d.x - CRANE.x - 0.008;
  const dy = center.y + d.y - CRANE.y;
  arm.position.set(CRANE.x + 0.008, CRANE.y, z);
  arm.rotation.set(0, 0, Math.atan2(dy, dx));
  arm.scale.set(Math.hypot(dx, dy), 1, 1);
}

/**
 * Recarga (2900 ms). Momentos que batem com os sons do `game.ts`: tambor abre em 0,18, cartuchos entram em 0,6, tambor
 * fecha em 0,8.
 *
 * Arma (somada à pose, espaço da câmera): `px`, `py`, `pz` (m) e `rx` (cano para cima +), `ry`, `rz` (rad; `rz`
 * negativo deita o topo para a direita, o lado do tambor aberto para cima).
 * Mão esquerda (pesos 0–1): `cradle` (embaixo do tambor, andando com ele), `belt` (no cinto, fora da tela), `loader`
 * (segurando o carregador rápido atrás do tambor). Tambor: `out` (0–1 no braço), `spin` (rad). Carregador: `lz`
 * (m atrás da face do tambor; 0 = cartuchos dentro). Polegar da esquerda na vareta: `rod` (0–1).
 */
type RlTrack = 'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz' | 'cradle' | 'belt' | 'loader' | 'out' | 'spin' | 'lz' | 'rod';
// prettier-ignore
const RL: Record<RlTrack, readonly Key[]> = {
  px: [[0, 0], [0.14, -0.035], [0.3, -0.03], [0.4, -0.05], [0.66, -0.05], [0.84, -0.03], [1, 0]],
  py: [[0, 0], [0.14, 0.07], [0.3, 0.075], [0.4, 0.075], [0.66, 0.075], [0.84, 0.06], [1, 0]],
  pz: [[0, 0], [0.14, 0.02], [0.3, 0.02], [0.4, -0.01], [0.66, -0.01], [0.84, 0.01], [1, 0]],
  rx: [[0, 0], [0.14, 0.3], [0.2, 0.35], [0.26, 0.85, 1], [0.3, 0.8], [0.4, 0.1], [0.66, 0.1], [0.8, 0.15], [0.9, 0.05], [1, 0]],
  ry: [[0, 0], [0.14, 0.1], [0.3, 0.1], [0.4, -0.1], [0.66, -0.1], [0.84, 0.0], [1, 0]],
  rz: [[0, 0], [0.14, -0.45], [0.3, -0.35], [0.4, -0.35], [0.66, -0.35], [0.84, -0.25], [1, 0]],
  cradle: [[0, 0], [0.06, 0], [0.16, 1], [0.84, 1], [0.94, 0]],
  belt: [[0, 0], [0.3, 0], [0.38, 1], [0.4, 1], [0.48, 0]],
  loader: [[0, 0], [0.4, 0], [0.5, 1], [0.62, 1], [0.7, 0]],
  out: [[0, 0], [0.1, 0], [0.2, 1, 1], [0.72, 1], [0.8, 0, 2]],
  spin: [[0, 0], [0.12, 0], [0.32, BFR_CHAMBER * 1.5, 1], [0.74, BFR_CHAMBER * 1.5], [0.82, BFR_CHAMBER * 2, 1]],
  lz: [[0, 0.07], [0.46, 0.07], [0.52, 0.028], [0.54, 0.028], [0.6, 0]],
  rod: [[0, 0], [0.21, 0], [0.26, 1, 1], [0.29, 1], [0.32, 0]],
};

export const BFR_LOADER_SHOW = 0.37;
export const BFR_LOADER_DROP = 0.63;
export const BFR_DUMP_AT = 0.26;
export const BFR_SEAT_AT = 0.6;
export const BFR_CLOSE_AT = 0.8;
/** o desarme (começo) e o armar (fim) da recarga: momentos e velocidade do gesto do polegar */
export const BFR_RL_DECOCK = { at: 0, speed: 1.35 } as const;
export const BFR_RL_COCK = { at: 0.84, speed: 1.15 } as const;

const RL_KEYS = Object.keys(RL) as RlTrack[];

export type BfrReload = Record<RlTrack, number>;
export function bfrReload(u: number, out: BfrReload): BfrReload {
  for (const k of RL_KEYS) out[k] = track(u, RL[k]);
  return out;
}
export function blankBfrReload(): BfrReload {
  return {
    px: 0,
    py: 0,
    pz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    cradle: 0,
    belt: 0,
    loader: 0,
    out: 0,
    spin: 0,
    lz: 0,
    rod: 0,
  };
}

/**
 * Coronhada (500 ms; o acerto é em 160 ms = 0,32): arma o braço para trás e para cima à direita, o cano sobe
 * (antecipação), desce batendo com a armação para baixo e para a esquerda, passando pelo meio da tela no acerto, segue
 * desacelerando e volta. A esquerda solta e sai do caminho.
 * Inspeção (2400 ms, uma mão): vira o lado esquerdo (tambor, sem a mão na frente) com o cano para a esquerda, para;
 * rola e levanta o cano mostrando o lado direito e o topo, para; volta passando um pouco do ponto.
 */
type MoveTrack = 'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz' | 'away';
// prettier-ignore
export const BFR_MELEE: Record<MoveTrack, readonly Key[]> = {
  px: [[0, 0], [0.16, 0.035, 2], [0.32, -0.1, 1], [0.46, -0.12], [1, 0]],
  py: [[0, 0], [0.16, 0.04, 2], [0.32, -0.05, 1], [0.46, -0.065], [1, 0]],
  pz: [[0, 0], [0.16, 0.02, 2], [0.32, -0.09, 1], [0.46, -0.08], [1, 0]],
  rx: [[0, 0], [0.16, 0.45, 2], [0.32, -0.45, 1], [0.46, -0.55], [1, 0]],
  ry: [[0, 0], [0.16, -0.12, 2], [0.32, 0.3, 1], [0.46, 0.35], [1, 0]],
  rz: [[0, 0], [0.16, -0.25, 2], [0.32, 0.55, 1], [0.46, 0.65], [1, 0]],
  away: [[0, 0], [0.12, 1], [0.6, 1], [0.86, 0]],
};
// prettier-ignore
export const BFR_INSPECT: Record<MoveTrack, readonly Key[]> = {
  px: [[0, 0], [0.06, 0.01], [0.22, -0.07], [0.46, -0.075], [0.6, -0.11], [0.8, -0.115], [0.94, 0.004], [1, 0]],
  py: [[0, 0], [0.06, -0.01], [0.22, 0.05], [0.46, 0.055], [0.6, 0.06], [0.8, 0.065], [0.94, -0.004], [1, 0]],
  pz: [[0, 0], [0.22, -0.04], [0.46, -0.045], [0.6, -0.07], [0.8, -0.075], [1, 0]],
  rx: [[0, 0], [0.06, -0.06], [0.22, 0.1], [0.46, 0.12], [0.6, 0.15], [0.8, 0.17], [0.94, -0.04], [1, 0]],
  ry: [[0, 0], [0.06, -0.05], [0.22, 0.95], [0.46, 1.0], [0.6, -1.1], [0.8, -1.15], [0.94, 0.02], [1, 0]],
  rz: [[0, 0], [0.22, 0.2], [0.46, 0.22], [0.6, -0.25], [0.8, -0.28], [0.94, 0.03], [1, 0]],
  away: [[0, 0], [0.04, 0], [0.18, 1], [0.84, 1], [0.98, 0]],
};
const MOVE_KEYS: readonly MoveTrack[] = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'away'];

export type BfrMove = Record<MoveTrack, number>;
export function bfrMove(t: Record<MoveTrack, readonly Key[]>, u: number, out: BfrMove): BfrMove {
  for (const k of MOVE_KEYS) out[k] = track(u, t[k]);
  return out;
}
export function blankBfrMove(): BfrMove {
  return { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, away: 0 };
}
