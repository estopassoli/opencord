/**
 * Partida numa arena do Espaço 3D (ADR-0055). A bola é de quem tocou por último: essa pessoa simula e manda o
 * estado (~10x/s; parada, 1x/s); os outros simulam também (para ficar suave) e corrigem pelo que chega. Pontos: quem
 * simula detecta e avisa o servidor (que guarda o placar e ignora o mesmo lance duas vezes).
 * Se o dono some ou fica calado, o menor id vivo na zona assume (ADR-0056, `net/authority.ts`).
 * Os efeitos (chute, rebatida, quique, aro, ponto…) saem em todos os clientes pelo `emit` (ADR-0056).
 * - Basquete: interagir perto da bola pega (ou rouba: só de frente e depois de 1 s de posse, `rules.canSteal`);
 *   segurar a ação carrega o arremesso, soltar arremessa na cesta de ataque do time (`rules.attackHoop`), com a faixa
 *   verde de `rules.goodBand`.
 * - Futebol: encostar na bola chuta (correndo chuta mais forte); a ação perto dá um chute forte para onde você olha.
 * - Tênis, vôlei e ping pong: a ação com a bola perto rebate para o outro lado; com a bola parada no saque, saca.
 *   O lado é o do time (`rules.netSideOf`), não a posição; em jogo, se ninguém sacar em 8 s, o saque sai sozinho.
 * Com partida (`setPhase`): na contagem ninguém pega nem saca.
 */
import type { MatchPhase, SportZone } from '@opencord/contracts';
import * as THREE from 'three';
import { ballMesh, ballShadow, landingRing } from './arena3d';
import { power01, type GameEvent, type ScoreReason } from './events';
import { nextAuthority } from './net/authority';
import { attackHoop, AUTO_SERVE_MS, canSteal, goodBand, netSideOf, type Team } from './rules';
import {
  ARENAS,
  basketShot,
  contactDt,
  hitQuality,
  hoopDist,
  landingPoint,
  lob,
  PERFECT_WINDOW,
  stepBall,
  type BallEvent,
  type BallState,
  type HitQuality,
  type Vec,
} from './sports';

/**
 * O que a ação apertada fez (plano 2026-11-09, P5): `hit` = pegou/bateu na bola, `whiff` = o golpe saiu, mas no ar.
 * Nos jogos de rede, `quality` diz se a rebatida foi cedo, na hora ou tarde (o saque não tem).
 */
export interface PressResult {
  result: 'hit' | 'whiff';
  quality?: HitQuality;
}

/** basquete: o arremesso saiu curto, na faixa verde ou longo */
export type ShotQuality = 'short' | 'perfect' | 'long';

export interface RemoteBall extends BallState {
  held: string | null;
  t: number;
  by: string;
}

export interface SportHooks {
  sendBall(b: BallState & { held: string | null; t: number }): void;
  score(side: 'a' | 'b', points: number): void;
  /** efeitos (ADR-0056), em todos os clientes */
  emit?(e: GameEvent): void;
  /** ids vivos nesta zona (incluindo eu): troca de autoridade e bola segura por quem sumiu */
  alive?(): string[];
  /** meu time (sem isto, vale o lado da quadra em que estou) */
  team?(): Team;
  /** time de outra pessoa na zona (quem só observa decide quem rebateu por último) */
  teamOf?(id: string): Team | undefined;
  /** posição e frente de alguém (roubo só de frente) */
  poseOf?(id: string): { x: number; z: number; ry: number } | null;
  /** tem adversário colado em mim (a faixa verde encolhe) */
  contested?(): boolean;
}

interface Me {
  x: number;
  y: number;
  z: number;
  ry: number;
  moving: boolean;
  running: boolean;
}

const HAND_Y = 1.25;
const WHIFF: PressResult = { result: 'whiff' };
const HIT: PressResult = { result: 'hit' };

