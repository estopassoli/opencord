/**
 * Gunfight (zona 8, todos contra todos): o controlador. Cuida do meu jogador (movimento tático, armas, tiro, vida,
 * morrer e renascer), dos traçantes e dos efeitos, da visão em primeira pessoa, dos bots (treino) e da conversa pela
 * rede (`space:gun`). A cena (`scene.ts`) entrega as teclas, a câmera e os bonecos; a interface lê `useGunHud`.
 *
 * Rede: quem atira confere o acerto no próprio app e avisa quem levou (`hit`); quem levou desconta e, se morreu,
 * avisa todos (`die`), que somam no placar. É simples e confia nos apps (jogo entre amigos).
 */
import type { GunId, SpaceGun } from '@opencord/contracts';
import * as THREE from 'three';
import type { GameEvent } from '../events';
import { resolve, type Obstacles } from '../physics';
import type { BotLevel } from '../bots/level';
import { GunBots, type BotShot } from './bots';
import { GUN_BOXES, pickSpawn } from './map';
import { loadGuns, makeGun, type GunModel } from './models';
import { MOVE, newMove, pressCrouch, pressJump, pressRun, sliding, stepMove, type MoveState } from './movement';
import { useGunHud, type KillFeedItem } from './state';
import { Viewmodel } from './viewmodel';
import {
  EYE,
  FFA_TARGET,
  GUNS,
  MAX_HP,
  REGEN_DELAY_MS,
  REGEN_PER_S,
  RESPAWN_MS,
  aimDir,
  castShot,
  damageAt,
  shotInterval,
  spreadNow,
  type GunSlot,
  type Loadout,
  type Target,
  type V3,
} from './weapons';

export type GunAction = 'fire' | 'ads' | 'reload' | 'melee' | 'inspect' | 'crouch' | 'jump' | 'run' | 'view';

export interface GunPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  crouch: boolean;
  alive: boolean;
}

export interface GunHost {
  selfId: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  obstacles: Obstacles;
  skin: number;
  /** câmera da cena: para onde olho */
  yaw(): number;
  pitch(): number;
  /** gira a câmera (recuo): yaw e pitch somados */
  turn(dYaw: number, dPitch: number): void;
  /** direção de andar pedida (frente/trás/lados), em relação à câmera */
  wish(): { f: number; r: number };
  held(a: 'fire' | 'ads' | 'run'): boolean;
  /** as outras pessoas na arena (vivas ou não) */
  players(): GunPlayer[];
  nameOf(id: string): string;
  send(g: Omit<SpaceGun, 'channelId'>): void;
  emit(e: GameEvent): void;
  /** posição do meu boneco mudou (a cena põe o avatar e manda a pose) */
  place(p: { x: number; y: number; z: number; ry: number }): void;
  /** um boneco para os bots (a cena cria e desenha) */
  spawnAvatar(id: string, name: string): { root: THREE.Object3D; place(p: BotPose): void; dispose(): void };
}

export interface BotPose {
  x: number;
  y: number;
  z: number;
  ry: number;
  a: number;
  gun: { w: GunId; pitch: number; crouch: boolean; ads: boolean; alive: boolean };
}

interface Ammo {
  mag: number;
  reserve: number;
}

interface Tracer {
  line: THREE.Line;
  until: number;
}

const SLOTS: GunSlot[] = ['primary', 'secondary', 'melee'];
const UP = new THREE.Vector3(0, 1, 0);

