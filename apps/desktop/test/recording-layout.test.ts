import { describe, expect, it } from 'vitest';
import { layoutCall, type Rect } from '../src/recording/layout';

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('disposição da gravação', () => {
  it('grade sem transmissão: todos dentro do quadro e sem sobrepor', () => {
    for (const n of [1, 2, 3, 4, 5, 9, 16]) {
      const l = layoutCall({ people: Array.from({ length: n }, (_, i) => `p${i}`), screens: [] }, 1280, 720);
      expect(l.people).toHaveLength(n);
      for (const p of l.people) expect(inside(p.rect, 1280, 720)).toBe(true);
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) expect(overlap(l.people[i]!.rect, l.people[j]!.rect)).toBe(false);
    }
  });
  it('com transmissão: tela grande e pessoas numa coluna à direita', () => {
    const l = layoutCall({ people: ['a', 'b', 'c'], screens: ['a'] }, 1280, 720);
    expect(l.screens[0]!.rect.w).toBeGreaterThan(900);
    for (const p of l.people) {
      expect(p.rect.x).toBeGreaterThan(l.screens[0]!.rect.x + l.screens[0]!.rect.w);
      expect(inside(p.rect, 1280, 720)).toBe(true);
    }
  });
});