export class SportPlay {
  readonly mesh: THREE.Mesh;
  /** sombra redonda embaixo da bola e anel de onde ela vai quicar (jogos de rede) */
  readonly shadow: THREE.Mesh;
  readonly landing: THREE.Mesh | null;
  private readonly landAt = { x: 0, y: 0, z: 0, t: 0 };
  private ball: BallState;
  private held: string | null = null;
  private authority: string | null = null;
  private touchT = 0;
  /** parada no lugar de saída (sem gravidade) até alguém tocar */
  private parked = true;
  private lastSend = 0;
  private kickCd = 0;
  private charge: number | null = null;
  private shotFrom: Vec | null = null;
  private resetAt = 0;
  /** tênis: quem rebateu por último (lado) e quantos quiques do outro lado */
  private hitSide: 'a' | 'b' | null = null;
  private bounces = 0;
  /** a bola bateu na rede desde a última rebatida (o ponto sai como "rede") */
  private netTouched = false;
  /** depois de um ponto, nenhum outro sai até a bola voltar (vale também para o efeito de quem só observa) */
  private quietUntil = 0;
  /** quando chegou o último estado da autoridade (relógio local) */
  private lastHeard = 0;
  private readonly fx: GameEvent[] = [];
  /** tênis: quem ganhou o último ponto saca */
  private serveSide: 'a' | 'b' = 'a';
  /** desde quando a bola está com quem a segura (proteção contra roubo, relógio local) */
  private heldSince = 0;
  /** desde quando a bola está parada esperando o saque */
  private parkedAt = 0;
  /** fase da partida (null = jogo livre, sem partida) e desde quando está em jogo */
  private phase: MatchPhase | null = null;
  private playingSince = 0;
  private me: Me = { x: 0, y: 0, z: 0, ry: 0, moving: false, running: false };

  constructor(
    private readonly scene: THREE.Scene,
    readonly zone: SportZone,
    private readonly selfId: string,
    private readonly hooks: SportHooks,
    private readonly handOf: (id: string) => Vec | null,
    /** tênis: onde fica a bola do saque de um lado (na frente de quem está daquele lado) */
    private readonly servePos: (side: 'a' | 'b') => Vec | null = () => null,
  ) {
    const a = ARENAS[zone];
    this.ball = { ...a.ballStart, vx: 0, vy: 0, vz: 0 };
    this.mesh = ballMesh(zone);
    scene.add(this.mesh);
    this.shadow = ballShadow(zone);
    scene.add(this.shadow);
    this.landing = a.net ? landingRing(zone) : null;
    if (this.landing) scene.add(this.landing);
    this.render();
  }

  get mine() {
    return this.authority === this.selfId;
  }

  /** fase da partida da arena (null = jogo livre) */
  setPhase(phase: MatchPhase | null, now = performance.now()) {
    if (phase === this.phase) return;
    if (phase === 'playing') this.playingSince = now;
    this.phase = phase;
  }

  private setHeld(id: string | null, now: number) {
    if (id !== this.held) this.heldSince = now;
    this.held = id;
  }

  private myTeam(): Team {
    return this.hooks.team?.() ?? (this.me.x < 0 ? 'a' : 'b');
  }

  /** basquete: dá para roubar agora (bola na mão de outra pessoa, proteção vencida e eu na frente dela)? */
  private stealable(now: number): boolean {
    if (!this.held || this.held === this.selfId) return false;
    const h = this.hooks.poseOf?.(this.held);
    return !h || canSteal(h, this.heldSince, this.me, now);
  }

  /** basquete: a faixa verde da força agora (null quando não estou com a bola) */
  band(): { lo: number; hi: number } | null {
    if (this.zone !== 1 || !this.holding) return null;
    return goodBand(hoopDist(this.me, attackHoop(this.myTeam())), this.hooks.contested?.() ?? false);
  }

  /** quem está com a bola (id) */
  get holder() {
    return this.held;
  }

  get holding() {
    return this.held === this.selfId;
  }

  get charging() {
    return this.charge;
  }

  /** o que dá para fazer agora e com qual atalho (para o aviso) */
  prompt(): { label: string; action: 'interact' | 'primary' } | null {
    const d = this.distToMe();
    if (this.zone === 1) {
      if (this.holding)
        return { label: this.charge === null ? 'Segure para arremessar' : 'Solte na faixa verde', action: 'primary' };
      if (d < 1.4 && this.phase !== 'countdown') {
        if (!this.held) return { label: 'Pegar a bola', action: 'interact' };
        if (this.stealable(performance.now())) return { label: 'Roubar a bola', action: 'interact' };
      }
      return null;
    }
    if (this.zone === 2) return d < 1.6 ? { label: 'Chutar forte', action: 'primary' } : null;
    if (this.parked && this.phase === 'countdown') return null;
    if (d < (ARENAS[this.zone].reach ?? 2))
      return { label: this.parked ? 'Sacar' : this.zone === 4 ? 'Bater na bola' : 'Rebater', action: 'primary' };
    return null;
  }

