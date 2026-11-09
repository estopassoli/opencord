/**
 * Partida numa arena do Espaço 3D (ADR-0055). A bola é de quem tocou por último: essa pessoa simula e manda o
 * estado (~10x/s); os outros simulam também (para ficar suave) e corrigem pelo que chega. Pontos: quem simula detecta
 * e avisa o servidor (que guarda o placar e ignora o mesmo lance duas vezes).
 * - Basquete: F perto da bola pega (ou rouba); segurar F carrega o arremesso, soltar arremessa (faixa boa = cesta).
 * - Futebol: encostar na bola chuta (correndo chuta mais forte); F perto dá um chute forte para onde você olha.
 * - Tênis: F com a bola perto rebate para o outro lado; com a bola parada no saque, F saca.
 */
import type { SportZone } from '@opencord/contracts';
import * as THREE from 'three';
import { ballMesh } from './arena3d';
import { ARENAS, basketShot, lob, stepBall, type BallState, type Vec } from './sports';

export interface RemoteBall extends BallState {
  held: string | null;
  t: number;
  by: string;
}

export interface SportHooks {
  sendBall(b: BallState & { held: string | null; t: number }): void;
  score(side: 'a' | 'b', points: number): void;
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

export class SportPlay {
  readonly mesh: THREE.Mesh;
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
  /** tênis: quem ganhou o último ponto saca */
  private serveSide: 'a' | 'b' = 'a';
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
    this.render();
  }

  get mine() {
    return this.authority === this.selfId;
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
      if (d < 1.4) return { label: this.held ? 'Roubar a bola' : 'Pegar a bola', action: 'interact' };
      return null;
    }
    if (this.zone === 2) return d < 1.6 ? { label: 'Chutar forte', action: 'primary' } : null;
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

  /** F apertado */
  /** devolve true quando bateu na bola (a cena anima o braço/raquete) */
  press(now: number): boolean {
    const d = this.distToMe();
    if (this.zone === 1) {
      if (this.holding) {
        this.charge = 0;
        return false;
      }
      if (d < 1.4) {
        this.held = this.selfId;
        this.take(now);
      }
      return false;
    }
    if (this.zone === 2) {
      if (d > 1.6) return false;
      // chute forte para onde estou olhando
      this.ball.vx = Math.sin(this.me.ry) * 15;
      this.ball.vz = Math.cos(this.me.ry) * 15;
      this.ball.vy = 3.2;
      this.take(now);
      return true;
    }
    const a = ARENAS[this.zone];
    if (!a.net || !a.court || d > (a.reach ?? 2)) return false;
    // tênis, vôlei e ping pong: rebate para o outro lado; olhar mais para um lado puxa a bola para ele
    const c = a.court;
    const side = this.me.x < 0 ? 1 : -1;
    const tune = NET_TUNE[this.zone as 3 | 4 | 5];
    const aimZ = Math.max(
      -c.hz + tune.margin,
      Math.min(c.hz - tune.margin, this.me.z + Math.cos(this.me.ry) * tune.pull),
    );
    const to = {
      x: side * (tune.depth[0] + Math.random() * (tune.depth[1] - tune.depth[0])),
      y: (a.table?.y ?? 0) + a.r,
      z: aimZ,
    };
    const from = { x: this.ball.x, y: Math.max(this.ball.y, tune.minY), z: this.ball.z };
    // a bola tem que passar por cima da rede com folga
    const netTop = a.net.y0 + a.net.h + tune.clear;
    const apex = Math.max(this.parked ? tune.apex * 1.3 : tune.apex, netTop - Math.max(from.y, to.y));
    Object.assign(this.ball, from, lob(from, to, apex));
    this.hitSide = this.me.x < 0 ? 'a' : 'b';
    this.bounces = 0;
    this.take(now);
    return true;
  }

  /** F solto (basquete: arremessa com a carga atual) */
  release(now: number) {
    if (this.zone !== 1 || !this.holding || this.charge === null) return;
    const hand = this.handOf(this.selfId) ?? { x: this.me.x, y: HAND_Y + 0.6, z: this.me.z };
    const from = { x: hand.x, y: hand.y + 0.2, z: hand.z };
    Object.assign(this.ball, from, basketShot(from, this.charge, this.me.ry));
    this.shotFrom = { x: this.me.x, y: 0, z: this.me.z };
    this.charge = null;
    this.held = null;
    this.take(now);
  }

