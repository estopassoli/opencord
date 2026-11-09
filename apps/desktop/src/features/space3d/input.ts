/**
 * Entrada do Espaço 3D (ADR-0056): nada fica "segurado" quando a pessoa sai do jogo sem soltar o botão (Esc, outra
 * janela, aba escondida). Sem isso a carga do arremesso ou da tacada continua subindo e a barra fica cheia.
 */
import type { Action } from './bindings';

/** jogo que tem algo carregando (arremesso, tacada) */
export interface Cancelable {
  /** esquece a carga e o que estiver segurado, sem disparar nada */
  cancel(): void;
}

/** solta tudo: teclas presas e a carga do jogo ativo (sem arremessar nem tacar) */
export function cancelHeld(keys: Set<string>, games: readonly (Cancelable | null | undefined)[]): void {
  keys.clear();
  for (const g of games) g?.cancel();
}

// ---------- entrada para o tutorial (plano 2026-11-09, P4) ----------

/**
 * O que a pessoa acabou de fazer com os controles (não é efeito de jogo: não toca som nem mexe no placar). O tutorial
 * e as dicas olham isto junto com os `GameEvent` para saber quando a pessoa já fez a ação do passo.
 */
export type InputEvent =
  /** apertou o atalho de uma ação (as setas contam como andar) */
  | { kind: 'press'; action: Action }
  /** basquete: a bola veio para a minha mão */
  | { kind: 'grab' }
  /** a carga do arremesso ou da tacada passou de 30% */
  | { kind: 'charge'; c: number }
  /** basquete: soltou o arremesso; `good` = dentro da faixa verde */
  | { kind: 'shot'; good: boolean }
  /** girou a câmera um bom pedaço (mouse ou Q/E): na sinuca é mirar */
  | { kind: 'look' }
  /** a ação ficou possível agora (o aviso com a tecla apareceu): a bola está ao alcance */
  | { kind: 'ready'; action: 'interact' | 'primary' };

type InputListener = (e: InputEvent) => void;

/** barramento síncrono da entrada; `on` devolve a função que desliga */
export class InputBus {
  private readonly fns = new Set<InputListener>();
  on(fn: InputListener): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(e: InputEvent) {
    for (const fn of this.fns) {
      try {
        fn(e);
      } catch (err) {
        console.error('[space3d] ouvinte de entrada falhou', err);
      }
    }
  }
  clear() {
    this.fns.clear();
  }
}
