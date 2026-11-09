/**
 * Derivação de cores a partir da cor de destaque escolhida pelo usuário,
 * escolhendo o texto sobre o destaque pelo contraste percebido (APCA) e garantindo WCAG AA (4.5:1)
 * para texto na cor do destaque.
 */

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => m - n) as [number, number];
  return (y + 0.05) / (x + 0.05);
}

/** Luminância da APCA (sRGB com gama simples 2.4 e piso para pretos). */
function apcaY(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => (c / 255) ** 2.4) as Rgb;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  return y > 0.022 ? y : y + (0.022 - y) ** 1.414;
}

/**
 * Contraste percebido do texto sobre o fundo (APCA 0.0.98G, valor Lc absoluto, 0 a ~106).
 * Diferente da razão do WCAG 2, não exagera o preto sobre cores médias saturadas
 * (roxo, rosa, azul), em que o branco é o que de fato se lê melhor.
 */
export function apcaContrast(text: string, bg: string): number {
  const t = apcaY(text);
  const b = apcaY(bg);
  const s = b > t ? (b ** 0.56 - t ** 0.57) * 1.14 : (b ** 0.65 - t ** 0.62) * 1.14;
  if (Math.abs(s) < 0.1) return 0;
  return (Math.abs(s) - 0.027) * 100;
}

/** Mistura `a` com `b` na proporção `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [pa, pb] = [parseHex(a), parseHex(b)];
  return toHex(pa.map((c, i) => c + ((pb[i] as number) - c) * t) as Rgb);
}

/** Aproxima `color` de `toward` até atingir `min` de contraste com `bg`. */
function ensureContrast(color: string, bg: string, toward: string, min = 4.5): string {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(color, toward, t);
    if (contrast(c, bg) >= min) return c;
  }
  return toward;
}

export interface AccentTokens {
  brand: string;
  brandHover: string;
  textOnBrand: string;
  brandText: string;
}

/**
 * @param accent cor escolhida (#rrggbb)
 * @param surface cor da superfície onde texto na cor do destaque aparece (ex.: --chat)
 * @param dark tema escuro (texto do destaque clareia) ou claro (escurece)
 */
export function accentTokens(accent: string, surface: string, dark: boolean): AccentTokens {
  const white = '#ffffff';
  const ink = '#0b0c0e';
  // texto sobre o destaque: o que se lê melhor de fato (APCA), não a razão do WCAG 2,
  // que escolhia preto em roxos e rosas médios
  const textOnBrand = apcaContrast(white, accent) >= apcaContrast(ink, accent) ? white : ink;
  return {
    brand: accent,
    // hover escurece; destaques quase pretos clareiam para a mudança continuar visível
    brandHover: mix(accent, luminance(accent) < 0.03 ? white : '#000000', 0.12),
    textOnBrand,
    brandText: ensureContrast(accent, surface, dark ? white : ink),
  };
}

/** Detecta se uma família de fonte está instalada comparando a largura com fallbacks genéricos. */
export function isFontAvailable(family: string): boolean {
  if (!family.trim() || typeof document === 'undefined') return false;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return true;
  const sample = 'mmmmmmmmmmlli1WQ@#OpenCord';
  return ['monospace', 'serif', 'sans-serif'].some((fallback) => {
    ctx.font = `32px ${fallback}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `32px "${family}", ${fallback}`;
    return ctx.measureText(sample).width !== base;
  });
}

export const FONT_STACK_FALLBACK = "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
