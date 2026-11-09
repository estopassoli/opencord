/**
 * Bot dos esportes com bola (basquete, futebol, tênis, vôlei e ping pong): a cada quadro olha a bola, o rival e a
 * fase e devolve para onde andar, para onde olhar e o que apertar — os mesmos comandos de uma pessoa, que a cena passa
 * para o `SportPlay` como se fosse um segundo jogador local. O nível (`BOT_SKILL`) muda a reação, o erro de mira, de
 * força e de tempo e a escolha da jogada. Puro (sem three.js) e com sorteio por semente: dá para testar.
 */
import type { MatchPhase } from '@opencord/contracts';
import { attackHoop, netSideOf, type Team } from '../rules';
import { ARENAS, contactDt, GOAL_HALF_W, GOAL_X, HOOP_X, landingPoint, type BallState } from '../sports';
import { BOT_SKILL, type BotLevel, type BotSkill } from './level';
import { between, faceTo, gauss, type Rng } from './rng';

export interface BotBody {
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface SportView {
  zone: 1 | 2 | 3 | 4 | 5;
  /** relógio (s) */
  t: number;
  ball: BallState;
  /** bola parada esperando o saque */
  parked: boolean;
  /** quem está com a bola */
  holder: 'bot' | 'foe' | null;
  /** há quanto tempo (s) quem está com a bola está com ela (o roubo só vale depois de 1 s) */
  heldFor: number;
  bot: BotBody;
  team: Team;
  /** a pessoa (o rival) */
  foe: { x: number; z: number; ry: number } | null;
  phase: MatchPhase | null;
  /** basquete: carga do arremesso do bot (null = sem carregar) e a faixa verde dele */
  charge: number | null;
  band: { lo: number; hi: number } | null;
}

/** o que o bot quer fazer neste quadro (como as teclas de uma pessoa) */
export interface BotCmd {
  /** para onde andar (null = fica) */
  to: { x: number; z: number } | null;
  run: boolean;
  /** para onde olhar (e mirar); null = para onde anda */
  face: number | null;
  press?: boolean;
  release?: boolean;
  interact?: boolean;
  jump?: boolean;
  secondary?: boolean;
}

/** jogos de rede: onde o bot espera a bola (distância da rede, m) */
const HOME: Record<3 | 4 | 5, number> = { 3: 9.5, 4: 5, 5: 2.1 };
/** quanto o olhar puxa a rebatida para o lado (igual ao `NET_TUNE.pull` do sportplay) */
const PULL: Record<3 | 4 | 5, number> = { 3: 6, 4: 4, 5: 0.8 };
/** erro do lugar da batida (m, multiplicado pelo erro do nível) */
const POS_ERR: Record<3 | 4 | 5, number> = { 3: 1.7, 4: 1.1, 5: 0.25 };
/** erro de tempo da rebatida (s, multiplicado pelo erro do nível): a janela perfeita é ~0,11–0,16 s */
const TIMING_ERR: Record<3 | 4 | 5, number> = { 3: 0.26, 4: 0.3, 5: 0.22 };
/** fração da reação que vale nos jogos de rede (a bola chega rápido) */
const NET_REACT = 0.55;
const G = 9.8;

const norm = (x: number, z: number) => {
  const d = Math.hypot(x, z) || 1;
  return { x: x / d, z: z / d };
};

export class SportBrain {
  readonly skill: BotSkill;
  // jogos de rede
  private coming = false;
  private plan: { x: number; z: number } | null = null;
  private planAt = 0;
  private timing = 0;
  private swung = false;
  private aimZ = 0;
  private serveAt = 0;
  // basquete
  private spot: { x: number; z: number } | null = null;
  private spotUntil = 0;
  private shotAt: number | null = null;
  private nextSteal = 0;
  // futebol
  private possession = false;
  private shootD = 12;
  private nextTackle = 0;
  private nextTrick = 0;
  // reação a quem pegou a bola (basquete e futebol)
  private lastHolder: SportView['holder'] = null;
  private wake = 0;
  private lastTo: { x: number; z: number } | null = null;

  constructor(
    readonly level: BotLevel,
    private readonly rng: Rng,
  ) {
    this.skill = BOT_SKILL[level];
  }