  private distToMe() {
    return Math.hypot(this.ball.x - this.me.x, this.ball.y - (this.me.y + 1), this.ball.z - this.me.z);
  }

  private take(now: number) {
    this.authority = this.selfId;
    // contador de toques (não o relógio de cada PC, que pode estar adiantado ou atrasado):
    // o meu toque vale um a mais que o maior que já vi
    this.touchT += 1;
    this.parked = false;
    this.lastSend = 0;
    this.send(now);
  }

  private emit(e: GameEvent) {
    this.hooks.emit?.(e);
  }

  private here(): GameEvent['at'] {
    return { x: this.ball.x, y: this.ball.y, z: this.ball.z };
  }

  /** soltou o mouse ou saiu da janela: a carga do arremesso some, sem arremessar */
  cancel() {
    this.charge = null;
  }

  /** a janela vai sumir (aba escondida): quem está com a bola na mão solta, para ela não congelar no ar */
  drop(now: number) {
    if (!this.holding) return;
    this.setHeld(null, now);
    this.charge = null;
    this.take(now);
  }

  /**
   * A ação apertada. O golpe sempre sai (a cena toca a pose na hora); o resultado diz se pegou na bola (`hit`) ou foi
   * no ar (`whiff`, que também vira evento). Nos jogos de rede vem junto a qualidade do tempo (cedo/perfeito/tarde).
   * Basquete: com a bola, começa a carregar; sem, pega (ou rouba) se estiver perto.
   */
  press(now: number): PressResult {
    const d = this.distToMe();
    // contagem 3-2-1: ninguém pega nem saca antes do VAI
    if (this.phase === 'countdown' && (this.parked || this.zone === 1) && !this.holding) return WHIFF;
    if (this.zone === 1) {
      if (this.holding) {
        this.charge = 0;
        return HIT;
      }
      if (d < 1.4 && (!this.held || this.stealable(now))) {
        this.setHeld(this.selfId, now);
        this.take(now);
        return HIT;
      }
      return WHIFF;
    }
    if (this.zone === 2) {
      if (d > 1.6) {
        this.emit({ kind: 'whiff', by: this.selfId, power: 0.4, zone: this.zone, at: this.meAt() });
        return WHIFF;
      }
      // chute forte para onde estou olhando
      this.ball.vx = Math.sin(this.me.ry) * 15;
      this.ball.vz = Math.cos(this.me.ry) * 15;
      this.ball.vy = 3.2;
      this.take(now);
      this.emit({ kind: 'kick', by: this.selfId, power: 1, zone: this.zone, at: this.here() });
      return HIT;
    }
    const a = ARENAS[this.zone];
    if (!a.net || !a.court) return WHIFF;
    if (d > (a.reach ?? 2)) {
      this.emit({ kind: 'whiff', by: this.selfId, power: 0.4, zone: this.zone, at: this.meAt() });
      return WHIFF;
    }
    // tênis, vôlei e ping pong: rebate para o outro lado; olhar mais para um lado puxa a bola para ele; o tempo
    // decide a profundidade e o ângulo (perfeita vai funda, cedo vai cruzada, tarde vai paralela)
    const z = this.zone as 3 | 4 | 5;
    const quality = this.parked ? undefined : hitQuality(contactDt(z, this.ball, this.me), PERFECT_WINDOW[z]);
    this.netHit(now, this.myTeam(), this.me.z + Math.cos(this.me.ry) * NET_TUNE[z].pull, quality);
    return quality ? { result: 'hit', quality } : HIT;
  }

