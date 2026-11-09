/**
 * O bot na cena: o boneco a mais ("Bot · Fácil"), o corpo dele (andar, pular, carrinho, cair, socar, pilotar) e a
 * ligação entre os cérebros puros (`sportbot`, `poolbot`, `racebot`, `duelbot`) e os jogos de verdade (`SportPlay`,
 * `PoolPlay`, a moto, o x1). Tudo roda só neste app: o bot não manda nada para a rede e o placar é o local
 * (`bots/store.ts`).
 */
import { DUEL_RING_R, duelDamage, duelReaches, type MatchPhase } from '@opencord/contracts';
import * as THREE from 'three';
import { Avatar, SWING_A, SWING_MS, type Pose, type SwingA } from '../avatar';
import type { GameEvent } from '../events';
import { PLAYER_R } from '../physics';
import type { PoolPlay } from '../pool';
import { fireBoost, startGrid, stepBike, type Bike } from '../race';
import { clampToHalf, GOOD_BAND, type Team } from '../rules';
import { sfx } from '../sfx';
import type { FootMove, Me, SportPlay } from '../sportplay';
import type { Vec } from '../sports';
import { DuelBrain } from './duelbot';
import { BOT_SKILL } from './level';
import { planPoolShot, type PoolShot } from './poolbot';
import { RaceBrain } from './racebot';
import { seeded, type Rng } from './rng';
import { SportBrain, type BotCmd } from './sportbot';
import { useBotPlay, type ActiveBot } from './store';

/** o que o bot precisa da cena */
export interface BotHost {
  readonly scene: THREE.Scene;
  zone(): number;
  myPose(): Pose;
  myTeam(): Team;
  myBlocking(): boolean;
  sport(): SportPlay | null;
  pool(): PoolPlay | null;
  phase(): MatchPhase | null;
  emit(e: GameEvent): void;
  resolve(x: number, z: number): { x: number; z: number };
  handOf(id: string): Vec | null;
  race(): { localStart: number | null; laps: number };
  /** quantas pessoas de verdade (fora eu) estão na minha zona agora */
  realPeersHere(): number;
}

const WALK = 3.2;
const RUN = 6.2;
/** futebol: velocidade com a bola no pé (a mesma regra de quem joga: 10% mais lento) */
const BALL_CARRY_SPEED = 0.9;
const GRAVITY = 15;
const JUMP_V = 5.2;

export class BotRunner {
  readonly avatar: Avatar;
  readonly id: string;
  readonly name: string;
  readonly team: Team;
  pose: Pose = { x: 0, y: 0, z: 0, ry: 0, a: 0 };
  /** x1: defendendo agora */
  blocking = false;
  private readonly zone: number;
  private readonly rng: Rng;
  private readonly sportBrain: SportBrain | null;
  private readonly raceBrain: RaceBrain | null;
  private readonly duelBrain: DuelBrain | null;
  private vy = 0;
  private round = -1;
  private lastCheck = 0;
  // futebol: caído, segurado, carrinho/elástico e o golpe
  private fallUntil = 0;
  private stunUntil = 0;
  private dash: { until: number; x: number; z: number; speed: number; a: number; ms: number } | null = null;
  private swingA: SwingA = SWING_A.kick;
  private swingUntil = 0;
  // sinuca
  private poolPlan: PoolShot | null = null;
  private poolAt = 0;
  // corrida
  bike: Bike | null = null;
  private raceDone = false;
  // x1
  private punchUntil = 0;
  private punchKind = 0;
  private pending: { at: number; strong: boolean } | null = null;
  private koUntil = 0;
  private seenEnd: string | null = null;

  constructor(
    private readonly host: BotHost,
    bot: ActiveBot,
  ) {
    this.id = bot.id;
    this.name = bot.name;
    this.team = bot.team;
    this.zone = bot.zone;
    this.rng = seeded(Date.now() & 0xffffffff);
    this.sportBrain = bot.zone >= 1 && bot.zone <= 5 ? new SportBrain(bot.level, this.rng) : null;
    this.raceBrain = bot.zone === 7 ? new RaceBrain(bot.level, this.rng) : null;
    this.duelBrain = bot.zone === 0 ? new DuelBrain(bot.level, this.rng) : null;
    this.avatar = new Avatar(bot.id, bot.name);
    this.avatar.setTeam(bot.zone >= 1 && bot.zone <= 6 ? bot.team : null);
    this.avatar.setRacket(bot.zone === 3 ? 'tennis' : bot.zone === 5 ? 'pingpong' : null);
    this.avatar.setBike(bot.zone === 7);
    host.scene.add(this.avatar.root);
  }

