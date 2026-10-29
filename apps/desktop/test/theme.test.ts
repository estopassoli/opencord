import { describe, expect, it } from 'vitest';
import { accentTokens, contrast, mix } from '../src/lib/theme';

const SURFACES = { dark: '#24262c', oled: '#0b0b0c', light: '#ffffff' };
const SAMPLES = ['#4d56fd', '#ffe600', '#00ff88', '#111111', '#ffffff', '#ef4f4f', '#8a94a6'];

describe('accentTokens', () => {
  it('cor da logo é o destaque padrão com texto branco AA', () => {
    const t = accentTokens('#4d56fd', SURFACES.dark, true);
    expect(t.brand).toBe('#4d56fd');
    expect(t.textOnBrand).toBe('#ffffff');
    expect(contrast(t.textOnBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SAMPLES)('%s mantém contraste AA no botão e no texto em qualquer tema', (accent) => {
    for (const [bg, dark] of [
      [SURFACES.dark, true],
      [SURFACES.oled, true],
      [SURFACES.light, false],
    ] as const) {
      const t = accentTokens(accent, bg, dark);
      expect(contrast(t.textOnBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.brandText, bg)).toBeGreaterThanOrEqual(4.5);
      expect(t.brandHover).not.toBe(t.brand);
    }
  });

  it('mix interpola nos extremos', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});