  /** rebatida (ou saque) do time `team` para o outro lado, mirando `wantZ` (presa dentro da quadra) */
  private netHit(now: number, team: Team, wantZ: number, quality?: HitQuality) {
    const a = ARENAS[this.zone];
    if (!a.net || !a.court) return;
    const tune = NET_TUNE[this.zone as 3 | 4 | 5];
    const aim = netShotTarget(this.zone as 3 | 4 | 5, team, quality, this.me.z, wantZ, Math.random());
    const to = { x: aim.x, y: (a.table?.y ?? 0) + a.r, z: aim.z };
    const from = { x: this.ball.x, y: Math.max(this.ball.y, tune.minY), z: this.ball.z };
    // a bola tem que passar por cima da rede com folga
    const netTop = a.net.y0 + a.net.h + tune.clear;
    const apex = Math.max((this.parked ? tune.apex * 1.3 : tune.apex) * aim.apexK, netTop - Math.max(from.y, to.y));
    Object.assign(this.ball, from, lob(from, to, apex));
    this.hitSide = team;
    this.bounces = 0;
    this.netTouched = false;
    this.take(now);
    this.emit({
      kind: 'hit',
      by: this.selfId,
      with: this.zone === 4 ? 'hand' : 'racket',
      power: power01(Math.hypot(this.ball.vx, this.ball.vy, this.ball.vz), this.zone === 5 ? 8 : 15),
      zone: this.zone,
      at: this.here(),
    });
  }

  private meAt(): GameEvent['at'] {
    return { x: this.me.x, y: this.me.y + 1, z: this.me.z };
  }

  /** Ação solta (basquete: arremessa com a carga atual); devolve se a força saiu curta, na faixa ou longa */
  release(now: number): ShotQuality | null {
    if (this.zone !== 1 || !this.holding || this.charge === null) return null;
    const band = this.band();
    const hand = this.handOf(this.selfId) ?? { x: this.me.x, y: HAND_Y + 0.6, z: this.me.z };
    const from = { x: hand.x, y: hand.y + 0.2, z: hand.z };
    const charge = this.charge;
    Object.assign(this.ball, from, basketShot(from, charge, attackHoop(this.myTeam()), this.hooks.contested?.()));
    this.shotFrom = { x: this.me.x, y: 0, z: this.me.z };
    this.charge = null;
    this.setHeld(null, now);
    this.take(now);
    this.emit({ kind: 'hit', by: this.selfId, with: 'hand', power: charge, zone: this.zone, at: this.here() });
    if (!band) return null;
    return charge < band.lo ? 'short' : charge > band.hi ? 'long' : 'perfect';
  }

  /** nova partida: a bola volta para a saída (no tênis/vôlei/ping pong, o saque é do azul) para todos */
  resetMatch(now: number) {
    this.serveSide = 'a';
    this.resetAt = now;
    this.authority = this.selfId;
    this.touchT += 1;
    this.setHeld(null, now);
    this.charge = null;
  }

  /** estado vindo da rede */
  remote(b: RemoteBall, now = performance.now()) {
    if (b.by === this.selfId) return;
    // quem tocou depois (contador maior) manda; empate (dois toques ao mesmo tempo): o mesmo vencedor em todos os
    // apps, pelo id
    if (!acceptBall(b.t, b.by, this.touchT, this.authority)) return;
    const touched = b.t > this.touchT;
    const wasHeld = this.held;
    this.authority = b.by;
    this.touchT = b.t;
    this.lastHeard = now;
    // segura por quem já não está na zona: vira bola solta (senão fica parada no ar para sempre)
    let held = b.held;
    if (held && held !== b.by && held !== this.selfId && !this.isAlive(held)) held = null;
    this.setHeld(held, now);
    if (this.held !== this.selfId) this.charge = null;
    const far = Math.hypot(b.x - this.ball.x, b.y - this.ball.y, b.z - this.ball.z) > 1.5;
    const k = far ? 1 : 0.5;
    this.ball.x += (b.x - this.ball.x) * k;
    this.ball.y += (b.y - this.ball.y) * k;
    this.ball.z += (b.z - this.ball.z) * k;
    this.ball.vx = b.vx;
    this.ball.vy = b.vy;
    this.ball.vz = b.vz;
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    // bola solta de quem sumiu cai (não fica estacionada no ar)
    const loosened = !!b.held && !held;
    const parked = !loosened && !held && speed < 1e-3 && b.y > ARENAS[this.zone].r + 0.05;
    if (parked && !this.parked) this.parkedAt = now;
    this.parked = parked;
    if (touched) this.remoteTouch(b.by, wasHeld, speed);
  }

  private isAlive(id: string) {
    const alive = this.hooks.alive?.();
    return !alive || alive.includes(id);
  }

