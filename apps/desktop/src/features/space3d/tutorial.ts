/**
 * Primeira vez em cada jogo (plano 2026-11-09, P4): tutorial jogável, em dados puros. Cada jogo tem o objetivo em uma
 * frase e de 2 a 4 passos; cada passo mostra a tecla escolhida (`<Binding action>`), marca um alvo no mundo e **só some
 * quando a pessoa faz a ação** (um `GameEvent` do ADR-0056 ou uma entrada de `input.ts`), nunca por tempo. Fazer um
 * passo mais adiante conta os de antes (quem já sabe não precisa repetir). Depois do tutorial, dicas no momento certo,
 * uma por vez, no máximo `HINT_MAX` vezes cada. O progresso fica neste computador (`opencord.space3d.learned`).
 */
import type { Action } from './bindings';
import type { GameEvent } from './events';
import type { InputEvent } from './input';

/** o jogo do tutorial: a zona (0 sala, 1–7) ou o x1 */
export type TutorialKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | 'duel';
export const TUTORIAL_KEYS: readonly TutorialKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', 'duel'];

/** o que o marcador do mundo aponta (anel e seta na cena) */
export type TutorialTarget = 'bola' | 'cesta' | 'gol' | 'rede' | 'branca' | 'checkpoint';

/** o que o tutorial escuta: efeito de jogo ou entrada */
export type TutorialInput = GameEvent | InputEvent;

/** quem eu sou agora (para saber se o chute ou o ponto foi meu) */
export interface TutorialCtx {
  me: string;
  team: 'a' | 'b';
}

export interface TutorialStep {
  /** o que fazer, curto e no imperativo */
  text: string;
  /** o atalho que o passo mostra (sai do mapa de atalhos: trocar o atalho troca a tecla) */
  action: Action;
  /** outros atalhos do mesmo passo (virar: esquerda e direita) */
  also?: Action[];
  /** "segure" junto da tecla */
  hold?: boolean;
  /** mostra também o mouse mexendo (mirar, olhar) */
  mouse?: boolean;
  /** o que o marcador do mundo aponta neste passo */
  alvo?: TutorialTarget;
  /** a pessoa fez a ação do passo */
  conclui(e: TutorialInput, ctx: TutorialCtx): boolean;
}

export interface TutorialHint {
  id: string;
  text: string;
  action: Action;
  also?: Action[];
  hold?: boolean;
  mouse?: boolean;
  /** o momento da dica (o evento que mostra que a pessoa precisa dela) */
  quando(e: TutorialInput, ctx: TutorialCtx): boolean;
  /** quantas vezes `quando` precisa acontecer antes de mostrar (padrão 1) */
  vezes?: number;
  /** a pessoa fez o que a dica pede: a dica some */
  feito(e: TutorialInput, ctx: TutorialCtx): boolean;
}

export interface Tutorial {
  key: TutorialKey;
  title: string;
  /** o objetivo do jogo em uma frase */
  objective: string;
  steps: TutorialStep[];
  hints: TutorialHint[];
}

/** cada dica aparece no máximo esta quantidade de vezes (somando todas as visitas) */
export const HINT_MAX = 2;

// ---------- predicados ----------
const MOVE: Action[] = ['forward', 'back', 'left', 'right'];
const pressed =
  (...acts: Action[]) =>
  (e: TutorialInput) =>
    e.kind === 'press' && acts.includes(e.action);
const mine = (e: TutorialInput, ctx: TutorialCtx) => 'by' in e && e.by === ctx.me;
const ourPoint = (e: TutorialInput, ctx: TutorialCtx) => e.kind === 'score' && e.side === ctx.team;

function netGame(key: '3' | '4' | '5', title: string, objective: string, hitText: string): Tutorial {
  return {
    key,
    title,
    objective,
    steps: [
      { text: 'Vá até a bola', action: 'forward', alvo: 'bola', conclui: (e) => e.kind === 'ready' },
      {
        text: hitText,
        action: 'primary',
        alvo: 'bola',
        conclui: (e, c) => e.kind === 'hit' && mine(e, c),
      },
      {
        text: 'Faça um ponto: a bola tem que cair do outro lado',
        action: 'primary',
        alvo: 'rede',
        conclui: ourPoint,
      },
    ],
    hints: [
      {
        id: `net-timing-${key}`,
        text: 'Aperte quando a bola estiver perto do boneco',
        action: 'primary',
        vezes: 2,
        quando: (e, c) => e.kind === 'whiff' && mine(e, c),
        feito: (e, c) => e.kind === 'hit' && mine(e, c),
      },
      {
        id: `net-aim-${key}`,
        text: 'Olhe para um lado antes de bater: a bola vai para lá',
        action: 'turnLeft',
        also: ['turnRight'],
        mouse: true,
        vezes: 4,
        quando: (e, c) => e.kind === 'hit' && mine(e, c),
        feito: (e) => e.kind === 'look',
      },
    ],
  };
}

