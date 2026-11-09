/**
 * Eventos de jogo do Espaço 3D (ADR-0056): o que acabou de acontecer no mundo (chute, quique, choque, ponto, volta…),
 * emitido em **todos** os clientes como efeito local (som, partículas, faixa de ponto, tutorial). É separado da regra:
 * só quem tem a autoridade reporta o ponto ao servidor; o evento `score` aqui é só para efeito.
 * Sem three.js: o barramento é síncrono e as funções de física só empurram eventos numa lista.
 */

export interface At {
  x: number;
  y: number;
  z: number;
}

/** por que o ponto saiu (texto curto que o HUD mostra) */
export type ScoreReason = 'cesta' | 'gol' | 'caçapa' | 'fora' | 'rede' | 'dois quiques' | 'caiu' | 'não passou';

/** superfícies duras em que a bola bate (com a velocidade normal do choque) */
export type Surface = 'wall' | 'board' | 'rim' | 'post' | 'net';

interface Base {
  /** onde aconteceu (m, mundo) */
  at: At;
  /** intensidade, de 0 a 1 */
  power: number;
  /** zona do Espaço (0 sala, 1–7 jogos): efeito de outra zona não toca */
  zone: number;
}

export type GameEvent = Base &
  (
    | { kind: 'kick'; by: string }
    | { kind: 'hit'; by: string; with: 'racket' | 'hand' | 'hip' }
    | { kind: 'whiff'; by: string }
    | { kind: 'bounce'; surface: 'floor' | 'table'; v: number }
    | { kind: 'surface'; surface: Surface; v: number }
    | { kind: 'score'; side: 'a' | 'b'; points: number; by: string | null; reason: ScoreReason }
    | { kind: 'pocket'; ball: number }
    | { kind: 'ballHit'; a: number; b: number; v: number }
    | { kind: 'cushion'; ball: number; v: number }
    | { kind: 'cue'; by: string | null }
    | { kind: 'boost'; source: 'pad' | 'item' }
    | { kind: 'item' }
    | { kind: 'lap'; lap: number }
    | { kind: 'finalLap' }
    | { kind: 'finish'; ms: number }
    | { kind: 'punch'; by: string | null; strong: boolean; landed: boolean; blocked?: boolean }
    | { kind: 'ko'; who: string }
    | { kind: 'countdown'; n: number }
    | { kind: 'go' }
  );

export type GameEventKind = GameEvent['kind'];

/** velocidade → intensidade (0–1) com uma referência de "forte" */
export function power01(v: number, ref: number): number {
  if (!(ref > 0)) return 0;
  return Math.max(0, Math.min(1, Math.abs(v) / ref));
}

type Listener = (e: GameEvent) => void;

/** Barramento simples e síncrono. `on` devolve a função que desliga o ouvinte. */
export class GameBus {
  private readonly all = new Set<Listener>();
  private readonly byKind = new Map<GameEventKind, Set<Listener>>();

  on(fn: Listener): () => void;
  on<K extends GameEventKind>(kind: K, fn: (e: Extract<GameEvent, { kind: K }>) => void): () => void;
  on(a: Listener | GameEventKind, b?: Listener): () => void {
    if (typeof a === 'function') {
      this.all.add(a);
      return () => this.all.delete(a);
    }
    const fn = b!;
    let set = this.byKind.get(a);
    if (!set) {
      set = new Set();
      this.byKind.set(a, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(e: GameEvent) {
    // um ouvinte com erro não pode derrubar o laço do jogo nem calar os outros
    for (const fn of this.byKind.get(e.kind) ?? []) safe(fn, e);
    for (const fn of this.all) safe(fn, e);
  }

  clear() {
    this.all.clear();
    this.byKind.clear();
  }
}

function safe(fn: Listener, e: GameEvent) {
  try {
    fn(e);
  } catch (err) {
    console.error('[space3d] ouvinte de evento falhou', err);
  }
}