  /** quem só observa: o rival tocou na bola (efeito do toque e, nos jogos de rede, quem rebateu por último) */
  private remoteTouch(by: string, wasHeld: string | null, speed: number) {
    if (this.held || speed < 0.5) return;
    const at = this.here();
    const zone = this.zone;
    if (zone === 1) {
      if (wasHeld === by) this.emit({ kind: 'hit', by, with: 'hand', power: power01(speed, 12), zone, at });
      return;
    }
    if (zone === 2) {
      this.emit({ kind: 'kick', by, power: power01(speed, 15), zone, at });
      return;
    }
    this.hitSide = this.hooks.teamOf?.(by) ?? (this.ball.x < 0 ? 'a' : 'b');
    this.bounces = 0;
    this.netTouched = false;
    this.emit({
      kind: 'hit',
      by,
      with: zone === 4 ? 'hand' : 'racket',
      power: power01(speed, zone === 5 ? 8 : 15),
      zone,
      at,
    });
  }

  /** o dono sumiu ou ficou calado: o menor id vivo assume a partir do último estado */
  private checkAuthority(now: number) {
    const a = this.authority;
    if (!a || a === this.selfId || !this.hooks.alive) return;
    const alive = this.hooks.alive();
    if (this.held && this.held !== this.selfId && !alive.includes(this.held)) {
      this.setHeld(null, now);
      this.parked = false;
    }
    const next = nextAuthority(alive, a, this.lastHeard, now);
    if (next === a) return;
    this.authority = next;
    this.lastHeard = now;
    if (next === this.selfId) {
      // assumo com um toque a mais, para o meu estado valer em todos (e o do dono antigo, se voltar, não)
      this.touchT += 1;
      this.lastSend = 0;
    }
  }

  update(dt: number, now: number, me: Me) {
    this.me = me;
    const a = ARENAS[this.zone];
    if (this.charge !== null) this.charge = Math.min(1, this.charge + dt / 1.1);
    this.checkAuthority(now);

    if (this.held) {
      const hand = this.handOf(this.held);
      if (hand) Object.assign(this.ball, { x: hand.x, y: hand.y, z: hand.z, vx: 0, vy: 0, vz: 0 });
    } else if (!this.parked) {
      this.fx.length = 0;
      const events = stepBall(a, this.ball, dt, this.shotFrom, this.hooks.emit ? this.fx : undefined);
      for (const e of this.fx) this.emit(e);
      // a regra roda em todos (para o efeito do ponto); só a autoridade reporta
      for (const e of events) this.onEvent(e, now);
    }

    // futebol: encostar chuta
    this.kickCd -= dt;
    if (this.zone === 2 && this.kickCd <= 0) {
      const dx = this.ball.x - me.x;
      const dz = this.ball.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d < a.r + 0.45 && this.ball.y < 0.6) {
        const sp = me.running ? 9 : me.moving ? 5.5 : 2.5;
        this.ball.vx = (dx / (d || 1)) * sp;
        this.ball.vz = (dz / (d || 1)) * sp;
        this.ball.vy = me.running ? 1.2 : 0.4;
        this.kickCd = 0.25;
        this.take(now);
        this.emit({ kind: 'kick', by: this.selfId, power: power01(sp, 15), zone: this.zone, at: this.here() });
      }
    }

    // ponto marcado: a bola volta para a saída
    if (this.resetAt && now >= this.resetAt && this.mine) {
      this.resetAt = 0;
      const serveY = this.zone === 4 ? 1.6 : this.zone === 5 ? 1.05 : 1.2;
      const sp = a.net ? this.servePos(this.serveSide) : null;
      const start = a.net
        ? sp
          ? { ...sp, y: serveY }
          : { x: (this.serveSide === 'a' ? -1 : 1) * (a.serveX ?? 1), y: serveY, z: 0 }
        : a.ballStart;
      Object.assign(this.ball, start, { vx: 0, vy: 0, vz: 0 });
      this.parked = true;
      this.parkedAt = now;
      this.setHeld(null, now);
      this.shotFrom = null;
      this.hitSide = null;
      this.lastSend = 0;
    }

    // em jogo, ninguém sacou em 8 s: o saque sai sozinho (do lado de quem saca, para o meio da quadra)
    if (
      this.mine &&
      this.parked &&
      a.net &&
      this.phase === 'playing' &&
      !this.resetAt &&
      now - Math.max(this.parkedAt, this.playingSince) > AUTO_SERVE_MS
    )
      this.netHit(now, this.serveSide, 0);

