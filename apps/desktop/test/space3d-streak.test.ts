import { describe, expect, it } from 'vitest';
import { KillStreak, MULTI_MS, STREAK_LABEL } from '../src/features/space3d/gunfight/streak';
import { sfxFor } from '../src/features/space3d/sfxmap';
import { RECIPES } from '../src/features/space3d/sfx';

describe('gunfight: narrador da sequência de abates', () => {
  it('primeiro abate da partida é "first kill"; seguidos dentro da janela sobem até penta e depois "amazing"', () => {
    const s = new KillStreak();
    const calls = [0, 1, 2, 3, 4, 5, 6].map((i) => s.kill(1000 + i * 1000, false));
    expect(calls).toEqual(['firstKill', 'double', 'triple', 'quadra', 'penta', 'amazing', 'amazing']);
  });

  it('fora da janela a sequência recomeça; morrer zera; tiro na cabeça sozinho é "headshot"', () => {
    const s = new KillStreak();
    s.otherKill();
    expect(s.kill(0, false)).toBeNull();
    expect(s.kill(MULTI_MS + 1, true)).toBe('headshot');
    expect(s.kill(MULTI_MS + 2, true)).toBe('double');
    s.died();
    expect(s.kill(MULTI_MS + 3, false)).toBeNull();
    expect(s.chain).toBe(1);
  });

  it('a sequência vale mais que o primeiro abate e o headshot; partida nova volta a ter "first kill"', () => {
    const s = new KillStreak();
    expect(s.kill(0, true)).toBe('firstKill');
    expect(s.kill(100, true)).toBe('double');
    s.reset();
    expect(s.kill(200, true)).toBe('firstKill');
  });

  it('cada chamada tem faixa e som (a variante da gravação é a própria chamada)', () => {
    const at = { x: 0, y: 0, z: 0 };
    for (const call of Object.keys(STREAK_LABEL) as (keyof typeof STREAK_LABEL)[]) {
      const [cue] = sfxFor({ kind: 'streak', call, power: 1, zone: 8, at }, { me: 'eu', team: 'a' });
      expect(cue?.name).toBe('announcer');
      expect(cue?.sample).toBe(call);
      expect(STREAK_LABEL[call].length).toBeGreaterThan(0);
      expect(RECIPES[cue!.name]).toBeDefined();
    }
  });
});
