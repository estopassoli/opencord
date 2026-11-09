/**
 * Bot do x1 no soco: chega perto, soca (rápido ou forte), defende e recua. O nível muda a reação, a mira (o fácil
 * erra o ângulo e o soco não pega), a frequência dos socos e o quanto ele defende. A luta e o dano são as regras do
 * contrato (`duelReaches`, `duelDamage`). Puro, sem three.js.
 */
import { DUEL_JAB_COOLDOWN_MS, DUEL_REACH, DUEL_STRONG_COOLDOWN_MS } from '@opencord/contracts';
import { BOT_SKILL, type BotLevel, type BotSkill } from './level';
import { between, faceTo, gauss, type Rng } from './rng';

export interface DuelView {
  /** relógio (ms) */
  now: number;
  bot: { x: number; z: number; ry: number };
  /** a pessoa; `a` = estado do boneco (6 soco rápido, 7 forte, 8 defendendo) */
  foe: { x: number; z: number; ry: number; a: number };
  hpBot: number;
  hpFoe: number;
  fighting: boolean;
}

export interface DuelCmd {
  to: { x: number; z: number } | null;
  face: number;
  block: boolean;
  punch: 'jab' | 'strong' | null;
}

export class DuelBrain {
  readonly skill: BotSkill;
  private lastJab = -Infinity;
  private lastStrong = -Infinity;
  private blockUntil = 0;
  private nextGuard = 0;
  private nextThink = 0;
  private aimErr = 0;
  private want = 1.1;
  private strafe = 1;
  private foeA = 0;
  /** quando levantar a guarda (0 = não vai) */
  private guardAt = 0;

  constructor(
    readonly level: BotLevel,
    private readonly rng: Rng,
  ) {
    this.skill = BOT_SKILL[level];
  }

  think(v: DuelView): DuelCmd {
    const s = this.skill;
    const { bot, foe, now } = v;
    const d = Math.hypot(foe.x - bot.x, foe.z - bot.z);
    // a pessoa começou um soco: depois da reação, o bot pode levantar a guarda
    // (uma decisão por soco visto: o esperto quase sempre levanta, o fácil quase nunca)
    if ((foe.a === 6 || foe.a === 7) && foe.a !== this.foeA && this.rng() < s.smart)
      this.guardAt = now + s.reaction * 400;
    this.foeA = foe.a;
    if (now >= this.nextThink) {
      this.nextThink = now + 120 + s.reaction * 300;
      this.aimErr = gauss(this.rng) * s.error * 0.9;
      // distância: encosta para socar; com pouca vida (ou o fácil, à toa) recua
      const losing = v.hpBot < v.hpFoe - 20;
      this.want = losing && this.rng() < 0.4 ? 2.4 : this.rng() < (1 - s.smart) * 0.3 ? 2.2 : 1.1;
      if (this.rng() < 0.2) this.strafe = -this.strafe;
      // colado na pessoa, de vez em quando levanta a guarda por antecipação
      if (d < DUEL_REACH + 0.3 && this.rng() < s.smart * 0.15) this.guardAt = now;
    }
    const face = faceTo(bot, foe) + this.aimErr;
    if (!v.fighting) return { to: null, face, block: false, punch: null };
    // guarda: levanta quando chega a hora (respeitando o descanso entre uma guarda e outra)
    if (this.guardAt && now >= this.guardAt && now >= this.nextGuard) {
      this.guardAt = 0;
      this.blockUntil = now + between(this.rng, 350, 800);
      this.nextGuard = this.blockUntil + 400 + s.reaction * 800;
    }
    const block = now < this.blockUntil;
    // anda: para a distância que quer, rodeando um pouco
    const ux = (bot.x - foe.x) / (d || 1);
    const uz = (bot.z - foe.z) / (d || 1);
    const to =
      Math.abs(d - this.want) > 0.25
        ? { x: foe.x + ux * this.want - uz * 0.3 * this.strafe, z: foe.z + uz * this.want + ux * 0.3 * this.strafe }
        : null;
    let punch: DuelCmd['punch'] = null;
    if (!block && d <= DUEL_REACH * 0.95) {
      const jabOk = now - this.lastJab >= DUEL_JAB_COOLDOWN_MS * (1.6 - s.smart * 0.5);
      const strongOk = now - this.lastStrong >= DUEL_STRONG_COOLDOWN_MS * 1.2;
      // forte quando a pessoa está sem guarda (o esperto aproveita)
      if (strongOk && foe.a !== 8 && this.rng() < 0.02 + s.smart * 0.05) {
        punch = 'strong';
        this.lastStrong = now;
      } else if (jabOk && this.rng() < 0.08 + s.smart * 0.12) {
        punch = 'jab';
        this.lastJab = now;
      }
    }
    return { to, face, block, punch };
  }
}