export const TUTORIALS: Record<TutorialKey, Tutorial> = {
  '0': {
    key: '0',
    title: 'Sala',
    objective: 'Ande pela sala, converse com quem está perto e chame alguém para um x1.',
    steps: [
      { text: 'Ande', action: 'forward', also: ['left', 'back', 'right'], conclui: pressed(...MOVE) },
      { text: 'Corra', action: 'run', hold: true, conclui: pressed('run') },
      { text: 'Pule', action: 'jump', conclui: pressed('jump') },
    ],
    hints: [],
  },
  '1': {
    key: '1',
    title: 'Basquete',
    objective: 'Faça a bola passar pela cesta do outro time.',
    steps: [
      { text: 'Chegue na bola e pegue', action: 'interact', alvo: 'bola', conclui: (e) => e.kind === 'grab' },
      {
        text: 'Segure para carregar o arremesso',
        action: 'primary',
        hold: true,
        alvo: 'cesta',
        conclui: (e) => e.kind === 'charge',
      },
      {
        text: 'Solte com a barra na faixa verde',
        action: 'primary',
        alvo: 'cesta',
        conclui: (e, c) => e.kind === 'shot' || (e.kind === 'hit' && e.with === 'hand' && mine(e, c)),
      },
      { text: 'Faça uma cesta', action: 'primary', hold: true, alvo: 'cesta', conclui: ourPoint },
    ],
    hints: [
      {
        id: 'bb-band',
        text: 'Solte quando a barra estiver na faixa verde',
        action: 'primary',
        hold: true,
        vezes: 2,
        quando: (e) => e.kind === 'shot' && !e.good,
        feito: (e) => e.kind === 'shot' && e.good,
      },
    ],
  },
  '2': {
    key: '2',
    title: 'Futebol',
    objective: 'Leve a bola até o gol do outro time.',
    steps: [
      {
        text: 'Encoste na bola para conduzir',
        action: 'forward',
        alvo: 'bola',
        conclui: (e, c) => e.kind === 'kick' && mine(e, c),
      },
      {
        text: 'Chute forte para onde você olha',
        action: 'primary',
        alvo: 'gol',
        conclui: (e, c) => e.kind === 'kick' && mine(e, c) && e.power >= 0.9,
      },
      { text: 'Faça um gol', action: 'primary', alvo: 'gol', conclui: ourPoint },
    ],
    hints: [
      {
        id: 'fb-run',
        text: 'Segure para correr: correndo, a bola vai mais longe',
        action: 'run',
        hold: true,
        vezes: 3,
        quando: (e, c) => e.kind === 'kick' && mine(e, c) && e.power < 0.4,
        feito: pressed('run'),
      },
    ],
  },
  '3': netGame('3', 'Tênis', 'Rebata a bola por cima da rede; ela não pode quicar duas vezes do seu lado.', 'Rebata'),
  '4': netGame('4', 'Vôlei', 'Passe a bola por cima da rede e não deixe ela cair do seu lado.', 'Bata na bola'),
  '5': netGame('5', 'Ping pong', 'Rebata a bolinha para a mesa do outro lado.', 'Rebata'),
  '6': {
    key: '6',
    title: 'Sinuca',
    objective: 'Use a bola branca para encaçapar as outras.',
    steps: [
      {
        text: 'Mire girando a câmera',
        action: 'turnLeft',
        also: ['turnRight'],
        mouse: true,
        alvo: 'branca',
        conclui: (e) => e.kind === 'look' || pressed('turnLeft', 'turnRight')(e),
      },
      {
        text: 'Segure para dar força',
        action: 'primary',
        hold: true,
        alvo: 'branca',
        conclui: (e) => e.kind === 'charge',
      },
      {
        text: 'Solte para tacar',
        action: 'primary',
        alvo: 'branca',
        conclui: (e, c) => e.kind === 'cue' && mine(e, c),
      },
    ],
    hints: [
      {
        id: 'pool-power',
        text: 'Segure mais tempo para uma tacada mais forte',
        action: 'primary',
        hold: true,
        vezes: 2,
        quando: (e, c) => e.kind === 'cue' && mine(e, c) && e.power < 0.25,
        feito: (e, c) => e.kind === 'cue' && mine(e, c) && e.power >= 0.4,
      },
    ],
  },
  '7': {
    key: '7',
    title: 'Corrida de moto',
    objective: 'Dê as voltas na pista e chegue antes dos outros.',
    steps: [
      { text: 'Acelere', action: 'forward', conclui: pressed('forward') },
      { text: 'Vire nas curvas', action: 'left', also: ['right'], conclui: pressed('left', 'right') },
      {
        text: 'Passe pela caixa para guardar um turbo',
        action: 'forward',
        alvo: 'checkpoint',
        conclui: (e) => e.kind === 'item',
      },
      { text: 'Use o turbo', action: 'primary', conclui: (e) => e.kind === 'boost' && e.source === 'item' },
    ],
    hints: [
      {
        id: 'race-item',
        text: 'Turbo guardado: use quando a pista estiver reta',
        action: 'primary',
        quando: (e) => e.kind === 'item',
        feito: (e) => e.kind === 'boost' && e.source === 'item',
      },
    ],
  },
  duel: {
    key: 'duel',
    title: 'x1',
    objective: 'Derrube o outro antes que ele derrube você.',
    steps: [
      {
        text: 'Soco rápido',
        action: 'primary',
        conclui: (e, c) => e.kind === 'punch' && mine(e, c) && !e.strong,
      },
      {
        text: 'Segure e solte: soco forte',
        action: 'primary',
        hold: true,
        conclui: (e, c) => e.kind === 'punch' && mine(e, c) && e.strong,
      },
      { text: 'Segure para defender', action: 'secondary', hold: true, conclui: pressed('secondary') },
    ],
    hints: [
      {
        id: 'duel-block',
        text: 'Segure para defender dos socos',
        action: 'secondary',
        hold: true,
        quando: (e, c) => e.kind === 'ko' && e.who === c.me,
        feito: pressed('secondary'),
      },
    ],
  },
};

