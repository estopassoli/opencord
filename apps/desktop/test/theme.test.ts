import { describe, expect, it } from 'vitest';
import { accentTokens, apcaContrast, contrast, mix } from '../src/lib/theme';

const SURFACES = { dark: '#24262c', oled: '#0b0b0c', light: '#ffffff' };
const SAMPLES = ['#4d56fd', '#ffe600', '#00ff88', '#111111', '#ffffff', '#ef4f4f', '#8a94a6'];

describe('accentTokens', () => {
  it('cor da logo é o destaque padrão com texto branco', () => {
    const t = accentTokens('#4d56fd', SURFACES.dark, true);
    expect(t.brand).toBe('#4d56fd');
    expect(t.textOnBrand).toBe('#ffffff');
    expect(contrast(t.textOnBrand, t.brand)).toBeGreaterThanOrEqual(4.5);
  });

  it('texto branco em roxos, rosas e azuis médios (a razão do WCAG 2 escolhia preto)', () => {
    for (const accent of ['#7c5cff', '#7b6cff', '#9b7bff', '#e0559b', '#2d8cff', '#14a3a3', '#5865f2']) {
      expect(accentTokens(accent, SURFACES.dark, true).textOnBrand).toBe('#ffffff');
    }
  });

  it('texto escuro em destaques claros e branco nos escuros', () => {
    for (const accent of ['#2ee6a6', '#39c6ff', '#d9a514', '#ffe600', '#ffffff']) {
      expect(accentTokens(accent, SURFACES.dark, true).textOnBrand).toBe('#0b0c0e');
    }
    for (const accent of ['#000000', '#1e1b4b', '#c2410c']) {
      expect(accentTokens(accent, SURFACES.dark, true).textOnBrand).toBe('#ffffff');
    }
  });

  it.each(SAMPLES)('%s mantém o texto do botão legível e o texto AA em qualquer tema', (accent) => {
    for (const [bg, dark] of [
      [SURFACES.dark, true],
      [SURFACES.oled, true],
      [SURFACES.light, false],
    ] as const) {
      const t = accentTokens(accent, bg, dark);
      // texto do botão: o mais legível (APCA) e ao menos Lc 45, mínimo para texto em negrito
      const other = t.textOnBrand === '#ffffff' ? '#0b0c0e' : '#ffffff';
      expect(apcaContrast(t.textOnBrand, t.brand)).toBeGreaterThanOrEqual(apcaContrast(other, t.brand));
      expect(apcaContrast(t.textOnBrand, t.brand)).toBeGreaterThanOrEqual(45);
      expect(contrast(t.brandText, bg)).toBeGreaterThanOrEqual(4.5);
      expect(t.brandHover).not.toBe(t.brand);
    }
  });

  it('apcaContrast: preto no branco passa de 100 e cor igual dá zero', () => {
    expect(apcaContrast('#000000', '#ffffff')).toBeGreaterThan(100);
    expect(apcaContrast('#777777', '#777777')).toBe(0);
  });

  it('mix interpola nos extremos', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
});
