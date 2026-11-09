/**
 * Sinuca do Espaço 3D (ADR-0055): física das 16 bolas (atrito, choque elástico, tabelas, caçapas) e a partida.
 * Vez por pessoa, em rodízio que alterna os times (`rules.poolTurn`): quem encaçapa joga de novo; sem encaçapar (ou
 * com a branca na caçapa) a vez passa. Sozinho na mesa, todas as tacadas são suas (treino). Sem a lista de quem está
 * na mesa (`PoolHooks.players`), vale a vez por time, como antes. Cada bola colorida encaçapada vale 1 ponto para o
 * time de quem tacou. Quem tacou simula e transmite; os outros seguem.
 */
import * as THREE from 'three';
import { power01, type GameEvent } from './events';
import { nextAuthority } from './net/authority';
import { poolTurn, type PoolRota, type PoolSeat } from './rules';

export const POOL_HX = 1.27;
export const POOL_HZ = 0.635;
export const POOL_Y = 0.8;
export const POOL_R = 0.028;
const POCKET_R = 0.065;
/** desaceleração ao rolar (m/s²) */
const FRICTION = 0.42;
const CUSHION = 0.78;
export const MAX_SHOT = 4.2;

export interface PoolBall {
  x: number;
  z: number;
  vx: number;
  vz: number;
  in: boolean;
}

export const POCKETS = [
  [-POOL_HX, -POOL_HZ],
  [0, -POOL_HZ - 0.01],
  [POOL_HX, -POOL_HZ],
  [-POOL_HX, POOL_HZ],
  [0, POOL_HZ + 0.01],
  [POOL_HX, POOL_HZ],
] as const;

export const CUE_START = { x: -POOL_HX / 2, z: 0 };

/** mesa arrumada: branca à esquerda, triângulo de 15 bolas à direita */
export function rack(): PoolBall[] {
  const balls: PoolBall[] = [{ ...CUE_START, vx: 0, vz: 0, in: false }];
  const d = POOL_R * 2 + 0.002;
  const x0 = POOL_HX / 2;
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++)
      balls.push({ x: x0 + row * d * 0.866, z: (i - row / 2) * d, vx: 0, vz: 0, in: false });
  return balls;
}

export function moving(balls: PoolBall[]): boolean {
  return balls.some((b) => !b.in && Math.hypot(b.vx, b.vz) > 0.003);
}

/** abaixo disso (m/s) o contato não vira evento (bolas encostadas) */
const QUIET_V = 0.02;

/**
 * Um passo da física; devolve os índices das bolas que caíram na caçapa agora. Se `fx` vier, acrescenta nela os
 * contatos (ADR-0056): `ballHit` (com a velocidade relativa), `cushion` (tabela) e `pocket`.
 */
