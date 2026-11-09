import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/features/space3d/bindings';
import type { GameEvent } from '../src/features/space3d/events';
import {
  advance,
  HINT_MAX,
  HintTracker,
  LEARNED_KEY,
  loadLearned,
  saveLearned,
  TUTORIALS,
  tutorialKey,
  type TutorialCtx,
  type TutorialInput,
  type TutorialKey,
} from '../src/features/space3d/tutorial';

const ctx: TutorialCtx = { me: 'me', team: 'a' };
const at = { x: 0, y: 0, z: 0 };
const ev = (zone: number, e: Record<string, unknown>) => ({ at, power: 0.5, zone, ...e }) as GameEvent;

/** a sequência que quem joga faz pela primeira vez em cada jogo */
const PLAYTHROUGH: Record<TutorialKey, TutorialInput[]> = {
  '0': [
    { kind: 'press', action: 'left' },
    { kind: 'press', action: 'run' },
    { kind: 'press', action: 'jump' },
  ],
  '1': [
    { kind: 'grab' },
    { kind: 'charge', c: 0.3 },
    { kind: 'shot', good: true },
    ev(1, { kind: 'score', side: 'a', points: 2, by: 'me', reason: 'cesta' }),
  ],
  '2': [
    ev(2, { kind: 'control', by: 'me', power: 0.3 }),
    ev(2, { kind: 'kick', by: 'me', power: 1 }),
    ev(2, { kind: 'score', side: 'a', points: 1, by: 'me', reason: 'gol' }),
  ],
  '3': [
    { kind: 'ready', action: 'primary' },
    ev(3, { kind: 'hit', by: 'me', with: 'racket' }),
    ev(3, { kind: 'score', side: 'a', points: 1, by: null, reason: 'dois quiques' }),
  ],
  '4': [
    { kind: 'ready', action: 'primary' },
    ev(4, { kind: 'hit', by: 'me', with: 'hand' }),
    ev(4, { kind: 'score', side: 'a', points: 1, by: null, reason: 'caiu' }),
  ],
  '5': [
    { kind: 'ready', action: 'primary' },
    ev(5, { kind: 'hit', by: 'me', with: 'racket' }),
    ev(5, { kind: 'score', side: 'a', points: 1, by: null, reason: 'fora' }),
  ],
  '6': [{ kind: 'look' }, { kind: 'charge', c: 0.31 }, ev(6, { kind: 'cue', by: 'me' })],
  '7': [
    { kind: 'press', action: 'forward' },
    { kind: 'press', action: 'right' },
    ev(7, { kind: 'item' }),
    ev(7, { kind: 'boost', source: 'item' }),
  ],
  '8': [
    ev(8, { kind: 'gunshot', by: 'me', w: 'm4' }),
    { kind: 'press', action: 'secondary' },
    ev(8, { kind: 'gunfx', what: 'magOut', w: 'm4' }),
    ev(8, { kind: 'gunfx', what: 'slide', w: 'm4' }),
  ],
  duel: [
    ev(0, { kind: 'punch', by: 'me', strong: false, landed: false }),
    ev(0, { kind: 'punch', by: 'me', strong: true, landed: false }),
    { kind: 'press', action: 'secondary' },
  ],
};