    if (this.mine) this.send(now);
    this.render();
  }

  private onEvent(e: BallEvent, now: number) {
    const mine = this.mine;
    if ((mine && this.resetAt) || now < this.quietUntil) return;
    if (e.kind === 'net') {
      this.netTouched = true;
      return;
    }
    if (e.kind === 'score') {
      this.point(e.side, e.points, this.zone === 1 ? 'cesta' : 'gol', this.authority, now);
      return;
    }
    if (!this.hitSide) return;
    const call = netCall(this.zone, this.hitSide, e, this.bounces, this.netTouched);
    if (!call) return;
    if (call.kind === 'bounce') {
      this.bounces++;
      return;
    }
    if (mine) this.serveSide = call.side;
    this.point(call.side, 1, call.reason, call.side === this.hitSide ? this.authority : null, now);
  }

  /** ponto: efeito em todos; só a autoridade avisa o servidor e põe a bola de volta */
  private point(side: 'a' | 'b', points: number, reason: ScoreReason, by: string | null, now: number) {
    this.quietUntil = now + 1500;
    this.emit({ kind: 'score', side, points, by, reason, power: 1, zone: this.zone, at: this.here() });
    if (!this.mine) return;
    this.hooks.score(side, points);
    this.resetAt = now + 1500;
  }

  private send(now: number) {
    const moving = this.held !== null || Math.hypot(this.ball.vx, this.ball.vy, this.ball.vz) > 0.05;
    if (now - this.lastSend < (moving ? 100 : 1000)) return;
    this.lastSend = now;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    this.hooks.sendBall({
      x: r(this.ball.x),
      y: r(this.ball.y),
      z: r(this.ball.z),
      vx: r(this.ball.vx),
      vy: r(this.ball.vy),
      vz: r(this.ball.vz),
      held: this.held,
      t: this.touchT,
    });
  }

  private render() {
    const b = this.ball;
    this.mesh.position.set(b.x, b.y, b.z);
    const sp = Math.hypot(b.vx, b.vz);
    this.mesh.rotation.x += sp * 0.02;
    // sombra: no tampo da mesa quando a bola está em cima dela, senão no chão; menor e mais clara quanto mais alto
    const a = ARENAS[this.zone];
    const tb = a.table;
    const floor = tb && Math.abs(b.x) < tb.hx && Math.abs(b.z) < tb.hz && b.y >= tb.y ? tb.y : 0;
    const h = Math.max(0, b.y - a.r - floor);
    const k = Math.max(0.35, Math.min(1, 1 - h / 3));
    this.shadow.position.set(b.x, floor + 0.014, b.z);
    this.shadow.scale.setScalar(k);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.4 * k;
    // anel de queda: onde a bola em voo vai quicar (encolhe conforme ela chega)
    const ring = this.landing;
    if (!ring) return;
    const lp = !this.held && !this.parked && h > 0.05 ? landingPoint(a, b, this.landAt) : null;
    ring.visible = !!lp && lp.t > 0.05;
    if (lp && ring.visible) {
      ring.position.set(lp.x, lp.y + 0.016, lp.z);
      ring.scale.setScalar(0.7 + Math.min(1, lp.t) * 0.6);
    }
  }

  /** onde o anel de queda está agora (null = escondido) */
  landingMark(): { x: number; z: number } | null {
    return this.landing?.visible ? { x: this.landing.position.x, z: this.landing.position.z } : null;
  }

  dispose() {
    for (const m of [this.mesh, this.shadow, this.landing]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** A bola que chegou manda? Contador maior ganha; no empate, fica com quem já mandava ou com o maior id. */
export function acceptBall(t: number, by: string, myT: number, authority: string | null): boolean {
  if (t > myT) return true;
  if (t < myT) return false;
  return by === authority || !authority || by > authority;
}

/** ajustes do rebate de cada jogo de rede */
const NET_TUNE: Record<
  3 | 4 | 5,
  { depth: [number, number]; pull: number; margin: number; minY: number; apex: number; clear: number }
> = {
  3: { depth: [5, 10], pull: 6, margin: 0.8, minY: 0.9, apex: 1.2, clear: 0.5 },
  4: { depth: [1.5, 7.5], pull: 4, margin: 0.6, minY: 1.4, apex: 1, clear: 0.6 },
  5: { depth: [0.35, 1.2], pull: 0.8, margin: 0.12, minY: 0.85, apex: 0.25, clear: 0.12 },
};

/**
 * Para onde vai a rebatida (puro, testado): perfeita cai funda (no fundo da quadra do outro lado) e mais rápida (mais
 * reta); cedo vai cruzada (para o outro lado da quadra em relação a mim) e tarde vai paralela (na minha linha), as duas
 * mais curtas. Sem qualidade (saque), a profundidade é qualquer uma. `rnd` em [0, 1).
 */
export function netShotTarget(
  zone: 3 | 4 | 5,
  team: Team,
  quality: HitQuality | undefined,
  meZ: number,
  wantZ: number,
  rnd: number,
): { x: number; z: number; apexK: number } {
  const c = ARENAS[zone].court!;
  const tune = NET_TUNE[zone];
  const side = -netSideOf(team);
  const [d0, d1] = tune.depth;
  const lim = c.hz - tune.margin;
  const clampZ = (z: number) => Math.max(-lim, Math.min(lim, z));
  const depth = (f: number) => side * (d0 + f * (d1 - d0));
  if (quality === 'perfect') return { x: depth(0.8 + 0.2 * rnd), z: clampZ(wantZ), apexK: 0.8 };
  if (quality === 'early')
    return { x: depth(0.15 + 0.25 * rnd), z: clampZ(-(Math.sign(meZ) || 1) * lim * 0.8), apexK: 1 };
  if (quality === 'late') return { x: depth(0.15 + 0.25 * rnd), z: clampZ(meZ), apexK: 1 };
  return { x: depth(rnd), z: clampZ(wantZ), apexK: 1 };
}

/** o que um quique decide nos jogos de rede */
export type NetCall =
  | {
      kind: 'point';
      side: 'a' | 'b';
      reason: Extract<ScoreReason, 'fora' | 'rede' | 'dois quiques' | 'caiu' | 'não passou'>;
    }
  | { kind: 'bounce' }
  | null;

/**
 * Regra de ponto dos jogos de rede, a cada quique (quem rebateu por último = `hitSide`; A joga em x < 0), com o
 * motivo (ADR-0056). `netTouched` = a bola bateu na rede depois da rebatida (o erro sai como "rede").
 * Devolve o ponto (lado e motivo), 'bounce' (conta mais um quique do outro lado) ou null (nada acontece).
 */
export function netCall(
  zone: number,
  hitSide: 'a' | 'b',
  e: { x: number; z: number; surface: 'floor' | 'table' },
  bounces: number,
  netTouched = false,
): NetCall {
  const other = hitSide === 'a' ? 'b' : 'a';
  const sideOf = e.x < 0 ? 'a' : 'b';
  const c = ARENAS[zone as 3 | 4 | 5].court;
  if (!c) return null;
  const out = Math.abs(e.x) > c.hx || Math.abs(e.z) > c.hz;
  const short = netTouched ? 'rede' : 'não passou';
  const pt = (side: 'a' | 'b', reason: Extract<NetCall, { kind: 'point' }>['reason']): NetCall => ({
    kind: 'point',
    side,
    reason,
  });
  if (zone === 4) {
    // vôlei: caiu no chão = ponto; fora, perde quem bateu; dentro, perde quem deixou cair
    if (out) return pt(other, 'fora');
    return sideOf === hitSide ? pt(other, short) : pt(hitSide, 'caiu');
  }
  if (zone === 5) {
    // ping pong: precisa quicar na mesa do outro lado; no chão sem quicar lá = erro
    if (e.surface === 'table') {
      if (sideOf === hitSide) return pt(other, short);
      return bounces + 1 >= 2 ? pt(hitSide, 'dois quiques') : { kind: 'bounce' };
    }
    return bounces === 0 ? pt(other, 'fora') : pt(hitSide, 'caiu');
  }
  // tênis
  if (sideOf === hitSide) return pt(other, short); // não passou da rede
  if (out) return bounces === 0 ? pt(other, 'fora') : pt(hitSide, 'dois quiques'); // fora direto: erro
  return bounces + 1 >= 2 ? pt(hitSide, 'dois quiques') : { kind: 'bounce' };
}

/** Só o lado (forma antiga de `netCall`, sem o motivo). */
export function netPoint(
  zone: number,
  hitSide: 'a' | 'b',
  e: { x: number; z: number; surface: 'floor' | 'table' },
  bounces: number,
): 'a' | 'b' | 'bounce' | null {
  const c = netCall(zone, hitSide, e, bounces);
  return !c ? null : c.kind === 'bounce' ? 'bounce' : c.side;
}
