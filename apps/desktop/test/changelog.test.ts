import { ICON_NAMES } from '@opencord/ui';
import { describe, expect, it } from 'vitest';
import { CHANGELOG } from '../src/features/home/changelog';

describe('linha do tempo de Novidades', () => {
  it('mais nova primeiro, datas/horas válidas, ícones que existem e textos preenchidos', () => {
    const key = (e: (typeof CHANGELOG)[number]) => `${e.date} ${e.time ?? '00:00'}`;
    for (let i = 1; i < CHANGELOG.length; i++) expect(key(CHANGELOG[i - 1]!) >= key(CHANGELOG[i]!)).toBe(true);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(`${e.date}T12:00:00`).getTime())).toBe(false);
      if (e.time) expect(e.time).toMatch(/^\d{2}:\d{2}$/);
      expect(ICON_NAMES).toContain(e.icon);
      expect(e.title.length).toBeGreaterThan(3);
      expect(e.body.length).toBeGreaterThan(10);
    }
  });
});