/** o tutorial de agora: x1 quando estou lutando, senão o da zona */
export function tutorialKey(zone: number, fighting: boolean): TutorialKey {
  if (fighting) return 'duel';
  return (zone >= 0 && zone <= 7 ? String(Math.trunc(zone)) : '0') as TutorialKey;
}

/** a zona em que os eventos do tutorial acontecem (x1 é na sala) */
export function tutorialZone(key: TutorialKey): number {
  return key === 'duel' ? 0 : Number(key);
}

/**
 * Próximo passo depois de `e`: se a pessoa fez a ação de um passo (o atual ou um mais adiante), vai para depois dele.
 * Nada mais avança o passo (nem o tempo). `steps.length` = tutorial concluído.
 */
export function advance(t: Tutorial, step: number, e: TutorialInput, ctx: TutorialCtx): number {
  for (let j = t.steps.length - 1; j >= step; j--) if (t.steps[j]!.conclui(e, ctx)) return j + 1;
  return step;
}

/**
 * Dicas depois do tutorial: uma de cada vez; cada uma aparece no máximo `HINT_MAX` vezes (`shown` vem do que ficou
 * salvo). Puro: quem usa decide quanto tempo a dica fica na tela.
 */
export class HintTracker {
  active: TutorialHint | null = null;
  private readonly hits = new Map<string, number>();

  constructor(
    private readonly hints: readonly TutorialHint[],
    /** quantas vezes cada dica já apareceu (lido a cada evento: o que foi salvo nesta visita também conta) */
    private readonly shown: () => Readonly<Record<string, number>>,
  ) {}

  /** devolve a dica que deve aparecer agora, `'hide'` se a ativa foi cumprida, ou null */
  feed(e: TutorialInput, ctx: TutorialCtx): TutorialHint | 'hide' | null {
    if (this.active) {
      if (!this.active.feito(e, ctx)) return null;
      this.active = null;
      return 'hide';
    }
    for (const h of this.hints) {
      if ((this.shown()[h.id] ?? 0) >= HINT_MAX || !h.quando(e, ctx)) continue;
      const n = (this.hits.get(h.id) ?? 0) + 1;
      if (n < (h.vezes ?? 1)) {
        this.hits.set(h.id, n);
        continue;
      }
      this.hits.set(h.id, 0);
      this.active = h;
      return h;
    }
    return null;
  }

  /** a dica saiu da tela (sem ser cumprida) */
  dismiss() {
    this.active = null;
  }
}

// ---------- progresso salvo ----------
export const LEARNED_KEY = 'opencord.space3d.learned';

export interface Learned {
  /** tutoriais concluídos ou pulados */
  done: TutorialKey[];
  /** quantas vezes cada dica já apareceu */
  hints: Record<string, number>;
  /** painel de comandos aberto (lembrado) */
  panel: boolean;
}

export const EMPTY_LEARNED: Learned = { done: [], hints: {}, panel: false };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** lê o progresso; sem armazenamento ou com valor estragado, começa do zero (o tutorial só reaparece) */
export function loadLearned(s: StorageLike | null = storage()): Learned {
  try {
    const raw = s?.getItem(LEARNED_KEY);
    if (!raw) return { ...EMPTY_LEARNED, done: [], hints: {} };
    const v = JSON.parse(raw) as Partial<Record<keyof Learned, unknown>>;
    const done = Array.isArray(v.done)
      ? v.done.filter((k): k is TutorialKey => TUTORIAL_KEYS.includes(k as TutorialKey))
      : [];
    const hints: Record<string, number> = {};
    if (v.hints && typeof v.hints === 'object')
      for (const [k, n] of Object.entries(v.hints as Record<string, unknown>))
        if (typeof n === 'number' && Number.isFinite(n)) hints[k] = n;
    return { done: [...new Set(done)], hints, panel: v.panel === true };
  } catch {
    return { ...EMPTY_LEARNED, done: [], hints: {} };
  }
}

/** grava o progresso; sem armazenamento (janela privada), vale só nesta sessão */
export function saveLearned(l: Learned, s: StorageLike | null = storage()): void {
  try {
    s?.setItem(LEARNED_KEY, JSON.stringify(l));
  } catch {
    /* sem armazenamento: o tutorial reaparece na próxima vez */
  }
}