  think(v: SportView): BotCmd {
    if (v.phase === 'ended') return { to: null, run: false, face: null };
    if (v.zone === 1 || v.zone === 2) {
      // a posse mudou: o bot demora a reagir (fácil demora mais)
      if (v.holder !== this.lastHolder) {
        this.lastHolder = v.holder;
        this.wake = v.t + this.skill.reaction * 0.6;
      }
      if (v.t < this.wake && v.phase !== 'countdown') return { to: this.lastTo, run: true, face: null };
      const cmd = v.zone === 1 ? this.basket(v) : this.foot(v);
      this.lastTo = cmd.to;
      return cmd;
    }
    return this.net(v);
  }

  // ---------------------------------------------------------------- basquete
  private basket(v: SportView): BotCmd {
    const atk = attackHoop(v.team);
    const hoop = { x: atk * HOOP_X, z: 0 };
    const ownHoop = { x: -atk * HOOP_X, z: 0 };
    const b = v.ball;
    const bot = v.bot;
    if (v.phase === 'countdown') return { to: { x: -atk * 3, z: 0 }, run: false, face: faceTo(bot, b) };
    if (v.holder === 'bot') {
      if (v.charge !== null)
        return { to: null, run: false, face: faceTo(bot, hoop), release: v.charge >= (this.shotAt ?? 0.675) };
      if (!this.spot) {
        // de onde arremessar: perto no fácil; o difícil às vezes vai de três
        const three = this.rng() < this.skill.smart * 0.25;
        const d = three ? between(this.rng, 6.9, 7.5) : between(this.rng, 2.4, 5.5);
        const a = between(this.rng, -1.1, 1.1);
        this.spot = { x: hoop.x - atk * Math.cos(a) * d, z: Math.sin(a) * d };
        this.spotUntil = v.t + 5;
      }
      if (Math.hypot(this.spot.x - bot.x, this.spot.z - bot.z) < 0.5 || v.t > this.spotUntil) {
        const c = v.band ? (v.band.lo + v.band.hi) / 2 : 0.675;
        this.shotAt = Math.max(0.05, Math.min(1, c + gauss(this.rng) * this.skill.error * 0.3));
        this.spot = null;
        return { to: null, run: false, face: faceTo(bot, hoop), press: true };
      }
      return { to: this.spot, run: true, face: null };
    }
    this.spot = null;
    this.shotAt = null;
    if (v.holder === 'foe' && v.foe) {
      // marca entre a pessoa e a própria cesta, de frente para ela; tenta roubar de vez em quando
      const f = v.foe;
      const dir = norm(ownHoop.x - f.x, ownHoop.z - f.z);
      const cmd: BotCmd = { to: { x: f.x + dir.x * 0.9, z: f.z + dir.z * 0.9 }, run: true, face: faceTo(bot, f) };
      if (Math.hypot(f.x - bot.x, f.z - bot.z) < 1.3 && v.heldFor > 1 && v.t >= this.nextSteal) {
        this.nextSteal = v.t + 0.5 + this.skill.reaction * 1.5;
        if (this.rng() < 0.25 + 0.6 * this.skill.smart) cmd.press = true;
      }
      return cmd;
    }
    // bola solta (ou o rebote): vai até ela e pega
    const flat = Math.hypot(b.x - bot.x, b.z - bot.z);
    const lead = Math.min(0.5, flat / 8);
    const cmd: BotCmd = { to: { x: b.x + b.vx * lead, z: b.z + b.vz * lead }, run: true, face: null };
    if (b.y < 2 && flat < 0.9) cmd.press = true;
    return cmd;
  }