export class GunGame {
  readonly vm: Viewmodel;
  firstPerson = true;
  private move: MoveState = newMove();
  private x = 0;
  private z = 0;
  private ry = 0;
  private hp = MAX_HP;
  private alive = false;
  private respawnAt = 0;
  private lastHurt = 0;
  private loadout: Loadout;
  private slot: GunSlot = 'primary';
  private ammo = new Map<GunId, Ammo>();
  private nextShot = 0;
  private reloadUntil = 0;
  private reloadEmpty = false;
  private drawUntil = 0;
  private meleeUntil = 0;
  private boltPending = 0;
  private ads = 0;
  private triggerDown = false;
  private semiReady = true;
  private lastFire = 0;
  private shotsInBurst = 0;
  private eyeY: number = EYE.stand;
  private model: GunModel | null = null;
  private readonly tracers: Tracer[] = [];
  private readonly tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9 });
  private readonly kills = new Map<string, { kills: number; deaths: number }>();
  private feedSeq = 0;
  private feed: KillFeedItem[] = [];
  private bots: GunBots | null = null;
  private winner: string | null = null;
  private lastHud = 0;
  private seed = 1;
  private lookPrev = { yaw: 0, pitch: 0 };
  private disposed = false;

  constructor(private readonly host: GunHost) {
    this.vm = new Viewmodel(host.skin);
    this.loadout = { ...useGunHud.getState().loadout };
    for (const id of Object.keys(GUNS) as GunId[]) this.ammo.set(id, { mag: GUNS[id].mag, reserve: GUNS[id].reserve });
    useGunHud.getState().set({ active: true, firstPerson: this.firstPerson, feed: [], winner: null, dead: false });
    void loadGuns().then(() => {
      if (this.disposed) return;
      this.respawn(performance.now());
    });
  }

  // ------------------------------------------------------------ estado

  private rand() {
    // sorteio próprio (rápido e repetível no teste)
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  get weapon(): GunId {
    return this.loadout[this.slot];
  }

  get spec() {
    return GUNS[this.weapon];
  }

  get isAlive() {
    return this.alive;
  }

  get crouching() {
    return this.move.crouch || sliding(this.move, performance.now());
  }

  get aiming() {
    return this.ads;
  }

  get eye(): V3 {
    return { x: this.x, y: this.move.y + this.eyeY, z: this.z };
  }

  /** a pose da arma para a rede e o meu boneco */
  pose(): { w: GunId; pitch: number; crouch: boolean; ads: boolean; alive: boolean } {
    return { w: this.weapon, pitch: this.host.pitch(), crouch: this.crouching, ads: this.ads > 0.5, alive: this.alive };
  }

  /** o estado `a` do boneco (0 parado, 1 andando, 2 correndo, 3 no ar, 9 morto, 15 deslizando) */
  anim(): number {
    if (!this.alive) return 9;
    if (sliding(this.move, performance.now())) return 15;
    if (!this.move.grounded) return 3;
    const sp = Math.hypot(this.move.vx, this.move.vz);
    if (sp < 0.3) return 0;
    return this.move.sprint ? 2 : 1;
  }

  setLoadout(l: Loadout) {
    this.loadout = { ...l };
    // muda na próxima vez que nascer (vale já se estiver morto)
  }

  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    useGunHud.getState().set({ firstPerson: on });
  }

  // ------------------------------------------------------------ nascer, morrer

  private respawn(now: number) {
    this.loadout = { ...useGunHud.getState().loadout };
    const enemies = [...this.host.players().filter((p) => p.alive), ...(this.bots?.alivePositions() ?? [])];
    const sp = pickSpawn(enemies, this.rand());
    this.x = sp.x;
    this.z = sp.z;
    this.ry = sp.ry;
    this.host.turn(sp.ry + Math.PI - this.host.yaw(), -this.host.pitch());
    this.move = newMove();
    this.hp = MAX_HP;
    this.alive = true;
    this.slot = 'primary';
    for (const id of Object.values(this.loadout) as GunId[])
      this.ammo.set(id, { mag: GUNS[id].mag, reserve: GUNS[id].reserve });
    this.equip(now);
    this.host.send({ kind: 'spawn', w: this.weapon });
    useGunHud.getState().set({ dead: false, killedBy: null, hp: this.hp });
  }

  private die(by: string, w: GunId, head: boolean, now: number) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.respawnAt = now + RESPAWN_MS;
    this.reloadUntil = 0;
    this.ads = 0;
    this.host.send({ kind: 'die', w, by, head });
    this.onKill(by, this.host.selfId, w, head);
    useGunHud.getState().set({ dead: true, killedBy: by, respawnAt: Date.now() + RESPAWN_MS });
  }

  /** alguém matou alguém: lista de abates, placar e fim da partida */
  private onKill(by: string, target: string, w: GunId, head: boolean) {
    const k = this.kills.get(by) ?? { kills: 0, deaths: 0 };
    if (by !== target) k.kills++;
    this.kills.set(by, k);
    const d = this.kills.get(target) ?? { kills: 0, deaths: 0 };
    d.deaths++;
    this.kills.set(target, d);
    this.feed = [
      {
        id: ++this.feedSeq,
        by,
        byName: this.nameOf(by),
        target,
        targetName: this.nameOf(target),
        w,
        head,
        at: Date.now(),
      },
      ...this.feed,
    ].slice(0, 6);
    if (!this.winner && k.kills >= FFA_TARGET) this.winner = by;
    this.pushScores();
  }

  private nameOf(id: string) {
    if (id === this.host.selfId) return 'Você';
    return this.bots?.nameOf(id) ?? this.host.nameOf(id);
  }

  private pushScores() {
    const ids = new Set<string>([this.host.selfId, ...this.host.players().map((p) => p.id), ...this.kills.keys()]);
    for (const b of this.bots?.ids() ?? []) ids.add(b);
    const rows = [...ids].map((id) => ({
      id,
      name: this.nameOf(id),
      kills: this.kills.get(id)?.kills ?? 0,
      deaths: this.kills.get(id)?.deaths ?? 0,
      bot: !!this.bots?.has(id),
    }));
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    useGunHud.getState().set({
      scores: rows,
      feed: this.feed,
      winner: this.winner ? this.nameOf(this.winner) : null,
    });
  }

  /** começa de novo (placar zerado, todos renascem) */
  restart(now = performance.now()) {
    this.kills.clear();
    this.feed = [];
    this.winner = null;
    this.bots?.resetAll(now);
    this.respawn(now);
    this.pushScores();
  }

  // ------------------------------------------------------------ armas

  private equip(now: number) {
    const id = this.weapon;
    const m = makeGun(id);
    if (!m) return;
    this.model = m;
    this.vm.setGun(m, GUNS[id]);
    this.drawUntil = now + (GUNS[id].cls === 'knife' ? 380 : GUNS[id].cls === 'pistol' ? 420 : 600);
    this.reloadUntil = 0;
    this.boltPending = 0;
    this.host.emit({ kind: 'gunfx', what: 'draw', w: id, power: 0.5, zone: 8, at: this.eye });
  }

  switchTo(slot: GunSlot, now = performance.now()) {
    if (!this.alive || slot === this.slot) return;
    this.slot = slot;
    this.equip(now);
  }

  cycle(dir: number, now = performance.now()) {
    const i = SLOTS.indexOf(this.slot);
    this.switchTo(SLOTS[(i + (dir > 0 ? 1 : 2)) % 3]!, now);
  }

  press(a: GunAction, now = performance.now()) {
    if (a === 'view') return this.setFirstPerson(!this.firstPerson);
    if (!this.alive) return;
    switch (a) {
      case 'fire':
        this.triggerDown = true;
        if (this.spec.cls === 'knife') this.knife(now, false);
        break;
      case 'ads':
        if (this.spec.cls === 'knife') this.knife(now, true);
        break;
      case 'reload':
        this.reload(now);
        break;
      case 'melee':
        this.bash(now);
        break;
      case 'inspect':
        if (!this.vm.busy && now > this.reloadUntil) this.vm.play('inspect', this.spec.cls === 'knife' ? 2000 : 2400);
        break;
      case 'crouch': {
        const r = pressCrouch(this.move, now);
        if (r === 'slide')
          this.host.emit({ kind: 'gunfx', what: 'slide', w: this.weapon, power: 0.6, zone: 8, at: this.eye });
        break;
      }
      case 'jump':
        pressJump(this.move, now);
        break;
      case 'run':
        pressRun(this.move, now);
        break;
    }
  }

  release(a: GunAction) {
    if (a === 'fire') {
      this.triggerDown = false;
      this.semiReady = true;
      this.shotsInBurst = 0;
    }
  }

  private reload(now: number) {
    const sp = this.spec;
    const am = this.ammo.get(this.weapon);
    if (!am || sp.cls === 'knife' || now < this.reloadUntil || am.mag >= sp.mag || am.reserve <= 0) return;
    this.reloadEmpty = am.mag === 0;
    const ms = this.reloadEmpty ? sp.emptyReloadMs : sp.reloadMs;
    this.reloadUntil = now + ms;
    this.move.sprint = false;
    this.vm.play(this.reloadEmpty ? 'reloadEmpty' : 'reload', ms);
    const at = this.eye;
    const fx = (what: 'magOut' | 'magIn' | 'charge', k: number) =>
      window.setTimeout(() => {
        if (this.reloadUntil && performance.now() < this.reloadUntil + 50)
          this.host.emit({ kind: 'gunfx', what, w: this.weapon, power: 0.6, zone: 8, at });
      }, ms * k);
    fx('magOut', 0.18);
    fx('magIn', 0.6);
    if (this.reloadEmpty) fx('charge', 0.8);
  }

  private finishReload() {
    const am = this.ammo.get(this.weapon);
    if (!am) return;
    const need = this.spec.mag - am.mag;
    const take = Math.min(need, am.reserve);
    am.mag += take;
    am.reserve -= take;
  }

  private targets(): Target[] {
    const out: Target[] = this.host
      .players()
      .filter((p) => p.alive)
      .map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z, crouch: p.crouch }));
    if (this.bots) out.push(...this.bots.targets());
    return out;
  }

  /** faca (golpe rápido; `heavy` = botão direito: mais lento, mais longe) ou a coronhada com a arma */
  private knife(now: number, heavy: boolean) {
    const sp = this.spec;
    if (!sp.melee || now < this.meleeUntil || now < this.drawUntil) return;
    const ms = sp.melee.ms * (heavy ? 1.5 : 1);
    this.meleeUntil = now + ms;
    this.vm.play('melee', ms);
    this.host.emit({ kind: 'gunfx', what: 'swing', w: this.weapon, power: 0.6, zone: 8, at: this.eye });
    window.setTimeout(() => this.meleeHit(sp.melee!.dmg, sp.melee!.range * (heavy ? 1.3 : 1)), ms * 0.3);
  }

  private bash(now: number) {
    if (this.spec.cls === 'knife') return this.knife(now, false);
    if (now < this.meleeUntil || now < this.drawUntil) return;
    this.meleeUntil = now + 500;
    this.reloadUntil = 0;
    this.vm.play('melee', 500);
    this.host.emit({ kind: 'gunfx', what: 'swing', w: this.weapon, power: 0.5, zone: 8, at: this.eye });
    window.setTimeout(() => this.meleeHit(55, 1.7), 160);
  }

  private meleeHit(dmg: number, range: number) {
    if (!this.alive) return;
    const yaw = this.host.yaw();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: Target | null = null;
    let bestD = range;
    for (const t of this.targets()) {
      const dx = t.x - this.x;
      const dz = t.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || d < 1e-3) continue;
      if ((dx * fx + dz * fz) / d < 0.55) continue;
      best = t;
      bestD = d;
    }
    if (!best) return;
    this.dealDamage(best.id, dmg, false, { x: best.x, y: best.y + 1, z: best.z });
  }

  /** dispara a arma (cadência, munição, recuo, dispersão, acerto) */
  private fire(now: number) {
    const sp = this.spec;
    const am = this.ammo.get(this.weapon);
    if (!am || sp.cls === 'knife') return;
    if (now < this.nextShot || now < this.drawUntil || now < this.meleeUntil || this.boltPending > now) return;
    if (this.reloadUntil) {
      // atirar cancela a recarga só se ainda tiver bala no pente
      if (am.mag <= 0) return;
      this.reloadUntil = 0;
    }
    if (am.mag <= 0) {
      if (this.semiReady)
        this.host.emit({ kind: 'gunfx', what: 'dry', w: this.weapon, power: 0.5, zone: 8, at: this.eye });
      this.semiReady = false;
      this.reload(now);
      return;
    }
    am.mag--;
    this.nextShot = now + shotInterval(sp);
    this.lastFire = now;
    this.shotsInBurst++;
    this.move.sprint = false;
    this.move.tactical = false;
    this.vm.play('fire', 120);
    const moving = Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk);
    let spread = spreadNow(sp, this.ads, moving, this.move.crouch);
    if (!this.move.grounded) spread *= 2;
    if (sliding(this.move, now)) spread *= 1.4;
    // a primeira bala de uma rajada vai mais certa
    if (this.shotsInBurst === 1) spread *= 0.6;
    const o = this.eye;
    const d = aimDir(this.host.yaw(), this.host.pitch(), spread, this.rand(), this.rand());
    const hit = castShot(o, d, this.targets(), GUN_BOXES, 160);
    const to = { x: o.x + d.x * hit.dist, y: o.y + d.y * hit.dist, z: o.z + d.z * hit.dist };
    const muzzle = this.muzzleWorld(o);
    this.tracer(muzzle, to, now);
    this.host.emit({ kind: 'gunshot', by: this.host.selfId, w: this.weapon, power: 1, zone: 8, at: o });
    this.host.send({ kind: 'fire', w: this.weapon, from: v3(muzzle), to: v3(to) });
    if (hit.target) this.dealDamage(hit.target, damageAt(sp, hit.dist, hit.head), hit.head, to);
    else this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.5, zone: 8, at: to });
    // recuo: para cima e um pouco para o lado (mais com o tempo de rajada, menos mirando e agachado)
    const k = (1 - this.ads * 0.35) * (this.move.crouch ? 0.8 : 1) * (1 + Math.min(this.shotsInBurst, 12) * 0.03);
    const side = (this.rand() - 0.42) * 2 * sp.recoil.side;
    this.host.turn(side * k, -sp.recoil.up * k);
    if (sp.boltMs) {
      // ferrolho: a animação começa logo depois do tiro
      this.boltPending = now + sp.boltMs;
      window.setTimeout(() => {
        if (this.weapon !== sp.id || !this.alive) return;
        this.vm.play('bolt', sp.boltMs! - 120);
        this.host.emit({ kind: 'gunfx', what: 'boltOpen', w: sp.id, power: 0.6, zone: 8, at: this.eye });
        window.setTimeout(
          () => this.host.emit({ kind: 'gunfx', what: 'boltClose', w: sp.id, power: 0.6, zone: 8, at: this.eye }),
          (sp.boltMs! - 120) * 0.62,
        );
      }, 120);
    }
    if (!sp.auto) this.semiReady = false;
    if (am.mag === 0 && am.reserve > 0) window.setTimeout(() => this.reload(performance.now()), 250);
  }

  private muzzleWorld(eye: V3): V3 {
    const yaw = this.host.yaw();
    // a boca da arma fica à direita e abaixo do olho, à frente
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    return { x: eye.x + fx * 0.6 + rx * 0.12, y: eye.y - 0.12, z: eye.z + fz * 0.6 + rz * 0.12 };
  }

  private tracer(a: V3, b: V3, now: number) {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
    ]);
    const line = new THREE.Line(g, this.tracerMat);
    line.frustumCulled = false;
    this.host.scene.add(line);
    this.tracers.push({ line, until: now + 60 });
  }

  /** acertei alguém: bot leva aqui; gente de verdade leva pela rede */
  private dealDamage(id: string, dmg: number, head: boolean, at: V3) {
    const kill = this.bots?.has(id)
      ? this.bots.hurt(id, dmg, this.host.selfId, this.weapon, head)
      : (this.host.send({ kind: 'hit', w: this.weapon, target: id, dmg, head }), false);
    this.host.emit({ kind: 'impact', flesh: true, head, power: 0.7, zone: 8, at });
    this.host.emit({
      kind: 'gunfx',
      what: kill ? 'kill' : head ? 'headshot' : 'hitmarker',
      w: this.weapon,
      power: 0.7,
      zone: 8,
      at: this.eye,
    });
    useGunHud.getState().set({ hitAt: Date.now(), hitKill: kill, hitHead: head });
  }

  /** levei dano (de alguém da rede ou de um bot) */
  hurt(
    by: string,
    dmg: number,
    w: GunId,
    head: boolean,
    from: { x: number; z: number } | null,
    now = performance.now(),
  ) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.lastHurt = now;
    this.host.emit({ kind: 'gunfx', what: 'hurt', w, power: 0.7, zone: 8, at: this.eye });
    if (from) {
      // de que lado veio, em relação a para onde olho
      const ang =
        Math.atan2(from.x - this.x, from.z - this.z) -
        Math.atan2(-Math.sin(this.host.yaw()), -Math.cos(this.host.yaw()));
      const st = useGunHud.getState();
      st.set({ hurts: [...st.hurts.filter((h) => Date.now() - h.at < 1500), { ang, at: Date.now() }] });
    }
    if (this.hp <= 0) this.die(by, w, head, now);
    else useGunHud.getState().set({ hp: Math.max(0, Math.round(this.hp)) });
  }

  // ------------------------------------------------------------ rede

  remote(g: SpaceGun & { sender: string }, now = performance.now()) {
    if (g.sender === this.host.selfId) return;
    switch (g.kind) {
      case 'fire':
        if (g.from && g.to) {
          const a = { x: g.from[0], y: g.from[1], z: g.from[2] };
          const b = { x: g.to[0], y: g.to[1], z: g.to[2] };
          this.tracer(a, b, now);
          this.host.emit({ kind: 'gunshot', by: g.sender, w: g.w, power: 1, zone: 8, at: a });
          this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.4, zone: 8, at: b });
        }
        break;
      case 'hit':
        if (g.target === this.host.selfId && g.dmg) {
          const p = this.host.players().find((x) => x.id === g.sender);
          this.hurt(g.sender, g.dmg, g.w, !!g.head, p ? { x: p.x, z: p.z } : null, now);
        }
        break;
      case 'die':
        this.onKill(g.by ?? g.sender, g.sender, g.w, !!g.head);
        break;
      case 'spawn':
        this.pushScores();
        break;
    }
  }

  // ------------------------------------------------------------ bots

  setBots(level: BotLevel | null, count: number) {
    this.bots?.dispose();
    this.bots = null;
    if (level) {
      this.bots = new GunBots(level, count, {
        host: this.host,
        me: () =>
          this.alive ? { id: this.host.selfId, x: this.x, y: this.move.y, z: this.z, crouch: this.crouching } : null,
        shoot: (s) => this.botShot(s),
        killed: (by, target, w, head) => this.onKill(by, target, w, head),
      });
    }
    useGunHud.getState().set({ bot: level, botCount: count });
    this.restart();
  }

  /** um bot atirou: confere em mim e nos outros bots */
  private botShot(s: BotShot) {
    const now = performance.now();
    const targets: Target[] = [];
    if (this.alive)
      targets.push({ id: this.host.selfId, x: this.x, y: this.move.y, z: this.z, crouch: this.crouching });
    for (const t of this.bots?.targets() ?? []) if (t.id !== s.by) targets.push(t);
    const hit = castShot(s.from, s.dir, targets, GUN_BOXES, 160);
    const to = { x: s.from.x + s.dir.x * hit.dist, y: s.from.y + s.dir.y * hit.dist, z: s.from.z + s.dir.z * hit.dist };
    this.tracer(s.muzzle, to, now);
    this.host.emit({ kind: 'gunshot', by: s.by, w: s.w, power: 1, zone: 8, at: s.from });
    if (!hit.target) {
      this.host.emit({ kind: 'impact', flesh: false, head: false, power: 0.4, zone: 8, at: to });
      return;
    }
    const dmg = damageAt(GUNS[s.w], hit.dist, hit.head);
    if (hit.target === this.host.selfId) this.hurt(s.by, dmg, s.w, hit.head, { x: s.from.x, z: s.from.z }, now);
    else this.bots?.hurt(hit.target, dmg, s.by, s.w, hit.head);
  }

  // ------------------------------------------------------------ quadro

  step(dt: number, now: number) {
    if (this.disposed) return;
    // morto: espera e renasce
    if (!this.alive) {
      if (this.respawnAt && now >= this.respawnAt) this.respawn(now);
      this.bots?.update(dt, now);
      this.stepTracers(now);
      this.hud(now);
      return;
    }
    const sp = this.spec;
    const yaw = this.host.yaw();
    const w = this.host.wish();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let wx = fx * w.f + rx * w.r;
    let wz = fz * w.f + rz * w.r;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const adsHeld = this.host.held('ads') && sp.cls !== 'knife' && now >= this.drawUntil;
    const firing = this.host.held('fire') && sp.cls !== 'knife';
    const wasGrounded = this.move.grounded;
    const r = stepMove(
      this.move,
      { wx, wz, runHeld: this.host.held('run'), forward: w.f > 0.5, ads: adsHeld, gunK: sp.move, firing },
      dt,
      now,
    );
    if (r.landed && !r.bhop)
      this.host.emit({ kind: 'gunfx', what: 'land', w: this.weapon, power: 0.4, zone: 8, at: this.eye });
    void wasGrounded;
    const p = resolve(this.host.obstacles, this.x + r.dx, this.z + r.dz);
    // bateu na parede: a velocidade naquele eixo some
    if (Math.abs(p.x - (this.x + r.dx)) > 1e-4) this.move.vx = 0;
    if (Math.abs(p.z - (this.z + r.dz)) > 1e-4) this.move.vz = 0;
    this.x = p.x;
    this.z = p.z;
    if (Math.hypot(this.move.vx, this.move.vz) > 0.3 || this.firstPerson) this.ry = Math.atan2(fx, fz);
    // olho: em pé, agachado ou deslizando (desce e sobe suave)
    const want = sliding(this.move, now) ? 0.62 : this.move.crouch ? EYE.crouch : EYE.stand;
    this.eyeY += (want - this.eyeY) * Math.min(1, dt * 14);
    // mira: entra no tempo da arma, sai mais rápido
    const adsRate = 1000 / Math.max(1, sp.adsMs);
    this.ads = Math.max(0, Math.min(1, this.ads + (adsHeld ? adsRate : -adsRate * 1.4) * dt));
    // recarga terminou
    if (this.reloadUntil && now >= this.reloadUntil) {
      this.reloadUntil = 0;
      this.finishReload();
    }
    // gatilho
    if (this.triggerDown && (sp.auto || this.semiReady)) this.fire(now);
    // vida volta sozinha
    if (this.hp < MAX_HP && now - this.lastHurt > REGEN_DELAY_MS)
      this.hp = Math.min(MAX_HP, this.hp + REGEN_PER_S * dt);
    this.host.place({ x: this.x, y: this.move.y, z: this.z, ry: this.ry });
    // primeira pessoa: a arma balança com o mouse, o passo e o movimento
    const look = { yaw: this.host.yaw(), pitch: this.host.pitch() };
    this.vm.update(dt, now, {
      ads: this.ads,
      moving: Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk),
      sprint: this.move.sprint,
      tactical: this.move.tactical,
      slide: sliding(this.move, now),
      crouch: this.move.crouch,
      airborne: !this.move.grounded,
      lookX: look.yaw - this.lookPrev.yaw,
      lookY: look.pitch - this.lookPrev.pitch,
    });
    this.lookPrev = look;
    this.bots?.update(dt, now);
    this.stepTracers(now);
    this.hud(now);
  }

  /** a câmera: onde fica o olho (primeira pessoa) e o zoom da mira */
  fov(base: number): number {
    const z = this.spec.zoom;
    return base / (1 + (z - 1) * this.ads);
  }

  get scoped(): boolean {
    return this.spec.scope && this.ads > 0.85;
  }

  /** desenha a arma por cima (primeira pessoa, sem luneta) */
  render(r: THREE.WebGLRenderer) {
    this.vm.render(r, this.firstPerson && this.alive && !this.scoped);
  }

  private stepTracers(now: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      if (now < t.until) continue;
      this.host.scene.remove(t.line);
      t.line.geometry.dispose();
      this.tracers.splice(i, 1);
    }
  }

  private hud(now: number) {
    if (now - this.lastHud < 50) return;
    this.lastHud = now;
    const am = this.ammo.get(this.weapon);
    const sp = this.spec;
    const moving = Math.min(1, Math.hypot(this.move.vx, this.move.vz) / MOVE.walk);
    const spread = spreadNow(sp, this.ads, moving, this.move.crouch) * (this.move.grounded ? 1 : 2);
    const fovRad = (this.host.camera.fov * Math.PI) / 180;
    const px = (Math.tan(spread) / Math.tan(fovRad / 2)) * (window.innerHeight / 2);
    useGunHud.getState().set({
      hp: Math.max(0, Math.round(this.hp)),
      weapon: this.weapon,
      mag: am?.mag ?? 0,
      reserve: am?.reserve ?? 0,
      reloading: this.reloadUntil > 0,
      ads: this.ads,
      scoped: this.scoped,
      spreadPx: Math.max(6, Math.min(120, px)),
      sprint: this.move.sprint,
    });
    void this.lastFire;
    void UP;
  }

  dispose() {
    this.disposed = true;
    this.bots?.dispose();
    for (const t of this.tracers) {
      this.host.scene.remove(t.line);
      t.line.geometry.dispose();
    }
    this.tracers.length = 0;
    this.tracerMat.dispose();
    this.vm.dispose();
    useGunHud.getState().set({ active: false, bot: null });
  }
}

const v3 = (p: V3): [number, number, number] => [round(p.x), round(p.y), round(p.z)];
const round = (n: number) => Math.round(n * 100) / 100;
