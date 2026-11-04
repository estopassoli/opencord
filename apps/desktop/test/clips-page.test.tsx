import { describe, expect, it } from 'vitest';
import { groupClips, NO_GAME } from '../src/features/clips/groups';

const clip = (i: number, game: string | null, icon: string | null = null) => ({
  file: `C:/clipes/${i}.webm`,
  name: `${i}.webm`,
  game,
  icon,
  steamAppId: null,
  createdAt: 1_000_000 - i * 60_000,
  durationMs: 30_000,
  sizeBytes: 1,
  thumb: null,
});

describe('página de clipes', () => {
  it('agrupa por jogo, mais recente primeiro, com "sem jogo" à parte e o ícone de qualquer clipe do jogo', () => {
    const g = groupClips([clip(5, 'Elden Ring'), clip(1, null), clip(3, 'Elden Ring', 'icone.png'), clip(2, 'CS2')]);
    expect(g.map((x) => x.key)).toEqual([NO_GAME, 'CS2', 'Elden Ring']);
    expect(g[2]!.clips.map((c) => c.name)).toEqual(['3.webm', '5.webm']);
    expect(g[2]!.icon).toBe('icone.png');
  });
});
