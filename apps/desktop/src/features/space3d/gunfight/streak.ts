/**
 * Narrador do gunfight (2026-11-10): sequência de abates de quem joga aqui. Parte pura: diz que chamada cada abate
 * meu rende; o jogo emite o som (`streak` → `sfxmap.ts`: a voz do narrador, por enquanto um toque sintetizado até as
 * gravações entrarem no banco de `sfxbank.ts`) e a faixa da tela.
 *
 * - Abates em sequência: cada um até `MULTI_MS` depois do anterior soma; 2 = double, 3 = triple, 4 = quadra,
 *   5 = penta e, do sexto em diante, "amazing". Morrer zera a sequência.
 * - "First kill": o primeiro abate da partida (de qualquer pessoa) foi meu.
 * - "Headshot": abate na cabeça que não rendeu nada acima.
 * Só uma chamada por abate: a sequência vale mais que o primeiro abate, que vale mais que o tiro na cabeça.
 */

export type StreakCall = 'headshot' | 'firstKill' | 'double' | 'triple' | 'quadra' | 'penta' | 'amazing';

/** janela entre um abate e o próximo da sequência (ms) */
export const MULTI_MS = 4500;

/** o texto da faixa de cada chamada */
export const STREAK_LABEL: Record<StreakCall, string> = {
  headshot: 'Headshot',
  firstKill: 'First kill',
  double: 'Double kill',
  triple: 'Triple kill',
  quadra: 'Quadra kill',
  penta: 'Penta kill',
  amazing: 'Amazing',
};

const MULTI: StreakCall[] = ['double', 'triple', 'quadra', 'penta'];

export class KillStreak {
  /** abates da sequência atual */
  chain = 0;
  private lastAt = -Infinity;
  /** já houve abate nesta partida (de qualquer pessoa) */
  private anyKill = false;

  /** partida nova: ninguém abateu ainda e a sequência zera */
  reset() {
    this.chain = 0;
    this.lastAt = -Infinity;
    this.anyKill = false;
  }

  /** eu morri */
  died() {
    this.chain = 0;
    this.lastAt = -Infinity;
  }

  /** alguém (não eu) abateu alguém: o primeiro abate da partida já foi */
  otherKill() {
    this.anyKill = true;
  }

  /** eu abati alguém agora (`now` em ms): a chamada que isso rende, ou nada */
  kill(now: number, head: boolean): StreakCall | null {
    this.chain = now - this.lastAt <= MULTI_MS ? this.chain + 1 : 1;
    this.lastAt = now;
    const first = !this.anyKill;
    this.anyKill = true;
    if (this.chain >= 2) return MULTI[this.chain - 2] ?? 'amazing';
    if (first) return 'firstKill';
    return head ? 'headshot' : null;
  }
}
