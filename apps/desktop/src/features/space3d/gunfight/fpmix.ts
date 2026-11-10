/**
 * Quem manda em cada clipe feito à mão da primeira pessoa (ADR-0061), sem three.js: pesos e tempos de cada camada por
 * quadro. Puro (testado em Node).
 *
 * - Laços de base: parado (respirando), mirando, correndo e corrida tática. Os pesos somam 1 e seguem as entradas
 *   (que já vêm suavizadas pelo viewmodel); o tempo da corrida segue a fase do passo (o balanço casa com os passos).
 * - Um clipe de uma vez por cima (sacar, guardar, recarregar, inspecionar, golpe): entra em `FADE_IN`, sai nos últimos
 *   `FADE_OUT` (o fim dele é a pose parada, então sair cedo não pula), e a base fica com o resto do peso. O tempo dele é
 *   esticado para a duração do jogo (a recarga dura o `reloadMs` da arma montada; a animação acompanha).
 * - O tiro é uma camada que soma (aditiva) e recomeça a cada tiro; mirando, pesa menos (a mira não sai do lugar).
 * - O indicador vai ao gatilho no tiro (rápido) e volta para a armação um tempo depois do último tiro (devagar).
 */

export type FpOneShot = 'draw' | 'holster' | 'reload' | 'reloadEmpty' | 'inspect' | 'melee';
export type FpLoop = 'idle' | 'ads' | 'sprint' | 'tac';

export interface FpInput {
  /** 0–1 */
  ads: number;
  sprint: number;
  tac: number;
  /** fase do passo (rad, cresce sem parar) */
  stride: number;
}

export interface FpLayers {
  loops: Record<FpLoop, { w: number; t: number }>;
  one: { kind: FpOneShot; w: number; t: number } | null;
  fire: { w: number; t: number } | null;
  /** o indicador no gatilho (0 na armação, 1 no gatilho) */
  trigger: number;
}

export const FADE_IN = 0.12;
export const FADE_OUT = 0.15;
/** quanto tempo o indicador fica no gatilho depois do último tiro (s) e quanto leva para ir e voltar */
export const TRIGGER_HOLD = 0.35;
const TRIGGER_IN = 0.05;
const TRIGGER_OUT = 0.16;

const smooth = (u: number) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

export class FpMixer {
  /** duração de cada clipe como foi escrito (s) */
  constructor(private readonly lens: Readonly<Record<string, number>>) {}
  private one: { kind: FpOneShot; t: number; dur: number } | null = null;
  private fireT = -1;
  private sinceFire = 1e9;
  private trig = 0;
  private idleT = 0;
  private adsT = 0;

  /** começa um clipe de uma vez com a duração do jogo (`ms`); corta o que estava tocando */
  play(kind: FpOneShot, ms: number) {
    this.one = { kind, t: 0, dur: Math.max(0.05, ms / 1000) };
  }

  /** um tiro: a camada do tiro recomeça e o indicador vai ao gatilho; corta inspeção e golpe */
  fire() {
    this.fireT = 0;
    this.sinceFire = 0;
    if (this.one && (this.one.kind === 'inspect' || this.one.kind === 'draw')) this.stop();
  }

  /** sai do clipe de uma vez agora (com a mesma saída suave do fim) */
  stop() {
    if (!this.one) return;
    const left = this.one.dur - this.one.t;
    if (left > FADE_OUT) this.one.t = this.one.dur - FADE_OUT;
  }

  get busy(): FpOneShot | null {
    return this.one?.kind ?? null;
  }

  step(dt: number, inp: FpInput, out: FpLayers = blankLayers()): FpLayers {
    const L = this.lens;
    this.idleT = (this.idleT + dt) % (L.idle ?? 1);
    this.adsT = (this.adsT + dt) % (L.ads ?? 1);
    // base: corrida tática > corrida > mira > parado
    const tac = clamp01(inp.tac);
    const sprint = clamp01(inp.sprint) * (1 - tac);
    const rest = 1 - tac - sprint;
    const ads = clamp01(inp.ads) * rest;
    const idle = rest - ads;
    const phase = (((inp.stride / (Math.PI * 2)) % 1) + 1) % 1;
    let oneW = 0;
    if (this.one) {
      this.one.t += dt;
      const o = this.one;
      if (o.t >= o.dur) {
        this.one = null;
      } else {
        oneW = smooth(o.t / FADE_IN) * (1 - smooth((o.t - (o.dur - FADE_OUT)) / FADE_OUT));
        out.one = { kind: o.kind, w: oneW, t: (o.t / o.dur) * (L[o.kind] ?? o.dur) };
      }
    }
    if (!this.one) out.one = null;
    const keep = 1 - oneW;
    out.loops.idle.w = idle * keep;
    out.loops.idle.t = this.idleT;
    out.loops.ads.w = ads * keep;
    out.loops.ads.t = this.adsT;
    out.loops.sprint.w = sprint * keep;
    out.loops.sprint.t = phase * (L.sprint ?? 1);
    out.loops.tac.w = tac * keep;
    out.loops.tac.t = phase * (L.tac ?? 1);
    // tiro (soma por cima)
    const fl = L.fire ?? 0.2;
    if (this.fireT >= 0) {
      this.fireT += dt;
      if (this.fireT >= fl) this.fireT = -1;
    }
    out.fire = this.fireT >= 0 ? { w: 1 - 0.6 * clamp01(inp.ads), t: this.fireT } : null;
    // indicador
    this.sinceFire += dt;
    const want = this.sinceFire < TRIGGER_HOLD ? 1 : 0;
    const rate = want > this.trig ? TRIGGER_IN : TRIGGER_OUT;
    this.trig += (want - this.trig) * Math.min(1, dt / rate);
    out.trigger = this.trig;
    return out;
  }
}

export function blankLayers(): FpLayers {
  return {
    loops: { idle: { w: 1, t: 0 }, ads: { w: 0, t: 0 }, sprint: { w: 0, t: 0 }, tac: { w: 0, t: 0 } },
    one: null,
    fire: null,
    trigger: 0,
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
