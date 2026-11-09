/**
 * Cartuchos ejetados (gunfight): a cada tiro das semiautomáticas e automáticas, e no curso de abertura do ferrolho
 * das armas de ferrolho, um estojo de latão sai pela janela de ejeção (lado direito da caixa da culatra ou do
 * ferrolho da pistola) para a direita, para cima e um pouco para trás, girando; cai com a gravidade, quica no chão,
 * rola até parar, fica um tempo e encolhe até sumir.
 *
 * Tudo no mundo (um pool fixo de 30, uma malha instanciada, uma chamada de desenho): os da primeira pessoa nascem na
 * janela da arma do viewmodel levada para o mundo (o `game.ts` faz a conta pela tela), os dos bonecos (outras
 * pessoas, bots e eu em 3ª pessoa) na janela da arma deles. Pool cheio: o mais velho é reaproveitado.
 *
 * A física é pura (`stepCasing`), testada sem three.js.
 */
import type { GunId } from '@opencord/contracts';
import * as THREE from 'three';

/** quantos estojos no máximo, quanto duram (ms) e quanto do fim eles encolhem */
export const CASINGS = 30;
export const CASING_MS = 4000;
const SHRINK_MS = 600;
const G = 9.8;
/** quique: quanto da velocidade sobra na vertical e no chão (atrito), e abaixo de que velocidade ele deita */
const BOUNCE = 0.32;
const FRICTION = 0.55;
const REST_V = 0.35;

/** tamanho do estojo (m): comprimento e raio, pelo calibre */
interface Caliber {
  len: number;
  r: number;
}
const CAL: Record<string, Caliber> = {
  '556': { len: 0.045, r: 0.0048 },
  '762': { len: 0.039, r: 0.0056 },
  '46': { len: 0.03, r: 0.004 },
  '9': { len: 0.019, r: 0.0049 },
  '338': { len: 0.069, r: 0.0074 },
  '408': { len: 0.077, r: 0.008 },
  '792': { len: 0.057, r: 0.006 },
  '50ae': { len: 0.033, r: 0.0068 },
};
const GUN_CAL: Partial<Record<GunId, string>> = {
  m4: '556',
  ak47: '762',
  mp7: '46',
  mp5: '9',
  m9: '9',
  l115: '338',
  m200: '408',
  kar98k: '792',
  deagle: '50ae',
  scarl: '556',
  mcx: '556',
  aks74u: '556',
  stg44: '762',
  mpx: '9',
  msmc: '9',
  pdw: '46',
  rs9: '338',
  ballista: '338',
  sv98: '792',
  automag3: '9',
};

/**
 * Janela de ejeção (espaço da arma: frente em −z, cima em +y, origem no punho), medida nos modelos: na lateral
 * direita da caixa da culatra, na altura do ferrolho, logo acima do poço do pente; na pistola, no ferrolho.
 */
export const PORT: Partial<Record<GunId, THREE.Vector3Tuple>> = {
  m4: [0.026, 0.078, -0.095],
  ak47: [0.026, 0.072, -0.14],
  mp7: [0.022, 0.056, 0.01],
  mp5: [0.024, 0.095, -0.1],
  l115: [0.028, 0.085, -0.1],
  m200: [0.03, 0.07, -0.12],
  kar98k: [0.02, 0.09, -0.1],
  m9: [0.013, 0.066, -0.03],
  deagle: [0.02, 0.07, -0.03],
  scarl: [0.026, 0.088, -0.11],
  mcx: [0.022, 0.085, -0.1],
  aks74u: [0.022, 0.075, -0.15],
  stg44: [0.025, 0.06, -0.15],
  mpx: [0.024, 0.075, -0.1],
  msmc: [0.02, 0.07, -0.05],
  pdw: [0.02, 0.075, -0.1],
  rs9: [0.028, 0.06, -0.11],
  ballista: [0.03, 0.075, -0.1],
  sv98: [0.024, 0.065, -0.09],
  automag3: [0.016, 0.055, -0.02],
};

/** a boca de cada arma no espaço dela (y, z): nos bonecos, a janela sai da boca (que eles informam) para trás */
const MUZZLE: Partial<Record<GunId, [number, number]>> = {
  m4: [0.038, -0.58],
  ak47: [-0.004, -0.579],
  mp7: [0.002, -0.247],
  mp5: [0.034, -0.361],
  l115: [0.076, -0.951],
  m200: [0.082, -1.032],
  kar98k: [0.03, -0.781],
  m9: [0.023, -0.148],
  deagle: [0.057, -0.191],
  scarl: [0.08, -0.565],
  mcx: [0.078, -0.601],
  aks74u: [0.058, -0.429],
  stg44: [0.076, -0.597],
  mpx: [0.076, -0.364],
  msmc: [0.058, -0.297],
  pdw: [0.069, -0.404],
  rs9: [0.079, -0.904],
  ballista: [0.082, -0.932],
  sv98: [0.08, -0.872],
  automag3: [0.04, -0.17],
  rhino: [0.052, -0.209],
  bfr: [0.078, -0.293],
};
/** a arma do boneco é menor que a da primeira pessoa (escala do boneco, ~0,85) */
const DOLL_GUN = 0.85;