  // ---------------------------------------------------------------- futebol
  private foot(v: SportView): BotCmd {
    const atk = attackHoop(v.team);
    const goal = { x: atk * GOAL_X, z: 0 };
    const own = { x: -atk * GOAL_X, z: 0 };
    const b = v.ball;
    const bot = v.bot;
    const s = this.skill;
    if (v.phase === 'countdown') return { to: { x: -atk * 5, z: 0 }, run: false, face: faceTo(bot, b) };
    if (v.holder === 'bot') {
      if (!this.possession) {
        this.possession = true;
        this.aimZ = between(this.rng, -1, 1) * GOAL_HALF_W * 0.65;
        this.shootD = 9 + s.smart * 5 + this.rng() * 3;
      }
      const target = { x: goal.x, z: this.aimZ };
      const dG = Math.hypot(target.x - bot.x, target.z - bot.z);
      const toGoal = norm(target.x - bot.x, target.z - bot.z);
      const cmd: BotCmd = { to: null, run: true, face: faceTo(bot, target) + gauss(this.rng) * s.error * 0.2 };
      const f = v.foe;
      const fd = f ? Math.hypot(f.x - bot.x, f.z - bot.z) : Infinity;
      const ahead = !!f && (f.x - bot.x) * toGoal.x + (f.z - bot.z) * toGoal.z > 0;
      // drible: rival colado na frente (o difícil faz mais)
      if (f && fd < 2.2 && ahead && v.t >= this.nextTrick) {
        this.nextTrick = v.t + 2.5;
        if (this.rng() < s.smart * 0.55) {
          if (this.rng() < 0.5) cmd.interact = true;
          else cmd.jump = true;
          cmd.to = { x: bot.x + toGoal.x * 2, z: bot.z + toGoal.z * 2 };
          return cmd;
        }
      }
      if (dG < this.shootD) {
        // perto do gol o difícil às vezes coloca (passe no canto) em vez de bater forte
        if (dG < 7 && this.rng() < s.smart * 0.35) cmd.secondary = true;
        else cmd.press = true;
        this.possession = false;
        return cmd;
      }
      // conduz para o gol, desviando de quem está na frente
      const to = { x: goal.x - atk * 2, z: this.aimZ * 0.5 };
      if (f && ahead && fd < 4) to.z = bot.z + (bot.z >= f.z ? 1 : -1) * 3;
      cmd.to = to;
      cmd.face = null;
      return cmd;
    }
    this.possession = false;
    if (v.holder === 'foe' && v.foe) {
      const f = v.foe;
      const fd = Math.hypot(f.x - bot.x, f.z - bot.z);
      const dir = norm(own.x - f.x, own.z - f.z);
      // de frente = do lado para onde a pessoa olha
      const inFront = (bot.x - f.x) * Math.sin(f.ry) + (bot.z - f.z) * Math.cos(f.ry) > 0;
      const cmd: BotCmd = { to: { x: f.x + dir.x * 0.7, z: f.z + dir.z * 0.7 }, run: true, face: faceTo(bot, b) };
      if (v.t >= this.nextTackle) {
        if (fd < 1.3 && inFront) {
          cmd.interact = true;
          this.nextTackle = v.t + 0.6 + s.reaction;
        } else if (fd < 2.4 && this.rng() < (inFront ? 0.3 : (1 - s.smart) * 0.6)) {
          // carrinho: o fácil vai até por trás (falta)
          cmd.secondary = true;
          cmd.to = null;
          this.nextTackle = v.t + 1.6 + s.reaction;
        } else this.nextTackle = v.t + 0.15 + s.reaction * 0.3;
      }
      return cmd;
    }
    // bola solta: chega por trás dela (entre a bola e o próprio gol) para dominar já virado para o ataque
    const toGoal = norm(goal.x - b.x, goal.z - b.z);
    const flat = Math.hypot(b.x - bot.x, b.z - bot.z);
    const cmd: BotCmd = {
      to:
        flat > 2.5
          ? { x: b.x + b.vx * 0.3, z: b.z + b.vz * 0.3 }
          : { x: b.x - toGoal.x * 0.4, z: b.z - toGoal.z * 0.4 },
      run: true,
      face: null,
    };
    if (b.y > 1.1 && b.y < 2.5 && flat < 1.4 && this.rng() < s.smart * 0.1) {
      cmd.press = true;
      cmd.face = faceTo(bot, goal);
    }
    return cmd;
  }

