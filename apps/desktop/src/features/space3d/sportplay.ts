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
import { ARENAS, basketShot, COURT_HX, COURT_HZ, lob, stepBall, type BallState, type Vec } from './sports';

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
  private me: Me = { x: 0, y: 0, z: 0, ry: 0, moving: false, running: false };

  constructor(
    private readonly scene: THREE.Scene,
    readonly zone: SportZone,
    private readonly selfId: string,
    private readonly hooks: SportHooks,
    private readonly handOf: (id: string) => Vec | null,
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

  get holding() {
    return this.held === this.selfId;
  }

  get charging() {
    return this.charge;
  }

  /** o que o F faz agora (para o aviso) */
  prompt(): string | null {
    const d = this.distToMe();
    if (this.zone === 1) {
      if (this.holding) return this.charge === null ? 'Segure F para arremessar' : 'Solte F na faixa verde';
      if (d < 1.4) return this.held ? 'Roubar a bola' : 'Pegar a bola';
      return null;
    }
    if (this.zone === 2) return d < 1.6 ? 'Chutar forte' : null;
    if (d < 2) return this.parked ? 'Sacar' : 'Rebater';
    return null;
  }

  private distToMe() {
    return Math.hypot(this.ball.x - this.me.x, this.ball.y - (this.me.y + 1), this.ball.z - this.me.z);
  }

  private take(now: number) {
    this.authority = this.selfId;
    this.touchT = Date.now();
    this.parked = false;
    this.lastSend = 0;
    this.send(now);
  }

  /** F apertado */
  press(now: number) {
    const d = this.distToMe();
    if (this.zone === 1) {
      if (this.holding) {
        this.charge = 0;
        return;
      }
      if (d < 1.4) {
        this.held = this.selfId;
        this.take(now);
      }
      return;
    }
    if (this.zone === 2) {
      if (d > 1.6) return;
      // chute forte para onde estou olhando
      this.ball.vx = Math.sin(this.me.ry) * 15;
      this.ball.vz = Math.cos(this.me.ry) * 15;
      this.ball.vy = 3.2;
      this.take(now);
      return;
    }
    if (d > 2) return;
    // tênis: rebate para fundo do outro lado, puxando para onde estou olhando
    const side = this.me.x < 0 ? 1 : -1;
    // olhar mais para um lado puxa a bola para ele
    const aimZ = Math.max(-COURT_HZ + 0.8, Math.min(COURT_HZ - 0.8, this.me.z + Math.cos(this.me.ry) * 6));
    const to = { x: side * (5 + Math.random() * 5), y: ARENAS[3].r, z: aimZ };
    const from = { x: this.ball.x, y: Math.max(this.ball.y, 0.9), z: this.ball.z };
    Object.assign(this.ball, from, lob(from, to, this.parked ? 1.6 : 1.2));
    this.hitSide = this.me.x < 0 ? 'a' : 'b';
    this.bounces = 0;
    this.take(now);
  }

  /** F solto (basquete: arremessa com a carga atual) */
  release(now: number) {
    if (this.zone !== 1 || !this.holding || this.charge === null) return;
    const hand = this.handOf(this.selfId) ?? { x: this.me.x, y: HAND_Y + 0.6, z: this.me.z };
    const from = { x: hand.x, y: hand.y + 0.5, z: hand.z };
    Object.assign(this.ball, from, basketShot(from, this.charge, this.me.ry));
    this.shotFrom = { x: this.me.x, y: 0, z: this.me.z };
    this.charge = null;
    this.held = null;
    this.take(now);
  }

  /** estado vindo da rede */
  remote(b: RemoteBall) {
    if (b.by === this.selfId) return;
    // quem tocou depois manda; empate: fica com quem já mandava
    if (b.t < this.touchT || (b.t === this.touchT && this.authority && this.authority !== b.by)) return;
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
      Object.assign(this.ball, a.ballStart, { vx: 0, vy: 0, vz: 0 });
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
    if (this.zone !== 3 || e.kind !== 'bounce' || !this.hitSide) return;
    // tênis: quem rebateu é `hitSide` (a joga em x < 0)
    const other = this.hitSide === 'a' ? 'b' : 'a';
    const sideOfBounce = e.x < 0 ? 'a' : 'b';
    const out = Math.abs(e.x) > COURT_HX || Math.abs(e.z) > COURT_HZ;
    let point: 'a' | 'b' | null = null;
    if (sideOfBounce === this.hitSide)
      point = other; // não passou da rede
    else if (out)
      point = this.bounces === 0 ? other : this.hitSide; // fora direto: erro; depois de quicar dentro: ponto
    else if (++this.bounces >= 2) point = this.hitSide; // quicou duas vezes do outro lado
    if (point) {
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