/** velocidade de saída no espaço da arma (m/s): para a direita, para cima e para trás (pistola mais alto) */
const OUT_RIFLE: THREE.Vector3Tuple = [2.6, 1.5, 0.7];
const OUT_PISTOL: THREE.Vector3Tuple = [1.7, 2.1, 0.5];
/** no ferrolho a mão puxa devagar: o estojo pula para fora e para trás, sem força */
const OUT_BOLT: THREE.Vector3Tuple = [1.4, 1.9, 0.6];

export type EjectKind = 'rifle' | 'pistol' | 'bolt';

/** a velocidade de saída (espaço da arma), com um pouco de variação (`r1`, `r2`, `r3` em 0–1) */
export function ejectVelocity(kind: EjectKind, r1: number, r2: number, r3: number, out: THREE.Vector3): THREE.Vector3 {
  const b = kind === 'pistol' ? OUT_PISTOL : kind === 'bolt' ? OUT_BOLT : OUT_RIFLE;
  return out.set(b[0] * (0.85 + 0.3 * r1), b[1] * (0.8 + 0.4 * r2), b[2] * (0.6 + 0.8 * r3));
}

/** um estojo (estado da física, sem three.js nos números) */
export interface Casing {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** giro (eixo e velocidade em rad/s) e o ângulo acumulado */
  ax: number;
  ay: number;
  az: number;
  spin: number;
  angle: number;
  /** a altura do chão embaixo dele (o pé de quem atirou) */
  floor: number;
  /** meio comprimento e raio (para encostar no chão deitado) */
  r: number;
  born: number;
  resting: boolean;
  /** quantas vezes já quicou */
  bounces: number;
}

/**
 * Um passo da física (`dt` em s): gravidade, chão (quica perdendo força, o atrito freia, abaixo de `REST_V` deita e
 * para). Devolve `true` se quicou neste passo (para um som de tilintar, se alguém quiser).
 */
export function stepCasing(c: Casing, dt: number): boolean {
  if (c.resting) return false;
  c.vy -= G * dt;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.z += c.vz * dt;
  c.angle += c.spin * dt;
  const ground = c.floor + c.r;
  if (c.y > ground) return false;
  c.y = ground;
  if (c.vy >= 0) return false;
  c.bounces++;
  c.vy = -c.vy * BOUNCE;
  c.vx *= FRICTION;
  c.vz *= FRICTION;
  c.spin *= 0.5;
  if (c.vy < REST_V) {
    c.vy = 0;
    c.vx = 0;
    c.vz = 0;
    c.spin = 0;
    c.resting = true;
  }
  return true;
}

/** escala do estojo no fim da vida (encolhe nos últimos `SHRINK_MS`); 0 = acabou */
export function casingScale(age: number): number {
  if (age >= CASING_MS || age < 0) return 0;
  return Math.min(1, (CASING_MS - age) / SHRINK_MS);
}

/**
 * Pool de estojos: `slot()` devolve o índice livre, ou o do mais velho (o pool nunca passa de `size`). Puro, para
 * testar o limite.
 */
export class CasingPool {
  readonly items: (Casing | null)[];
  constructor(readonly size = CASINGS) {
    this.items = new Array<Casing | null>(size).fill(null);
  }
  slot(): number {
    let oldest = 0;
    for (let i = 0; i < this.size; i++) {
      const it = this.items[i];
      if (!it) return i;
      if (it.born < this.items[oldest]!.born) oldest = i;
    }
    return oldest;
  }
  add(c: Casing): number {
    const i = this.slot();
    this.items[i] = c;
    return i;
  }
  get live(): number {
    return this.items.filter(Boolean).length;
  }
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();
const AX = new THREE.Vector3();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const FWD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UPV = new THREE.Vector3();
const AT = new THREE.Vector3();
const VEL = new THREE.Vector3();
const GV = new THREE.Vector3();

/** os estojos na cena: uma malha instanciada de latão (cilindro de comprimento 1, escalado pelo calibre) */
export class Casings {
  readonly mesh: THREE.InstancedMesh;
  private readonly pool = new CasingPool();
  /** o tamanho de cada um (comprimento e raio) e o giro inicial (o eixo do estojo) */
  private readonly size: Caliber[] = [];
  private readonly base: THREE.Quaternion[] = [];
  private seed = 1;

  constructor(scene: THREE.Scene) {
    // estojo: corpo, ombro afinando e o gargalo (de pé em y, centrado), achatado num cilindro só de 8 lados
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a043, metalness: 0.85, roughness: 0.32 });
    this.mesh = new THREE.InstancedMesh(geo, mat, CASINGS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    for (let i = 0; i < CASINGS; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.size.push({ len: 0.04, r: 0.005 });
      this.base.push(new THREE.Quaternion());
    }
    this.mesh.count = CASINGS;
    scene.add(this.mesh);
  }