export function stepPool(balls: PoolBall[], dt: number, fx?: GameEvent[]): number[] {
  const fell: number[] = [];
  const at = (b: PoolBall) => ({ x: b.x, y: POOL_Y + POOL_R, z: b.z });
  const sub = 6;
  const h = dt / sub;
  for (let s = 0; s < sub; s++) {
    for (const b of balls) {
      if (b.in) continue;
      b.x += b.vx * h;
      b.z += b.vz * h;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0) {
        const k = Math.max(0, sp - FRICTION * h) / sp;
        b.vx *= k;
        b.vz *= k;
      }
    }
    // choque entre bolas (massas iguais, elástico)
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]!;
      if (a.in) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]!;
        if (b.in) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= POOL_R * 2 || d < 1e-9) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = POOL_R * 2 - d;
        a.x -= (nx * overlap) / 2;
        a.z -= (nz * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.z += (nz * overlap) / 2;
        const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (rel <= 0) continue;
        if (fx && rel > QUIET_V)
          fx.push({
            kind: 'ballHit',
            a: i,
            b: j,
            v: rel,
            power: power01(rel, MAX_SHOT),
            zone: 6,
            at: { x: (a.x + b.x) / 2, y: POOL_Y + POOL_R, z: (a.z + b.z) / 2 },
          });
        a.vx -= rel * nx;
        a.vz -= rel * nz;
        b.vx += rel * nx;
        b.vz += rel * nz;
      }
    }
    for (const [i, b] of balls.entries()) {
      if (b.in) continue;
      // caçapas
      if (POCKETS.some(([px, pz]) => Math.hypot(b.x - px, b.z - pz) < POCKET_R)) {
        fx?.push({ kind: 'pocket', ball: i, power: power01(Math.hypot(b.vx, b.vz), MAX_SHOT), zone: 6, at: at(b) });
        b.in = true;
        b.vx = b.vz = 0;
        fell.push(i);
        continue;
      }
      // tabelas
      const lx = POOL_HX - POOL_R;
      const lz = POOL_HZ - POOL_R;
      if (b.x > lx || b.x < -lx) {
        b.x = Math.max(-lx, Math.min(lx, b.x));
        if (fx && Math.abs(b.vx) > QUIET_V)
          fx.push({ kind: 'cushion', ball: i, v: Math.abs(b.vx), power: power01(b.vx, MAX_SHOT), zone: 6, at: at(b) });
        b.vx = -b.vx * CUSHION;
      }
      if (b.z > lz || b.z < -lz) {
        b.z = Math.max(-lz, Math.min(lz, b.z));
        if (fx && Math.abs(b.vz) > QUIET_V)
          fx.push({ kind: 'cushion', ball: i, v: Math.abs(b.vz), power: power01(b.vz, MAX_SHOT), zone: 6, at: at(b) });
        b.vz = -b.vz * CUSHION;
      }
    }
  }
  for (const b of balls) if (Math.hypot(b.vx, b.vz) < 0.01) b.vx = b.vz = 0;
  return fell;
}

/** a branca volta para o lugar dela (ou o mais perto livre) */
export function respotCue(balls: PoolBall[]) {
  const cue = balls[0]!;
  cue.in = false;
  cue.vx = cue.vz = 0;
  for (let k = 0; k < 40; k++) {
    const x = CUE_START.x - k * 0.06;
    const free = balls.slice(1).every((b) => b.in || Math.hypot(b.x - x, b.z) > POOL_R * 2.2);
    if (free) {
      cue.x = x;
      cue.z = 0;
      return;
    }
  }
}

export interface PoolMsg {
  balls: [number, number, number][];
  turn: 'a' | 'b';
  /** de quem é a vez (pessoa); sem isto, vale o time */
  turnId?: string;
  moving: boolean;
  t: number;
}

export interface PoolHooks {
  send(m: PoolMsg): void;
  score(side: 'a' | 'b', points: number): void;
  /** efeitos (ADR-0056): tacada, choques, tabela, caçapa, ponto */
  emit?(e: GameEvent): void;
  /** ids vivos na sinuca (incluindo eu), para trocar a autoridade se o dono sumir */
  alive?(): string[];
  /** quem está na mesa e o time de cada um (incluindo eu): vez por pessoa */
  players?(): PoolSeat[];
  /** nome de alguém ("Vez de Ana") */
  nameOf?(id: string): string;
}

const COLORS = [
  0xffffff, 0xf2c94c, 0x2f6fd6, 0xe04848, 0x6a3fb0, 0xf08a3c, 0x2f9e5a, 0x8b2a2a, 0x111111, 0xf2c94c, 0x2f6fd6,
  0xe04848, 0x6a3fb0, 0xf08a3c, 0x2f9e5a, 0x8b2a2a,
];