  // ---------------------------------------------------------------- tênis, vôlei e ping pong
  private net(v: SportView): BotCmd {
    const z = v.zone as 3 | 4 | 5;
    const a = ARENAS[z];
    const side = netSideOf(v.team);
    const home = { x: side * HOME[z], z: 0 };
    const b = v.ball;
    const reach = a.reach ?? 2;
    const me = { x: v.bot.x, y: v.bot.y, z: v.bot.z };
    const d = Math.hypot(b.x - me.x, b.y - (me.y + 1), b.z - me.z);
    const face = this.netFace(v, side);
    if (v.parked) {
      this.plan = null;
      this.swung = false;
      this.coming = false;
      if (Math.sign(b.x) !== side) {
        this.serveAt = 0;
        return { to: home, run: false, face };
      }
      // meu saque: um passo atrás da bola, espera um pouco e saca
      if (!this.serveAt) {
        this.serveAt = v.t + 0.8 + this.skill.reaction;
        this.aimZ = this.pickAim(v);
      }
      const cmd: BotCmd = { to: { x: b.x + side * 0.45, z: b.z }, run: false, face };
      if (v.phase !== 'countdown' && v.t >= this.serveAt && d < reach * 0.9) {
        cmd.press = true;
        this.serveAt = 0;
      }
      return cmd;
    }
    this.serveAt = 0;
    const coming = b.vx * side > 0.2;
    if (coming !== this.coming) {
      this.coming = coming;
      if (coming) {
        // alguém rebateu para o meu lado: depois da reação, decide onde bater (com erro) e o tempo da batida
        this.planAt = v.t + this.skill.reaction * NET_REACT;
        this.plan = null;
        this.swung = false;
        this.timing = gauss(this.rng) * this.skill.error * TIMING_ERR[z];
        this.aimZ = this.pickAim(v);
      }
    }
    if (!coming) return { to: home, run: false, face };
    if (!this.plan && v.t >= this.planAt) this.plan = contactSpot(z, b, side, this.skill.error, this.rng);
    const cmd: BotCmd = { to: this.plan, run: true, face };
    if (!this.swung && d < reach && contactDt(z, b, me) <= this.timing) {
      cmd.press = true;
      this.swung = true;
    }
    return cmd;
  }

  /** para onde mandar a bola (z do outro lado): o esperto manda longe do rival */
  private pickAim(v: SportView): number {
    const c = ARENAS[v.zone].court!;
    if (v.foe && this.rng() < this.skill.smart) {
      const away = -(Math.sign(v.foe.z) || (this.rng() < 0.5 ? 1 : -1));
      return away * c.hz * between(this.rng, 0.4, 0.8);
    }
    return between(this.rng, -0.7, 0.7) * c.hz;
  }

  /** o olhar que faz a rebatida ir para `aimZ` (a rebatida vai para z = eu.z + cos(ry)·pull) */
  private netFace(v: SportView, side: 1 | -1): number {
    const c = Math.max(-0.95, Math.min(0.95, (this.aimZ - v.bot.z) / PULL[v.zone as 3 | 4 | 5]));
    return Math.atan2(-side * Math.sqrt(1 - c * c), c);
  }
}

/**
 * Onde ficar para bater na bola que vem (puro): tênis, um pouco depois do quique; vôlei, onde ela desce até a altura
 * do peito; ping pong, atrás da mesa na linha da bola. Com o erro do nível (m) e sempre na minha metade.
 */
export function contactSpot(
  zone: 3 | 4 | 5,
  b: BallState,
  side: 1 | -1,
  error: number,
  rng: Rng,
): { x: number; z: number } {
  const a = ARENAS[zone];
  const lp = landingPoint(a, b);
  let p: { x: number; z: number };
  if (zone === 4) {
    const h = b.y - 1.2;
    const t = h > 0 ? (b.vy + Math.sqrt(b.vy * b.vy + 2 * G * h)) / G : 0;
    p = { x: b.x + b.vx * t, z: b.z + b.vz * t };
  } else if (zone === 5) {
    const tb = a.table!;
    const x = side * (tb.hx + 0.35);
    const from = lp ?? { x: b.x, z: b.z };
    const k = Math.abs(b.vx) > 0.05 ? (x - from.x) / b.vx : 0;
    p = { x, z: from.z + b.vz * k };
  } else {
    const from = lp ?? { x: b.x, z: b.z };
    p = { x: from.x + b.vx * 0.4, z: from.z + b.vz * 0.4 };
  }
  p.x += gauss(rng) * error * POS_ERR[zone];
  p.z += gauss(rng) * error * POS_ERR[zone];
  const hx = a.layout.width / 2 - 0.6;
  const hz = a.layout.depth / 2 - 0.6;
  const minX = zone === 5 ? a.table!.hx + 0.3 : 0.8;
  p.x = side * Math.max(minX, Math.min(hx, p.x * side));
  p.z = Math.max(-hz, Math.min(hz, p.z));
  return p;
}