  private get level() {
    return useBotPlay.getState().bot?.level ?? 'medio';
  }

  private get skill() {
    return BOT_SKILL[this.level];
  }

  /** começo de partida (e a cada Revanche): o bot vai para o lugar dele */
  private reset(now: number) {
    const z = this.zone;
    const me = this.host.myPose();
    this.fallUntil = this.stunUntil = this.swingUntil = this.punchUntil = this.koUntil = 0;
    this.dash = null;
    this.pending = null;
    this.poolPlan = null;
    this.blocking = false;
    if (z >= 1 && z <= 5) {
      const side = this.team === 'a' ? -1 : 1;
      const x = side * (z === 5 ? 2.1 : z === 4 ? 5 : z === 3 ? 9.5 : 6);
      this.pose = { x, y: 0, z: 0, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2, a: 0 };
    } else if (z === 6) this.pose = { x: 2.2, y: 0, z: 1.6, ry: -Math.PI / 2, a: 0 };
    else if (z === 7) {
      this.bike = startGrid(1);
      this.raceDone = false;
      this.pose = { x: this.bike.x, y: 0.45, z: this.bike.z, ry: this.bike.h, a: 5 };
    } else {
      // x1: do outro lado do ringue, de frente para mim
      const ring = useBotPlay.getState().duel?.ring ?? { x: me.x, z: me.z };
      let dx = ring.x - me.x;
      let dz = ring.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) {
        dx = Math.sin(me.ry);
        dz = Math.cos(me.ry);
      } else {
        dx /= d;
        dz /= d;
      }
      const p = this.host.resolve(ring.x + dx * 1.3, ring.z + dz * 1.3);
      this.pose = { x: p.x, y: 0, z: p.z, ry: Math.atan2(me.x - p.x, me.z - p.z), a: 0 };
    }
    this.avatar.place(this.pose);
    this.lastCheck = now;
  }

  /** um quadro do bot (`now` = relógio do quadro, ms) */
  step(dt: number, now: number, t: number, realDt: number) {
    const st = useBotPlay.getState();
    st.tick();
    const bot = useBotPlay.getState().bot;
    if (!bot || bot.id !== this.id) return;
    if (bot.round !== this.round) {
      this.round = bot.round;
      this.reset(now);
    }
    // alguém de verdade entrou na arena: o bot sai (a simulação é só deste app)
    if (this.zone !== 0 && now - this.lastCheck > 500) {
      this.lastCheck = now;
      if (this.host.realPeersHere() > 0) {
        st.stop('Alguém entrou na arena: a partida contra o bot acabou.');
        return;
      }
    }
    if (this.zone >= 1 && this.zone <= 5) this.stepSport(dt, now);
    else if (this.zone === 6) this.stepPool(dt, now);
    else if (this.zone === 7) this.stepRace(dt, now);
    else this.stepDuel(dt, now);
    this.avatar.place(this.pose);
    this.holdBall();
    this.avatar.update(dt, t, realDt);
  }

  // ---------------------------------------------------------------- esportes com bola
  private contested(): boolean {
    const me = this.host.myPose();
    return Math.hypot(me.x - this.pose.x, me.z - this.pose.z) < GOOD_BAND.contestR;
  }

  private stepSport(dt: number, now: number) {
    const sp = this.host.sport();
    const brain = this.sportBrain;
    if (!sp || !brain) return;
    const zone = this.zone as 1 | 2 | 3 | 4 | 5;
    const me = this.host.myPose();
    const contested = this.contested();
    const locked = now < this.fallUntil || now < this.stunUntil || (!!this.dash && now < this.dash.until);
    const holder = sp.holder === this.id ? 'bot' : sp.holder ? 'foe' : null;
    const band = sp.asBot(this.me(false, false), this.team, contested, () => sp.band());
    const cmd: BotCmd = locked
      ? { to: null, run: false, face: null }
      : brain.think({
          zone,
          t: now / 1000,
          ball: sp.ballNow(),
          parked: sp.isParked,
          holder,
          heldFor: sp.heldFor(now) / 1000,
          bot: this.pose,
          team: this.team,
          foe: { x: me.x, z: me.z, ry: me.ry },
          phase: this.host.phase(),
          charge: sp.botCharging,
          band,
        });
    const moving = this.move(cmd, dt, now);
    const face = cmd.face ?? this.pose.ry;
    if (!moving && cmd.face !== null) this.pose.ry = cmd.face;
    if (this.pose.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.pose.y = Math.max(0, this.pose.y + this.vy * dt);
      if (this.pose.y === 0) this.vy = 0;
    }
    const meNow = { ...this.me(moving || !!this.dash, cmd.run), aim: face };
    sp.botStep(dt, now, meNow, this.team, contested);
    if (!locked)
      sp.asBot(meNow, this.team, contested, () => {
        if (zone === 1) {
          if (cmd.press) sp.press(now);
          if (cmd.release) sp.release(now);
        } else if (zone === 2) {
          if (cmd.press) this.footMove(sp.footPress(now, true).move, now, sp);
          else if (cmd.secondary) this.footMove(sp.footPress(now, false).move, now, sp);
          else if (cmd.interact) this.footMove(sp.footInteract(now), now, sp);
          else if (cmd.jump && this.pose.y <= 0.001 && sp.footJump(now)) {
            this.vy = JUMP_V * 0.55;
            this.footMove('kick', now, sp);
          }
        } else if (cmd.press) {
          // a rebatida vai para onde o boneco olha na hora
          this.pose.ry = face;
          sp.press(now);
          const b = sp.ballNow();
          const right = (b.x - this.pose.x) * -Math.cos(this.pose.ry) + (b.z - this.pose.z) * Math.sin(this.pose.ry);
          this.swing(zone === 4 ? SWING_A.bump : right >= 0 ? SWING_A.forehand : SWING_A.backhand, now);
        }
      });
    if (now < this.fallUntil) this.pose.a = 17;
    else if (this.dash && now < this.dash.until) this.pose.a = this.dash.a;
    else if (now < this.swingUntil) this.pose.a = this.swingA;
    else this.pose.a = this.pose.y > 0.01 ? 3 : moving ? (cmd.run ? 2 : 1) : 0;
  }

  /** o bot como jogador do SportPlay */
  private me(moving: boolean, running: boolean): Me {
    const p = this.pose;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      ry: p.ry,
      moving,
      running,
      aim: p.ry,
      speed: this.dash ? this.dash.speed : moving ? (running ? RUN : WALK) * this.skill.speed * this.carry() : 0,
    };
  }

  /** futebol com a bola no pé: anda mais devagar */
  private carry(): number {
    return this.zone === 2 && this.host.sport()?.holder === this.id ? BALL_CARRY_SPEED : 1;
  }

  /** anda até `cmd.to` (ou segue o carrinho/elástico); devolve se andou */
  private move(cmd: BotCmd, dt: number, now: number): boolean {
    const dash = this.dash && now < this.dash.until ? this.dash : null;
    if (!dash) this.dash = null;
    if (dash) {
      const left = (dash.until - now) / dash.ms;
      const sp = dash.speed * (dash.a === SWING_A.slide ? 0.35 + 0.65 * left : 1) * dt;
      this.place(this.pose.x + dash.x * sp, this.pose.z + dash.z * sp);
      return true;
    }
    if (!cmd.to) return false;
    const dx = cmd.to.x - this.pose.x;
    const dz = cmd.to.z - this.pose.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) return false;
    const step = Math.min(d, (cmd.run ? RUN : WALK) * this.skill.speed * this.carry() * dt);
    this.place(this.pose.x + (dx / d) * step, this.pose.z + (dz / d) * step);
    this.pose.ry = Math.atan2(dx, dz);
    return true;
  }

  private place(x: number, z: number) {
    let p = this.host.resolve(x, z);
    if (this.zone >= 3 && this.zone <= 5) p = { x: clampToHalf(p.x, this.team, PLAYER_R + 0.05), z: p.z };
    this.pose.x = p.x;
    this.pose.z = p.z;
  }

  private swing(a: SwingA, now: number) {
    this.swingA = a;
    this.swingUntil = now + SWING_MS[a];
    this.avatar.strike();
  }

  /** a pose (e o deslocamento) do lance do futebol, como o da cena para mim */
  private footMove(m: FootMove | null, now: number, sp: SportPlay) {
    if (!m) return;
    if (m === 'kick' || m === 'bike') {
      this.swing(m === 'bike' ? SWING_A.bike : SWING_A.kick, now);
      if (m === 'bike' && this.pose.y <= 0.001) this.vy = JUMP_V * 0.85;
    } else if (m === 'slide') {
      const d = sp.botSliding ?? { x: Math.sin(this.pose.ry), z: Math.cos(this.pose.ry) };
      this.dash = { until: now + 650, x: d.x, z: d.z, speed: 7.5, a: SWING_A.slide, ms: 650 };
      this.pose.ry = Math.atan2(d.x, d.z);
      this.avatar.strike();
    } else if (m === 'elastico') {
      const side = this.rng() < 0.5 ? -1 : 1;
      this.dash = {
        until: now + 300,
        x: -Math.cos(this.pose.ry) * side,
        z: Math.sin(this.pose.ry) * side,
        speed: 5.5,
        a: SWING_A.elastico,
        ms: 300,
      };
      this.avatar.strike();
    }
  }

  /** futebol: desarme ou falta envolvendo o bot */
  onTackle(e: { by: string; on: string; foul: boolean }, now: number) {
    if (e.on === this.id) {
      if (e.foul) this.fallUntil = now + 1300;
      else {
        this.avatar.hitReact();
        this.stunUntil = now + 450;
      }
      this.dash = null;
    } else if (e.by === this.id && e.foul) this.stunUntil = Math.max(this.stunUntil, now + 900);
  }

  /** os braços vão até a bola quando o bot está com ela (basquete) */
  private holdBall() {
    const sp = this.host.sport();
    if (this.zone === 2 || !sp || sp.holder !== this.id) return this.avatar.setHold(null);
    const h = this.host.handOf(this.id);
    if (!h) return this.avatar.setHold(null);
    const dribbling = (this.pose.a === 1 || this.pose.a === 2) && sp.botCharging === null;
    this.avatar.setHold(new THREE.Vector3(h.x, dribbling ? Math.max(h.y, this.pose.y + 0.55) : h.y, h.z), !dribbling);
  }

  // ---------------------------------------------------------------- sinuca
  /** direção do taco quando é a vez do bot (a cena desenha o taco para lá); null = não é a vez dele */
  poolAim(): number | null {
    return this.poolPlan ? this.poolPlan.angle : null;
  }

  private stepPool(dt: number, now: number) {
    const pool = this.host.pool();
    if (!pool) return;
    const myTurn = pool.turnId === this.id && !pool.moving && this.host.phase() !== 'countdown';
    if (!myTurn) {
      this.poolPlan = null;
      this.walkTo({ x: 2.2, z: 1.6 }, dt);
      this.pose.ry = Math.atan2(-this.pose.x, -this.pose.z);
      return;
    }
    if (!this.poolPlan) {
      this.poolPlan = planPoolShot(pool.balls, this.level, this.rng);
      this.poolAt = now + 900 + this.skill.reaction * 1500;
    }
    // atrás da branca, do lado de fora da mesa, olhando a tacada
    const c = pool.cueBall();
    const a = this.poolPlan.angle;
    let sx = c.x - Math.sin(a) * 0.5;
    let sz = c.z - Math.cos(a) * 0.5;
    for (let k = 0; k < 20 && Math.abs(sx) < 1.75 && Math.abs(sz) < 1.1; k++) {
      sx -= Math.sin(a) * 0.15;
      sz -= Math.cos(a) * 0.15;
    }
    const arrived = this.walkTo({ x: sx, z: sz }, dt);
    this.pose.ry = a;
    if (arrived && now >= this.poolAt && pool.botShot(this.id, a, this.poolPlan.charge, now)) {
      this.poolPlan = null;
      this.avatar.strike();
    }
  }

  /** anda até o ponto (sem correr); devolve se já chegou */
  private walkTo(to: { x: number; z: number }, dt: number): boolean {
    const moved = this.move({ to, run: false, face: null }, dt, performance.now());
    this.pose.a = moved ? 1 : 0;
    return Math.hypot(to.x - this.pose.x, to.z - this.pose.z) < 0.6;
  }

  // ---------------------------------------------------------------- corrida
  private stepRace(dt: number, now: number) {
    const brain = this.raceBrain;
    const b = this.bike;
    if (!brain || !b) return;
    const { localStart, laps } = this.host.race();
    const clock = Date.now();
    const go = localStart !== null && clock >= localStart && !this.raceDone;
    const { input, boost } = brain.drive(b, clock);
    if (go && boost && fireBoost(b, clock))
      this.host.emit({ kind: 'boost', source: 'item', power: 1, zone: 7, at: { x: b.x, y: 0.5, z: b.z } });
    const events = stepBike(b, go ? input : { up: false, down: false, left: false, right: false }, dt, clock, go);
    for (const e of events)
      if (e.kind === 'lap' && localStart !== null && e.lap >= laps && !this.raceDone) {
        this.raceDone = true;
        useBotPlay.getState().raceFinish(this.id, clock - localStart);
      }
    this.pose = { x: b.x, y: 0.45, z: b.z, ry: b.h, a: 5 };
    this.avatar.spinWheels(b.v, dt);
    sfx.engine(this.id, b.v, { x: b.x, z: b.z }, clock < b.boostUntil);
    void now;
  }

  // ---------------------------------------------------------------- x1
  private stepDuel(dt: number, now: number) {
    const brain = this.duelBrain;
    const d = useBotPlay.getState().duel;
    if (!brain || !d) return;
    const me = this.host.myPose();
    if (d.status === 'ended' && this.seenEnd !== d.id) {
      this.seenEnd = d.id;
      if (d.reason === 'ko' && d.winner !== this.id) this.koUntil = now + 3500;
    }
    if (now < this.koUntil) {
      this.pose.a = 9;
      this.blocking = false;
      return;
    }
    const fighting = d.status === 'fighting';
    const cmd = brain.think({
      now,
      bot: this.pose,
      foe: { x: me.x, z: me.z, ry: me.ry, a: me.a },
      hpBot: d.hp[this.id] ?? 0,
      hpFoe: d.hp[d.a] ?? 0,
      fighting,
    });
    let moving = false;
    if (cmd.to && d.status !== 'ended') {
      const dx = cmd.to.x - this.pose.x;
      const dz = cmd.to.z - this.pose.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.1) {
        const step = Math.min(dist, WALK * this.skill.speed * dt);
        let p = this.host.resolve(this.pose.x + (dx / dist) * step, this.pose.z + (dz / dist) * step);
        // ninguém sai do ringue
        const r = d.ring;
        const rd = Math.hypot(p.x - r.x, p.z - r.z);
        const max = DUEL_RING_R - PLAYER_R;
        if (rd > max) p = { x: r.x + ((p.x - r.x) / rd) * max, z: r.z + ((p.z - r.z) / rd) * max };
        this.pose.x = p.x;
        this.pose.z = p.z;
        moving = true;
      }
    }
    this.pose.ry = cmd.face;
    this.blocking = fighting && cmd.block;
    if (fighting && cmd.punch && now >= this.punchUntil) {
      const strong = cmd.punch === 'strong';
      this.punchKind = strong ? 7 : 6;
      this.punchUntil = now + (strong ? 650 : 250);
      // o forte tem preparo (dá para ver e defender); o rápido sai na hora
      this.pending = { at: now + (strong ? 350 : 60), strong };
      const p = this.pose;
      this.host.emit({
        kind: 'punch',
        by: this.id,
        strong,
        landed: false,
        power: strong ? 1 : 0.5,
        zone: 0,
        at: { x: p.x + Math.sin(p.ry) * 0.5, y: p.y + 1.3, z: p.z + Math.cos(p.ry) * 0.5 },
      });
    }
    const pend = this.pending;
    if (pend && now >= pend.at) {
      this.pending = null;
      if (fighting && duelReaches(this.pose, me, 0.2)) {
        const blocked = this.host.myBlocking();
        useBotPlay.getState().duelHit(this.id, d.a, duelDamage(pend.strong, blocked), blocked);
      }
    }
    this.pose.a = now < this.punchUntil ? this.punchKind : this.blocking ? 8 : moving ? 1 : 0;
  }

  /** o meu soco (a cena chama no lugar do servidor): acerta se alcança o bot e ele não está defendendo */
  myPunch(strong: boolean) {
    const d = useBotPlay.getState().duel;
    if (!d || d.status !== 'fighting') return;
    if (!duelReaches(this.host.myPose(), this.pose, 0.2)) return;
    useBotPlay.getState().duelHit(d.a, this.id, duelDamage(strong, this.blocking), this.blocking);
  }

  /** ponto da partida contra o bot (placar local, nada vai para o servidor) */
  score(side: Team, points: number) {
    useBotPlay.getState().score(side, points);
  }

  /** cheguei na corrida contra o bot */
  finishMine(ms: number) {
    const st = useBotPlay.getState();
    if (st.bot) st.raceFinish(st.bot.me, ms);
  }

  dispose() {
    sfx.engine(this.id, null);
    this.host.scene.remove(this.avatar.root);
    this.avatar.dispose();
  }
}