/** A partida de sinuca na cena. */
export class PoolPlay {
  balls = rack();
  turn: 'a' | 'b' = 'a';
  /** vez por pessoa (com `PoolHooks.players`) */
  private rota: PoolRota = { turn: null, last: {} };
  private t = 0;
  private authority: string | null = null;
  private shooting = false;
  private pocketed = 0;
  private cueFell = false;
  private lastSend = 0;
  private charge: number | null = null;
  /** quem só observa: a mesa de quem simula ainda está rolando (o observador não simula, então não sabe sozinho) */
  private remoteMoving = false;
  /** quando chegou o último estado da autoridade (relógio local) */
  private lastHeard = 0;
  private readonly fx: GameEvent[] = [];
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly cue: THREE.Mesh;
  private readonly aimLine: THREE.Line;
  private aim = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly selfId: string,
    private readonly hooks: PoolHooks,
  ) {
    for (const c of COLORS) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(POOL_R, 1), new THREE.MeshLambertMaterial({ color: c }));
      this.meshes.push(m);
      this.group.add(m);
    }
    this.cue = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.014, 1.3, 8),
      new THREE.MeshLambertMaterial({ color: 0xc8a06a }),
    );
    this.cue.geometry.rotateX(Math.PI / 2);
    this.cue.geometry.translate(0, 0, -0.7);
    this.group.add(this.cue);
    this.aimLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
    );
    this.group.add(this.aimLine);
    this.group.traverse((o) => (o.raycast = () => undefined));
    scene.add(this.group);
    this.render();
  }

  get moving() {
    return moving(this.balls) || (this.remoteMoving && this.authority !== this.selfId);
  }

  get charging() {
    return this.charge;
  }

  /** de quem é a vez (pessoa), quando a mesa sabe quem está nela */
  get turnId(): string | null {
    return this.hooks.players ? this.rota.turn : null;
  }

  /** é a minha vez? (por pessoa; sem a lista da mesa, pelo time) */
  private myTurn(team: 'a' | 'b') {
    const id = this.turnId;
    return id !== null ? id === this.selfId : team === this.turn;
  }

  canShoot(team: 'a' | 'b') {
    return this.myTurn(team) && !this.moving && !this.shooting;
  }

  /** confere a vez com quem está na mesa agora (quem saiu perde a vez; a primeira vez vai para o azul) */
  private checkTurn() {
    const seats = this.hooks.players?.();
    if (!seats) return;
    const next = poolTurn(seats, this.rota, 'check');
    if (next.turn === this.rota.turn) return;
    this.rota = next;
    const seat = seats.find((p) => p.id === next.turn);
    if (seat) this.turn = seat.team;
  }

  /** onde a câmera mira quando é a minha vez (a branca) */
  cueBall(): THREE.Vector3 {
    const c = this.balls[0]!;
    return new THREE.Vector3(c.x, POOL_Y, c.z);
  }

  prompt(team: 'a' | 'b'): string {
    if (this.moving || this.shooting) return 'Bolas rolando…';
    const id = this.turnId;
    if (id !== null && id !== this.selfId) return `Vez de ${this.hooks.nameOf?.(id) ?? 'outra pessoa'}`;
    if (id === null && team !== this.turn) return `Vez do time ${this.turn === 'a' ? 'Azul' : 'Vermelho'}`;
    return this.charge === null ? 'Mire e segure para tacar' : 'Solte para tacar';
  }

  /** selo fixo do HUD: de quem é a vez ou se as bolas ainda rolam (não é ação, não leva tecla) */
  status(team: 'a' | 'b'): string {
    if (this.moving || this.shooting) return 'Bolas rolando…';
    const id = this.turnId;
    if (id !== null) return id === this.selfId ? 'Sua vez' : `Vez de ${this.hooks.nameOf?.(id) ?? 'outra pessoa'}`;
    return team === this.turn ? 'Sua vez' : `Vez do time ${this.turn === 'a' ? 'Azul' : 'Vermelho'}`;
  }

  press(team: 'a' | 'b') {
    if (this.canShoot(team)) this.charge = 0;
  }

  /** soltou o mouse ou saiu da janela: esquece a força sem tacar */
  cancel() {
    this.charge = null;
  }

  /** solta o taco na direção `angle` (radianos, como o ry do avatar) */
  release(now: number, team: 'a' | 'b', angle: number) {
    if (this.charge === null || !this.canShoot(team)) {
      this.charge = null;
      return;
    }
    const v = 0.3 + this.charge * (MAX_SHOT - 0.3);
    const cue = this.balls[0]!;
    cue.vx = Math.sin(angle) * v;
    cue.vz = Math.cos(angle) * v;
    this.charge = null;
    this.shooting = true;
    this.pocketed = 0;
    this.cueFell = false;
    this.authority = this.selfId;
    this.remoteMoving = false;
    this.t += 1;
    this.lastSend = 0;
    this.hooks.emit?.({
      kind: 'cue',
      by: this.selfId,
      power: power01(v, MAX_SHOT),
      zone: 6,
      at: { x: cue.x, y: POOL_Y + POOL_R, z: cue.z },
    });
    this.send(now);
  }

  /** arrumar a mesa de novo (qualquer um) */
  rerack(now: number) {
    this.balls = rack();
    this.turn = 'a';
    this.rota = { turn: null, last: {} };
    this.checkTurn();
    this.shooting = false;
    this.remoteMoving = false;
    this.authority = this.selfId;
    this.t += 1;
    this.lastSend = 0;
    this.send(now, true);
  }

  remote(m: PoolMsg & { by: string }, now = performance.now()) {
    if (m.by === this.selfId) return;
    if (m.t < this.t || (m.t === this.t && this.authority && m.by !== this.authority && m.by < this.authority)) return;
    // tacada nova de outra pessoa (a mesa estava parada e começou a rolar)
    if (m.moving && !this.remoteMoving && m.t > this.t) {
      const c = m.balls[0];
      if (c)
        this.hooks.emit?.({ kind: 'cue', by: m.by, power: 0.6, zone: 6, at: { x: c[0], y: POOL_Y + POOL_R, z: c[1] } });
    }
    this.authority = m.by;
    this.t = m.t;
    this.lastHeard = now;
    this.remoteMoving = m.moving;
    // a mesa parada manda o estado de tempos em tempos: isso não pode zerar a força de quem está mirando
    if (m.turn !== this.turn || (m.turnId ?? null) !== this.rota.turn || m.moving) this.charge = null;
    this.turn = m.turn;
    if (m.turnId) {
      // quem jogou por último no time dele (para o rodízio continuar igual se eu assumir a mesa)
      const prev = this.rota.turn;
      const seat = prev ? this.hooks.players?.().find((p) => p.id === prev) : undefined;
      const last = seat && prev !== m.turnId ? { ...this.rota.last, [seat.team]: prev } : this.rota.last;
      this.rota = { turn: m.turnId, last };
    }
    this.shooting = false;
    m.balls.forEach(([x, z, inn], i) => {
      const b = this.balls[i];
      if (!b) return;
      // quem só observa não simula: a caçapa aparece quando a bola passa de "na mesa" para "caiu"
      if (inn === 1 && !b.in)
        this.hooks.emit?.({ kind: 'pocket', ball: i, power: 0.5, zone: 6, at: { x, y: POOL_Y, z } });
      b.in = inn === 1;
      // segue a posição de quem simula (suave se perto, direto se longe)
      const far = Math.hypot(x - b.x, z - b.z) > 0.15;
      b.x = far ? x : b.x + (x - b.x) * 0.6;
      b.z = far ? z : b.z + (z - b.z) * 0.6;
      if (!m.moving) b.vx = b.vz = 0;
    });
  }

  update(dt: number, now: number, aim: number) {
    this.aim = aim;
    if (this.charge !== null) this.charge = Math.min(1, this.charge + dt / 1.2);
    this.checkAuthority(now);
    const mine = this.authority === this.selfId;
    // a vez é conferida por quem manda na mesa (ou por todos, antes da primeira tacada)
    if ((mine || !this.authority) && !this.shooting && !this.moving) this.checkTurn();
    if (mine || !this.authority) {
      this.fx.length = 0;
      const fell = stepPool(this.balls, dt, this.hooks.emit ? this.fx : undefined);
      for (const e of this.fx) this.hooks.emit?.(e);
      for (const i of fell) {
        if (i === 0) this.cueFell = true;
        else this.pocketed++;
      }
      if (this.shooting && !moving(this.balls)) this.endShot(now);
    }
    if (mine) this.send(now);
    this.render();
  }

  /** o dono da mesa sumiu ou ficou calado: o menor id vivo assume e termina a tacada a partir do último estado */
  private checkAuthority(now: number) {
    const a = this.authority;
    if (!a || a === this.selfId || !this.hooks.alive) return;
    const next = nextAuthority(this.hooks.alive(), a, this.lastHeard, now);
    if (next === a) return;
    this.authority = next;
    this.lastHeard = now;
    if (next !== this.selfId) return;
    // eu assumo: se a mesa ainda rolava, a tacada termina comigo (a vez passa se nada caiu daqui para a frente)
    this.shooting = this.shooting || this.remoteMoving;
    this.remoteMoving = false;
    this.pocketed = 0;
    this.cueFell = false;
    this.t += 1;
    this.lastSend = 0;
  }

  private endShot(now: number) {
    this.shooting = false;
    if (this.pocketed > 0) {
      const points = Math.min(3, this.pocketed);
      this.hooks.score(this.turn, points);
      const c = this.balls[0]!;
      this.hooks.emit?.({
        kind: 'score',
        side: this.turn,
        points,
        by: this.selfId,
        reason: 'caçapa',
        power: points / 3,
        zone: 6,
        at: { x: c.x, y: POOL_Y + POOL_R, z: c.z },
      });
    }
    if (this.cueFell) respotCue(this.balls);
    const pass = this.cueFell || this.pocketed === 0;
    const seats = this.hooks.players?.();
    if (seats) {
      this.rota = poolTurn(
        seats,
        this.rota.turn ? this.rota : poolTurn(seats, this.rota, 'check'),
        pass ? 'pass' : 'keep',
      );
      const seat = seats.find((p) => p.id === this.rota.turn);
      if (seat) this.turn = seat.team;
    } else if (pass) this.turn = this.turn === 'a' ? 'b' : 'a';
    // mesa limpa: arruma de novo
    if (this.balls.slice(1).every((b) => b.in)) this.balls = rack();
    this.lastSend = 0;
    this.send(now, true);
  }

  private send(now: number, force = false) {
    const mv = this.shooting || this.moving;
    // parada, a mesa ainda manda 1x/s: é o sinal de vida da autoridade (AUTHORITY_SILENCE_MS)
    if (!force && now - this.lastSend < (mv ? 100 : 1000)) return;
    this.lastSend = now;
    const r = (n: number) => Math.round(n * 10000) / 10000;
    this.hooks.send({
      balls: this.balls.map((b) => [r(b.x), r(b.z), b.in ? 1 : 0]),
      turn: this.turn,
      ...(this.turnId ? { turnId: this.turnId } : {}),
      moving: mv,
      t: this.t,
    });
  }

  private render() {
    this.balls.forEach((b, i) => {
      const m = this.meshes[i]!;
      m.visible = !b.in;
      m.position.set(b.x, POOL_Y + POOL_R, b.z);
    });
    const c = this.balls[0]!;
    const show = !this.moving && !this.shooting && !c.in;
    this.cue.visible = show;
    this.aimLine.visible = show;
    if (show) {
      const pull = (this.charge ?? 0) * 0.25;
      this.cue.position.set(c.x - Math.sin(this.aim) * pull, POOL_Y + POOL_R + 0.02, c.z - Math.cos(this.aim) * pull);
      this.cue.rotation.set(0, this.aim, 0);
      this.cue.rotateX(0.08);
      this.aimLine.position.set(c.x, POOL_Y + POOL_R, c.z);
      this.aimLine.rotation.set(0, this.aim, 0);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
