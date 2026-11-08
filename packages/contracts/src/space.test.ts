import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateSpace, SPACE_THEMES, SPACE_VOICE_FLOOR, SpaceLayout, SpaceMove, spaceVoiceGain } from './space.js';

describe('Espaço 3D: gerador procedural', () => {
  it('mesmo servidor → mesmo ambiente; servidores diferentes → ambientes diferentes', () => {
    const id = randomUUID();
    expect(generateSpace(id)).toEqual(generateSpace(id));
    const many = Array.from({ length: 40 }, () => JSON.stringify(generateSpace(randomUUID())));
    expect(new Set(many).size).toBe(40);
  });

  it('todo ambiente gerado é válido, tem telão e usa vários temas', () => {
    const themes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const l = generateSpace(randomUUID());
      expect(SpaceLayout.safeParse(l).success).toBe(true);
      expect(l.items.filter((it) => it.kind === 'screen')).toHaveLength(1);
      themes.add(l.theme);
    }
    expect(themes.size).toBe(SPACE_THEMES.length);
  });
});

describe('Espaço 3D: voz pela distância', () => {
  it('cheia de perto, cai devagar e nunca passa do piso', () => {
    expect(spaceVoiceGain(0)).toBe(1);
    expect(spaceVoiceGain(3)).toBe(1);
    expect(spaceVoiceGain(500)).toBe(SPACE_VOICE_FLOOR);
    let prev = 1;
    for (let d = 3; d <= 30; d += 0.5) {
      const g = spaceVoiceGain(d);
      expect(g).toBeLessThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(SPACE_VOICE_FLOOR);
      prev = g;
    }
    // a 10 m ainda se ouve bem mais que o piso
    expect(spaceVoiceGain(10)).toBeGreaterThan(0.7);
  });
});

describe('Espaço 3D: validação', () => {
  it('recusa posição absurda', () => {
    const id = randomUUID();
    expect(SpaceMove.safeParse({ channelId: id, x: 1, y: 0, z: 1, ry: 0, a: 1 }).success).toBe(true);
    expect(SpaceMove.safeParse({ channelId: id, x: 1e9, y: 0, z: 1, ry: 0, a: 1 }).success).toBe(false);
    expect(SpaceMove.safeParse({ channelId: id, x: 1, y: 0, z: 1, ry: 0, a: 9 }).success).toBe(false);
  });
});
