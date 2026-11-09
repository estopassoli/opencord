/**
 * Bots do gunfight (treino, só no app de quem chamou): andam pelo mapa por uma grade de caminhos, enxergam com linha
 * de visão e campo de visão, reagem depois de um tempo (pelo nível), giram a mira aos poucos com erro, atiram em
 * rajadas, andam de lado no combate, recarregam e renascem. Brigam também entre si (todos contra todos).
 */
import type { GunId } from '@opencord/contracts';
import { BOT_LEVEL_LABEL, BOT_SKILL, type BotLevel } from '../bots/level';
import { resolve } from '../physics';
import type { BotPose, GunHost } from './game';
import { GUN_BOXES, GUN_HALF, blockedAt, pickSpawn } from './map';
import {
  EYE,
  GUNS,
  MAX_HP,
  RESPAWN_MS,
  SLOT_GUNS,
  aimDir,
  headY,
  lineOfSight,
  shotInterval,
  type Target,
  type V3,
} from './weapons';

export interface BotShot {
  by: string;
  w: GunId;
  from: V3;
  muzzle: V3;
  dir: V3;
}

interface Ctx {
  host: GunHost;
  me(): Target | null;
  shoot(s: BotShot): void;
  killed(by: string, target: string, w: GunId, head: boolean): void;
}

interface Bot {
  id: string;
  name: string;
  av: ReturnType<GunHost['spawnAvatar']>;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  w: GunId;
  mag: number;
  nextShot: number;
  reloadUntil: number;
  burstLeft: number;
  pauseUntil: number;
  path: { x: number; z: number }[];
  target: string | null;
  reactAt: number;
  lastSeen: { x: number; z: number; at: number } | null;
  errYaw: number;
  errPitch: number;
  strafe: number;
  strafeUntil: number;
  crouch: boolean;
  thinkAt: number;
  moving: number;
}

// ---------------------------------------------------------------- caminhos

const CELL = 1;
const N = Math.floor((GUN_HALF * 2) / CELL);
const cellOf = (v: number) => Math.max(0, Math.min(N - 1, Math.floor((v + GUN_HALF) / CELL)));
const centerOf = (i: number) => -GUN_HALF + (i + 0.5) * CELL;
let grid: Uint8Array | null = null;
function walk(): Uint8Array {
  if (grid) return grid;
  grid = new Uint8Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) grid[i * N + j] = blockedAt(centerOf(i), centerOf(j), 0.55) ? 0 : 1;
  return grid;
}

/** caminho (pontos no mundo) de `a` até `b` pela grade, em largura; vazio se não houver */
export function findPath(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number }[] {
  const g = walk();
  const s = cellOf(a.x) * N + cellOf(a.z);
  const t = cellOf(b.x) * N + cellOf(b.z);
  if (!g[t]) return [];
  const prev = new Int32Array(N * N).fill(-1);
  prev[s] = s;
  const q = [s];
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]!;
    if (c === t) break;
    const ci = Math.floor(c / N);
    const cj = c % N;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = ni * N + nj;
      if (!g[n] || prev[n] !== -1) continue;
      // diagonal só se as duas laterais estão livres (não corta quina)
      if (di && dj && (!g[ci * N + nj] || !g[ni * N + cj])) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[t] === -1) return [];
  const out: { x: number; z: number }[] = [];
  for (let c = t; c !== s; c = prev[c]!) out.push({ x: centerOf(Math.floor(c / N)), z: centerOf(c % N) });
  return out.reverse();
}

