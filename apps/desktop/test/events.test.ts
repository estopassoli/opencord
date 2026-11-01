import { describe, expect, it } from 'vitest';
import { whenLabel } from '../src/lib/when';

describe('eventos: rótulo de quando', () => {
  const now = new Date(2026, 9, 31, 15, 0); // sáb 31 out 2026, 15:00
  it('hoje e amanhã', () => {
    expect(whenLabel(new Date(2026, 9, 31, 21, 0).toISOString(), now)).toBe('hoje, 21:00');
    expect(whenLabel(new Date(2026, 10, 1, 9, 30).toISOString(), now)).toBe('amanhã, 09:30');
  });
  it('outros dias trazem o dia da semana e o mês', () => {
    const label = whenLabel(new Date(2026, 10, 6, 21, 0).toISOString(), now);
    expect(label).toMatch(/sex/);
    expect(label).toMatch(/6/);
    expect(label).toMatch(/nov/);
    expect(label).toMatch(/21:00$/);
  });
});