  private rand(): number {
    // pseudoaleatório próprio (não mexe no Math.random de quem testa)
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /**
   * Solta um estojo da arma `w` em `at` (mundo), com a velocidade `vel` (mundo, já com a do atirador), o eixo do cano
   * `axis` (mundo; o estojo sai deitado ao longo dele) e o chão `floor` (y do mundo).
   */
  eject(w: GunId, at: THREE.Vector3, vel: THREE.Vector3, axis: THREE.Vector3, floor: number, now: number) {
    const cal = CAL[GUN_CAL[w] ?? '556']!;
    const r1 = this.rand();
    const r2 = this.rand();
    AX.set(r1 - 0.5, 0.4 + r2, 0.2).normalize();
    const c: Casing = {
      x: at.x,
      y: at.y,
      z: at.z,
      vx: vel.x,
      vy: vel.y,
      vz: vel.z,
      ax: AX.x,
      ay: AX.y,
      az: AX.z,
      spin: 14 + 10 * r1,
      angle: 0,
      floor,
      r: cal.r,
      born: now,
      resting: false,
      bounces: 0,
    };
    const i = this.pool.add(c);
    this.size[i] = cal;
    // o eixo do estojo (y da malha) ao longo do cano
    this.base[i]!.setFromUnitVectors(UP, P.copy(axis).normalize());
  }

  /** anda a física e põe as matrizes; `dt` em s */
  update(dt: number, now: number) {
    let dirty = false;
    // passos de no máximo 1/120 s (o quique não atravessa o chão a 30 qps)
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / n;
    for (let i = 0; i < CASINGS; i++) {
      const c = this.pool.items[i];
      if (!c) continue;
      const age = now - c.born;
      // ainda não saiu (o do ferrolho espera a mão abrir a culatra)
      if (age < 0) {
        this.mesh.setMatrixAt(i, HIDDEN);
        dirty = true;
        continue;
      }
      const k = casingScale(age);
      if (k <= 0) {
        this.pool.items[i] = null;
        this.mesh.setMatrixAt(i, HIDDEN);
        dirty = true;
        continue;
      }
      for (let s = 0; s < n; s++) stepCasing(c, h);
      // deitado no chão: o eixo fica na horizontal (gira em volta do próprio eixo vertical do giro)
      Q.copy(this.base[i]!);
      if (c.resting) {
        AX.set(0, 1, 0).applyQuaternion(Q);
        AX.y = 0;
        if (AX.lengthSq() < 1e-6) AX.set(1, 0, 0);
        Q.setFromUnitVectors(UP, AX.normalize());
      } else Q.premultiply(Q2.setFromAxisAngle(AX.set(c.ax, c.ay, c.az), c.angle));
      const cal = this.size[i]!;
      S.set(cal.r * 2 * k, cal.len * k, cal.r * 2 * k);
      M.compose(P.set(c.x, c.y, c.z), Q, S);
      this.mesh.setMatrixAt(i, M);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Estojo de um boneco (outra pessoa, bot, ou eu em 3ª pessoa): a janela sai da boca da arma dele (`muzzle`, mundo)
   * e da direção do tiro (`dir`), sem rolagem; `delay` (ms) para o do ferrolho, que sai quando a mão abre a culatra.
   */
  ejectFrom(
    w: GunId,
    muzzle: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    vel0: { x: number; y: number; z: number } | null,
    floor: number,
    now: number,
    delay = 0,
  ) {
    const port = PORT[w];
    const mz = MUZZLE[w];
    if (!port || !mz) return;
    const f = FWD.set(dir.x, dir.y, dir.z);
    if (f.lengthSq() < 1e-8) return;
    f.normalize();
    RIGHT.crossVectors(f, UP);
    if (RIGHT.lengthSq() < 1e-6) RIGHT.set(1, 0, 0);
    RIGHT.normalize();
    UPV.crossVectors(RIGHT, f);
    // espaço da arma: x direita, y cima, z para trás (−frente)
    const dx = port[0] * DOLL_GUN;
    const dy = (port[1] - mz[0]) * DOLL_GUN;
    const dz = (port[2] - mz[1]) * DOLL_GUN;
    AT.set(muzzle.x, muzzle.y, muzzle.z).addScaledVector(RIGHT, dx).addScaledVector(UPV, dy).addScaledVector(f, -dz);
    const kind = ejectKind(w, delay > 0);
    ejectVelocity(kind, this.rand(), this.rand(), this.rand(), GV);
    VEL.set(0, 0, 0).addScaledVector(RIGHT, GV.x).addScaledVector(UPV, GV.y).addScaledVector(f, -GV.z);
    if (vel0) VEL.add(P.set(vel0.x, vel0.y, vel0.z));
    this.eject(w, AT, VEL, f, floor, now + delay);
  }

  /** quantos estão no mundo agora */
  get live(): number {
    return this.pool.live;
  }

  clear() {
    for (let i = 0; i < CASINGS; i++) {
      this.pool.items[i] = null;
      this.mesh.setMatrixAt(i, HIDDEN);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** a classe de saída da arma (pistola sobe mais; ferrolho sai fraco) */
export function ejectKind(w: GunId, bolt: boolean): EjectKind {
  if (bolt) return 'bolt';
  return w === 'm9' || w === 'deagle' || w === 'automag3' ? 'pistol' : 'rifle';
}