  /** nova partida: a bola volta para a saída (no tênis/vôlei/ping pong, o saque é do azul) para todos */
  resetMatch(now: number) {
    this.serveSide = 'a';
    this.resetAt = now;
    this.authority = this.selfId;
    this.touchT += 1;
    this.held = null;
    this.charge = null;
  }

  /** estado vindo da rede */
  remote(b: RemoteBall) {
    if (b.by === this.selfId) return;
    // quem tocou depois (contador maior) manda; empate (dois toques ao mesmo tempo): o mesmo vencedor em todos os
    // apps, pelo id
    if (!acceptBall(b.t, b.by, this.touchT, this.authority)) return;
    this.authority = b.by;
    this.touchT = b.t;
    this.held = b.held;
    if (this.held !== this.selfId) this.charge = null;
    const far = Math.hypot(b.x - this.ball.x, b.y - this.ball.y, b.z - this.ball.z) > 1.5;
    const k = far ? 1 : 0.5;
    this.ball.x += (b.x - this.ball.x) * k;
    this.ball.y += (b.y - this.ball.y) * k;
    this.ball.z += (b.z - this.ball.z) * k;
    this.ball.vx = b.vx;
    this.ball.vy = b.vy;
    this.ball.vz = b.vz;
    this.parked = !b.held && Math.hypot(b.vx, b.vy, b.vz) < 1e-3 && b.y > ARENAS[this.zone].r + 0.05;
  }

  update(dt: number, now: number, me: Me) {
    this.me = me;
    const a = ARENAS[this.zone];
    if (this.charge !== null) this.charge = Math.min(1, this.charge + dt / 1.1);

    if (this.held) {
      const hand = this.handOf(this.held);
      if (hand) Object.assign(this.ball, { x: hand.x, y: hand.y, z: hand.z, vx: 0, vy: 0, vz: 0 });
    } else if (!this.parked) {
      const events = stepBall(a, this.ball, dt, this.shotFrom);
      if (this.mine) for (const e of events) this.onEvent(e, now);
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
      this.held = null;
      this.shotFrom = null;
      this.hitSide = null;
      this.lastSend = 0;
    }

    if (this.mine) this.send(now);
    this.render();
  }

  private onEvent(e: ReturnType<typeof stepBall>[number], now: number) {
    if (this.resetAt) return;
    if (e.kind === 'score') {
      this.hooks.score(e.side, e.points);
      this.resetAt = now + 1500;
      return;
    }
    if (e.kind !== 'bounce' || !this.hitSide) return;
    const point = netPoint(this.zone, this.hitSide, e, this.bounces);
    if (point === 'bounce') {
      this.bounces++;
      return;
    }
    if (point) {
      this.serveSide = point;
      this.hooks.score(point, 1);
      this.resetAt = now + 1500;
    }
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
    this.mesh.position.set(this.ball.x, this.ball.y, this.ball.z);
    const sp = Math.hypot(this.ball.vx, this.ball.vz);
    this.mesh.rotation.x += sp * 0.02;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
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
 * Regra de ponto dos jogos de rede, a cada quique (quem rebateu por último = `hitSide`; A joga em x < 0).
 * Devolve o lado que marcou, 'bounce' (conta mais um quique do outro lado) ou null (nada acontece).
 */
export function netPoint(
  zone: number,
  hitSide: 'a' | 'b',
  e: { x: number; z: number; surface: 'floor' | 'table' },
  bounces: number,
): 'a' | 'b' | 'bounce' | null {
  const other = hitSide === 'a' ? 'b' : 'a';
  const sideOf = e.x < 0 ? 'a' : 'b';
  const c = ARENAS[zone as 3 | 4 | 5].court;
  if (!c) return null;
  const out = Math.abs(e.x) > c.hx || Math.abs(e.z) > c.hz;
  if (zone === 4) {
    // vôlei: caiu no chão = ponto; dentro, perde quem deixou cair; fora, perde quem bateu
    return out ? other : sideOf === 'a' ? 'b' : 'a';
  }
  if (zone === 5) {
    // ping pong: precisa quicar na mesa do outro lado; no chão sem quicar lá = erro
    if (e.surface === 'table') {
      if (sideOf === hitSide) return other;
      return bounces + 1 >= 2 ? hitSide : 'bounce';
    }
    return bounces === 0 ? other : hitSide;
  }
  // tênis
  if (sideOf === hitSide) return other; // não passou da rede
  if (out) return bounces === 0 ? other : hitSide; // fora direto: erro; depois de quicar dentro: ponto
  return bounces + 1 >= 2 ? hitSide : 'bounce';
}