/** ângulos (yaw, pitch) da câmera para olhar de `a` para `b` (mesma convenção do jogador) */
export function lookAt(a: V3, b: V3): { yaw: number; pitch: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const h = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: -Math.atan2(dy, h) };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class GunBots {
  private readonly list: Bot[] = [];
  private seed = 7;
  private readonly skill;

  constructor(
    readonly level: BotLevel,
    count: number,
    private readonly ctx: Ctx,
  ) {
    this.skill = BOT_SKILL[level];
    const guns = SLOT_GUNS.primary.filter((g) => level !== 'facil' || GUNS[g].cls !== 'sniper');
    for (let i = 0; i < count; i++) {
      const id = `bot:${i + 1}`;
      const name = `Bot ${i + 1} · ${BOT_LEVEL_LABEL[level]}`;
      const w = guns[Math.floor(this.rand() * guns.length)]!;
      const b: Bot = {
        id,
        name,
        av: ctx.host.spawnAvatar(id, name),
        x: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        hp: MAX_HP,
        alive: false,
        respawnAt: 0,
        w,
        mag: GUNS[w].mag,
        nextShot: 0,
        reloadUntil: 0,
        burstLeft: 0,
        pauseUntil: 0,
        path: [],
        target: null,
        reactAt: 0,
        lastSeen: null,
        errYaw: 0,
        errPitch: 0,
        strafe: 1,
        strafeUntil: 0,
        crouch: false,
        thinkAt: 0,
        moving: 0,
      };
      this.list.push(b);
    }
    this.resetAll(performance.now());
  }

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  ids() {
    return this.list.map((b) => b.id);
  }

  has(id: string) {
    return this.list.some((b) => b.id === id);
  }

  nameOf(id: string): string | undefined {
    return this.list.find((b) => b.id === id)?.name;
  }

  targets(): Target[] {
    return this.list.filter((b) => b.alive).map((b) => ({ id: b.id, x: b.x, y: 0, z: b.z, crouch: b.crouch }));
  }

  alivePositions() {
    return this.list.filter((b) => b.alive).map((b) => ({ x: b.x, z: b.z }));
  }

  resetAll(now: number) {
    for (const b of this.list) this.spawn(b, now);
  }

  private spawn(b: Bot, now: number) {
    const others = [
      ...this.list.filter((o) => o !== b && o.alive).map((o) => ({ x: o.x, z: o.z })),
      ...(this.ctx.me() ? [this.ctx.me()!] : []),
    ];
    const s = pickSpawn(others, this.rand());
    b.x = s.x + (this.rand() - 0.5);
    b.z = s.z + (this.rand() - 0.5);
    b.yaw = s.ry + Math.PI;
    b.pitch = 0;
    b.hp = MAX_HP;
    b.alive = true;
    b.mag = GUNS[b.w].mag;
    b.target = null;
    b.path = [];
    b.reloadUntil = 0;
    b.nextShot = now + 400;
  }

  /** levou dano; devolve se morreu */
  hurt(id: string, dmg: number, by: string, w: GunId, head: boolean): boolean {
    const b = this.list.find((x) => x.id === id);
    if (!b || !b.alive) return false;
    b.hp -= dmg;
    // quem atirou vira o alvo (vira para ele)
    if (by !== b.id) {
      b.target = by;
      b.reactAt = Math.min(b.reactAt, performance.now() + this.skill.reaction * 500);
    }
    if (b.hp > 0) return false;
    b.alive = false;
    b.respawnAt = performance.now() + RESPAWN_MS;
    this.ctx.killed(by, b.id, w, head);
    return true;
  }

  private posOf(id: string): Target | null {
    const me = this.ctx.me();
    if (me && me.id === id) return me;
    const b = this.list.find((x) => x.id === id && x.alive);
    return b ? { id: b.id, x: b.x, y: 0, z: b.z, crouch: b.crouch } : null;
  }

  /** quem este bot enxerga agora (o mais perto) */
  private look(b: Bot): Target | null {
    const eye = { x: b.x, y: b.crouch ? EYE.crouch : EYE.stand, z: b.z };
    const cands: Target[] = [];
    const me = this.ctx.me();
    if (me) cands.push(me);
    for (const o of this.list) if (o !== b && o.alive) cands.push({ id: o.id, x: o.x, y: 0, z: o.z, crouch: o.crouch });
    let best: Target | null = null;
    let bestD = 48;
    for (const t of cands) {
      const d = Math.hypot(t.x - b.x, t.z - b.z);
      if (d > bestD) continue;
      const ang = Math.abs(wrap(lookAt(eye, { x: t.x, y: 1, z: t.z }).yaw - b.yaw));
      // atrás dele só percebe bem de perto (passos)
      if (ang > 1.1 && d > 5 && t.id !== b.target) continue;
      if (!lineOfSight(eye, { x: t.x, y: t.y + headY(t.crouch), z: t.z }, GUN_BOXES)) continue;
      best = t;
      bestD = d;
    }
    return best;
  }

  update(dt: number, now: number) {
    for (const b of this.list) {
      if (!b.alive) {
        if (now >= b.respawnAt) this.spawn(b, now);
        this.place(b);
        continue;
      }
      if (now >= b.thinkAt) this.think(b, now);
      this.act(b, dt, now);
      this.place(b);
    }
  }

  private think(b: Bot, now: number) {
    b.thinkAt = now + 120 + this.rand() * 80;
    const seen = this.look(b);
    if (seen) {
      if (b.target !== seen.id || !b.lastSeen || now - b.lastSeen.at > 1500) {
        // viu agora: reage depois do tempo de reação (com um sorteio em volta)
        b.reactAt = now + this.skill.reaction * 1000 * (0.7 + this.rand() * 0.6);
        b.errYaw = (this.rand() - 0.5) * this.skill.error * 0.5;
        b.errPitch = (this.rand() - 0.5) * this.skill.error * 0.3;
      }
      b.target = seen.id;
      b.lastSeen = { x: seen.x, z: seen.z, at: now };
      b.path = [];
      return;
    }
    // perdeu de vista: vai até onde viu por último; senão passeia
    if (b.lastSeen && now - b.lastSeen.at < 6000 && b.path.length === 0) {
      b.path = findPath(b, b.lastSeen);
      b.lastSeen = null;
      b.target = null;
    } else if (b.path.length === 0) {
      b.target = null;
      for (let i = 0; i < 6 && b.path.length === 0; i++) {
        const goal = { x: (this.rand() * 2 - 1) * (GUN_HALF - 2), z: (this.rand() * 2 - 1) * (GUN_HALF - 2) };
        b.path = findPath(b, goal);
      }
    }
  }

  private act(b: Bot, dt: number, now: number) {
    const sk = this.skill;
    const spec = GUNS[b.w];
    let mx = 0;
    let mz = 0;
    let speed = 3.2 * sk.speed * spec.move;
    const t = b.target ? this.posOf(b.target) : null;
    const eye = { x: b.x, y: b.crouch ? EYE.crouch : EYE.stand, z: b.z };
    if (t && b.lastSeen && now - b.lastSeen.at < 400) {
      // combate: mira no peito (no difícil, às vezes na cabeça), com o erro diminuindo enquanto mira
      const aimY = t.y + (sk.smart > 0.8 && this.rand() < 0.02 ? headY(t.crouch) : headY(t.crouch) - 0.35);
      const want = lookAt(eye, { x: t.x, y: aimY, z: t.z });
      b.errYaw *= Math.exp(-dt * (1.5 + (1 - sk.error) * 3));
      b.errPitch *= Math.exp(-dt * (1.5 + (1 - sk.error) * 3));
      const turn = (2.5 + (1 - sk.error) * 8) * dt;
      const dy = wrap(want.yaw + b.errYaw - b.yaw);
      const dp = want.pitch + b.errPitch - b.pitch;
      b.yaw += Math.max(-turn, Math.min(turn, dy));
      b.pitch += Math.max(-turn, Math.min(turn, dp));
      // anda de lado (médio e difícil); o fácil fica parado
      if (now > b.strafeUntil) {
        b.strafe = this.rand() < 0.5 ? -1 : 1;
        b.strafeUntil = now + 500 + this.rand() * 900;
        b.crouch = sk.smart > 0.8 && this.rand() < 0.25;
      }
      if (sk.smart > 0.5) {
        mx = Math.cos(b.yaw) * b.strafe;
        mz = -Math.sin(b.yaw) * b.strafe;
        speed *= 0.6;
      }
      if (now >= b.reactAt && Math.abs(dy) < 0.06 + sk.error * 0.15) this.trigger(b, now);
    } else {
      b.crouch = false;
      const next = b.path[0];
      if (next) {
        const dx = next.x - b.x;
        const dz = next.z - b.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) b.path.shift();
        else {
          mx = dx / d;
          mz = dz / d;
          const wantYaw = Math.atan2(-mx, -mz);
          b.yaw += wrap(wantYaw - b.yaw) * Math.min(1, dt * 6);
          b.pitch *= Math.exp(-dt * 4);
          if (b.path.length > 6) speed = 5.2 * sk.speed;
        }
      }
    }
    if (b.reloadUntil && now >= b.reloadUntil) {
      b.reloadUntil = 0;
      b.mag = spec.mag;
    }
    if (b.crouch) speed = 1.8;
    const p = resolve(this.ctx.host.obstacles, b.x + mx * speed * dt, b.z + mz * speed * dt);
    b.moving = Math.hypot(p.x - b.x, p.z - b.z) / Math.max(dt, 1e-3);
    b.x = p.x;
    b.z = p.z;
  }

  private trigger(b: Bot, now: number) {
    const spec = GUNS[b.w];
    if (b.reloadUntil || now < b.nextShot || now < b.pauseUntil) return;
    if (b.mag <= 0) {
      b.reloadUntil = now + spec.emptyReloadMs;
      return;
    }
    // rajadas: atira um tanto e para um pouco (o fácil para mais)
    if (b.burstLeft <= 0) {
      b.burstLeft = spec.auto ? 3 + Math.floor(this.rand() * 6) : 1;
    }
    b.mag--;
    b.burstLeft--;
    b.nextShot = now + shotInterval(spec) * (spec.auto ? 1 : 1.3 + this.skill.error);
    if (b.burstLeft <= 0) b.pauseUntil = now + (200 + this.rand() * 500) * (1 + this.skill.error * 2);
    const eye = { x: b.x, y: b.crouch ? EYE.crouch : EYE.stand, z: b.z };
    const spread = (this.skill.smart > 0.8 ? spec.spread.ads + 0.006 : spec.spread.hip * 0.6) + this.skill.error * 0.03;
    const dir = aimDir(b.yaw, b.pitch, spread, this.rand(), this.rand());
    const fx = -Math.sin(b.yaw);
    const fz = -Math.cos(b.yaw);
    this.ctx.shoot({
      by: b.id,
      w: b.w,
      from: eye,
      muzzle: { x: b.x + fx * 0.55 - fz * 0.1, y: eye.y - 0.2, z: b.z + fz * 0.55 + fx * 0.1 },
      dir,
    });
  }

  private place(b: Bot) {
    const pose: BotPose = {
      x: b.x,
      y: 0,
      z: b.z,
      ry: Math.atan2(-Math.sin(b.yaw), -Math.cos(b.yaw)),
      a: !b.alive ? 9 : b.moving > 3.5 ? 2 : b.moving > 0.3 ? 1 : 0,
      gun: { w: b.w, pitch: b.pitch, crouch: b.crouch, ads: !!b.target, alive: b.alive },
    };
    b.av.place(pose);
  }

  dispose() {
    for (const b of this.list) b.av.dispose();
    this.list.length = 0;
  }
}
