/**
 * Bot da corrida de moto: olha um ponto da pista à frente (mais longe quanto mais rápido), vira para ele e acelera ou
 * alivia conforme a curva que vem. O nível muda a velocidade máxima, o quanto ele freia antes da curva (o fácil quase
 * não freia e sai da pista), a linha (o fácil "passeia" de um lado para o outro), a demora para corrigir e o uso do
 * turbo (o difícil guarda para a reta). Puro, sem three.js (a moto é a de `race.ts`).
 */
import { TRACK, type Bike, type RaceInput } from '../race';
import { BOT_SKILL, type BotLevel, type BotSkill } from './level';
import { gauss, wrap, type Rng } from './rng';

const N = TRACK.pts.length;
const MAX_V = 21;
/** o quanto a moto vira por segundo em alta (rad/s, de `stepBike`: 1,9 × aderência ~0,8) */
const TURN_RATE = 1.5;

/** quanto a pista vira (rad) entre o ponto `i` e `ahead` pontos à frente */
export function bendAhead(i: number, ahead: number): number {
  const a = TRACK.dirs[((i % N) + N) % N]!;
  const b = TRACK.dirs[(((i + ahead) % N) + N) % N]!;
  return Math.abs(wrap(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z)));
}

export class RaceBrain {
  readonly skill: BotSkill;
  /** a direção que o bot "vê" (atualizada só de tempos em tempos: reação) */
  private seenErr = 0;
  private nextLook = 0;
  private wobble: number;
  private boostAt = 0;

  constructor(
    readonly level: BotLevel,
    private readonly rng: Rng,
  ) {
    this.skill = BOT_SKILL[level];
    this.wobble = rng() * Math.PI * 2;
  }

  /** os comandos da moto agora (`now` em ms) e se usa o turbo guardado */
  drive(b: Bike, now: number): { input: RaceInput; boost: boolean } {
    const s = this.skill;
    const v = Math.abs(b.v);
    const look = Math.round(5 + v * 0.45);
    const i = (b.idx + look) % N;
    const p = TRACK.pts[i]!;
    const d = TRACK.dirs[i]!;
    // linha: o fácil vai de um lado para o outro (até ~3 m), o difícil vai quase no meio
    const off = Math.sin(now / 1300 + this.wobble) * s.error * 5.5;
    const tx = p.x - d.z * off;
    const tz = p.z + d.x * off;
    const err = wrap(Math.atan2(tx - b.x, tz - b.z) - b.h);
    if (now >= this.nextLook) {
      this.seenErr = err + gauss(this.rng) * s.error * 0.08;
      this.nextLook = now + 40 + s.reaction * 260;
    }
    const e = this.seenErr;
    // velocidade: o máximo do nível, menos na curva que a moto não faz nessa velocidade (o esperto freia antes; o
    // fácil entra rápido demais e sai da pista)
    const span = 18 + Math.round(v * 0.6);
    const bend = bendAhead(b.idx, span);
    const curveV = TURN_RATE / Math.max(1e-3, bend / span);
    const want = Math.min(MAX_V * s.speed, curveV * (1 + (1 - s.smart) * 1.5));
    const dead = 0.04 + s.error * 0.1;
    const input: RaceInput = {
      up: v < want,
      down: v > want + 3 + (1 - s.smart) * 6,
      left: e > dead,
      right: e < -dead,
    };
    // turbo: o esperto espera uma reta; o outro usa quando der
    let boost = false;
    if (b.item && now >= this.boostAt) {
      this.boostAt = now + 600;
      boost = bend < 0.12 ? this.rng() < 0.4 + s.smart * 0.6 : this.rng() < (1 - s.smart) * 0.3;
    }
    return { input, boost };
  }
}
