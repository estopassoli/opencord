/**
 * Galeria de temas: cada tema da galeria existe nos tokens (tokens.css) e no Vidro (vidro.css) e mantém o texto
 * legível — texto mudo ≥ 4.5:1 e texto principal ≥ 7:1 sobre a conversa (--chat), nos dois esquemas.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from '../src/lib/theme';
import { currentTheme, THEMES } from '../src/lib/themes';

const tokens = readFileSync(resolve(__dirname, '../../../packages/ui/src/tokens.css'), 'utf8');
const vidro = readFileSync(resolve(__dirname, '../src/features/vidro/vidro.css'), 'utf8');

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `seletor ${selector}`).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
  return out;
}

const TEXT = { dark: { text: '#eef0f3', muted: '#969ca7' }, light: { text: '#15171a', muted: '#5c626c' } };

describe('galeria de temas', () => {
  it('ids únicos e mapeamento de volta a partir das configurações', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of THEMES) {
      const a = { theme: t.patch.theme, surface: t.patch.surface, palette: t.patch.palette };
      expect(currentTheme(a as never)).toBe(t.id);
    }
  });

  it.each(THEMES.filter((t) => t.patch.palette !== 'default'))('$name: tokens e contraste', (t) => {
    const b = block(tokens, `:root[data-theme][data-palette='${t.patch.palette}']`);
    for (const k of ['rail', 'sidebar', 'chat', 'elevated', 'interactive', 'interactive-hover', 'border'])
      expect(b[k], k).toMatch(/^#[0-9a-f]{6}$/);
    const scheme = TEXT[t.scheme];
    expect(contrast(scheme.muted, b['chat'] as string)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(scheme.text, b['chat'] as string)).toBeGreaterThanOrEqual(7);
    expect(contrast(scheme.text, b['elevated'] as string)).toBeGreaterThanOrEqual(7);
    const v = block(vidro, `[data-palette='${t.patch.palette}'] {`);
    expect(v['aurora-b']).toMatch(/^#[0-9a-f]{6}$/);
    expect(v['aurora-c']).toMatch(/^#[0-9a-f]{6}$/);
    expect(v['vidro-bg']).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.preview.chat).toBe(b['chat']);
  });

  it('a cor de destaque sugerida vem dos temas novos e não dos antigos', () => {
    for (const t of THEMES) {
      if (t.patch.palette === 'default') expect(t.patch.accent).toBeUndefined();
      else expect(t.patch.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