describe('Espaço 3D: tutorial de primeira vez (dados)', () => {
  it('cada zona de 1 a 8 e o x1 têm objetivo e de 2 a 4 passos, cada um com uma ação dos atalhos', () => {
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', 'duel'] as const) {
      const t = TUTORIALS[key];
      expect(t.key).toBe(key);
      expect(t.objective.length).toBeGreaterThan(10);
      expect(t.objective.trim().endsWith('.')).toBe(true);
      expect(t.steps.length).toBeGreaterThanOrEqual(2);
      expect(t.steps.length).toBeLessThanOrEqual(4);
      for (const s of t.steps) {
        expect(ACTIONS).toContain(s.action);
        for (const a of s.also ?? []) expect(ACTIONS).toContain(a);
        expect(s.text.length).toBeGreaterThan(2);
        // tecla nunca escrita à mão: sai sempre do <Binding>
        expect(s.text).not.toMatch(/\([A-Z]\)|\bclique\b/i);
      }
      // dica com tecla: a configurável (`action`) ou uma fixa (`keys`, como o 2 da pistola), nunca as duas faltando
      for (const h of t.hints) {
        if (h.action) expect(ACTIONS).toContain(h.action);
        else expect(h.keys).toBeTruthy();
      }
    }
    expect(TUTORIALS['0'].steps.length).toBeGreaterThanOrEqual(2);
  });

  it('os alvos do mundo batem com o jogo (bola e cesta no basquete, gol no futebol, branca na sinuca)', () => {
    expect(TUTORIALS['1'].steps.map((s) => s.alvo)).toEqual(['bola', 'cesta', 'cesta', 'cesta']);
    expect(TUTORIALS['2'].steps.some((s) => s.alvo === 'gol')).toBe(true);
    expect(TUTORIALS['3'].steps.some((s) => s.alvo === 'rede')).toBe(true);
    expect(TUTORIALS['6'].steps.every((s) => s.alvo === 'branca')).toBe(true);
    expect(TUTORIALS['7'].steps.some((s) => s.alvo === 'checkpoint')).toBe(true);
  });

  it('a sequência esperada de cada jogo conclui o tutorial, passo a passo', () => {
    for (const key of Object.keys(PLAYTHROUGH) as TutorialKey[]) {
      const t = TUTORIALS[key];
      let i = 0;
      for (const [n, e] of PLAYTHROUGH[key].entries()) {
        const next = advance(t, i, e, ctx);
        expect(next, `${key} passo ${n}`).toBe(Math.min(n + 1, t.steps.length));
        i = next;
      }
      expect(i).toBe(t.steps.length);
    }
  });

  it('nada avança o passo sem a ação: outro evento, o chute do outro, o ponto do outro time', () => {
    const fb = TUTORIALS['2'];
    expect(advance(fb, 0, ev(2, { kind: 'kick', by: 'ana', power: 1 }), ctx)).toBe(0);
    expect(advance(fb, 0, { kind: 'press', action: 'jump' }, ctx)).toBe(0);
    expect(advance(fb, 2, ev(2, { kind: 'score', side: 'b', points: 1, by: 'ana', reason: 'gol' }), ctx)).toBe(2);
    // o passo não tem relógio: mil "quadros" sem ação não mudam nada
    let i = 0;
    for (let k = 0; k < 1000; k++) i = advance(TUTORIALS['1'], i, ev(1, { kind: 'bounce', surface: 'floor' }), ctx);
    expect(i).toBe(0);
  });

  it('quem já sabe pula adiante: o chute forte conta o "encostar" e o gol conclui tudo', () => {
    const fb = TUTORIALS['2'];
    expect(advance(fb, 0, ev(2, { kind: 'kick', by: 'me', power: 1 }), ctx)).toBe(2);
    expect(advance(fb, 0, ev(2, { kind: 'score', side: 'a', points: 1, by: 'me', reason: 'gol' }), ctx)).toBe(
      fb.steps.length,
    );
  });

  it('o x1 vale quando estou lutando; fora dele, a zona', () => {
    expect(tutorialKey(0, true)).toBe('duel');
    expect(tutorialKey(0, false)).toBe('0');
    expect(tutorialKey(6, false)).toBe('6');
    expect(tutorialKey(8, false)).toBe('8');
    expect(tutorialKey(42, false)).toBe('0');
  });
});

describe('Espaço 3D: dicas do momento', () => {
  it('uma de cada vez, só depois de acontecer as vezes pedidas, e some quando a pessoa faz', () => {
    const tr = new HintTracker(TUTORIALS['2'].hints, () => ({}));
    const got = ev(2, { kind: 'control', by: 'me', power: 0.3 });
    expect(tr.feed(got, ctx)).toBeNull();
    const h = tr.feed(got, ctx);
    expect(h && h !== 'hide' ? h.id : null).toBe('fb-pass');
    // com uma dica na tela, nenhuma outra entra
    expect(tr.feed(got, ctx)).toBeNull();
    expect(tr.feed({ kind: 'press', action: 'secondary' }, ctx)).toBe('hide');
    expect(tr.active).toBeNull();
  });

  it(`cada dica aparece no máximo ${HINT_MAX} vezes`, () => {
    const tr = new HintTracker(TUTORIALS['7'].hints, () => ({ 'race-item': HINT_MAX }));
    expect(tr.feed(ev(7, { kind: 'item' }), ctx)).toBeNull();
    const fresh = new HintTracker(TUTORIALS['7'].hints, () => ({ 'race-item': HINT_MAX - 1 }));
    expect(fresh.feed(ev(7, { kind: 'item' }), ctx)).not.toBeNull();
  });
});

describe('Espaço 3D: progresso salvo', () => {
  it('grava e lê o que já foi aprendido, e ignora lixo', () => {
    const mem = new Map<string, string>();
    const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveLearned({ done: ['1', 'duel'], hints: { 'fb-run': 1 }, panel: true }, s);
    expect(JSON.parse(mem.get(LEARNED_KEY)!).done).toEqual(['1', 'duel']);
    expect(loadLearned(s)).toEqual({ done: ['1', 'duel'], hints: { 'fb-run': 1 }, panel: true });
    mem.set(LEARNED_KEY, '{"done":["1","x",3,"1"],"hints":{"a":"2","b":2},"panel":"sim"}');
    expect(loadLearned(s)).toEqual({ done: ['1'], hints: { b: 2 }, panel: false });
    mem.set(LEARNED_KEY, '{nada');
    expect(loadLearned(s)).toEqual({ done: [], hints: {}, panel: false });
  });

  it('localStorage que lança erro não quebra nada (o tutorial só reaparece)', () => {
    const bad = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
    };
    expect(loadLearned(bad)).toEqual({ done: [], hints: {}, panel: false });
    expect(() => saveLearned({ done: ['1'], hints: {}, panel: false }, bad)).not.toThrow();
    expect(loadLearned(null).done).toEqual([]);
  });
});
