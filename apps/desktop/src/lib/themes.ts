/**
 * Galeria de temas (Aparência → Tema). Um tema é um conjunto: esquema (escuro/claro), superfícies (tokens em
 * @opencord/ui/tokens.css), cor de destaque sugerida e as luzes da aurora do Vidro (vidro.css). Os quatro tons
 * antigos do tema escuro e o tema claro continuam existindo como entradas da galeria (campos `theme` + `surface`);
 * os novos usam `palette`.
 */
import type { UserSettings } from '@opencord/contracts';

type Appearance = UserSettings['appearance'];
export type PaletteId = Appearance['palette'];
export type ThemeId = 'grafite' | 'meia-noite' | 'oled' | 'ardosia' | 'claro' | Exclude<PaletteId, 'default'>;

export interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  scheme: 'dark' | 'light';
  /** o que vira nas configurações ao escolher */
  patch: Pick<Appearance, 'theme' | 'surface' | 'palette'> & { accent?: string };
  /** cores do cartão de prévia: fundo da lista, fundo da conversa, cor da aurora */
  preview: { rail: string; chat: string; glow: string };
}

const legacy = (
  id: ThemeId,
  name: string,
  description: string,
  surface: Appearance['surface'],
  preview: ThemeDef['preview'],
): ThemeDef => ({
  id,
  name,
  description,
  scheme: 'dark',
  patch: { theme: 'dark', surface, palette: 'default' },
  preview,
});

const dark = (
  id: Exclude<PaletteId, 'default'>,
  name: string,
  description: string,
  accent: string,
  preview: ThemeDef['preview'],
): ThemeDef => ({
  id,
  name,
  description,
  scheme: 'dark',
  patch: { theme: 'dark', surface: 'default', palette: id, accent },
  preview,
});

const light = (
  id: Exclude<PaletteId, 'default'>,
  name: string,
  description: string,
  accent: string,
  preview: ThemeDef['preview'],
): ThemeDef => ({
  id,
  name,
  description,
  scheme: 'light',
  patch: { theme: 'light', surface: 'default', palette: id, accent },
  preview,
});

export const THEMES: readonly ThemeDef[] = [
  legacy('grafite', 'Grafite', 'Cinza neutro, o padrão.', 'default', {
    rail: '#111317',
    chat: '#24262c',
    glow: '#7b6cff',
  }),
  legacy('meia-noite', 'Meia-noite', 'Azul bem escuro.', 'midnight', {
    rail: '#0b0e1a',
    chat: '#191d33',
    glow: '#4d56fd',
  }),
  legacy('oled', 'OLED', 'Preto puro.', 'oled', { rail: '#000000', chat: '#0b0b0c', glow: '#39c6ff' }),
  legacy('ardosia', 'Ardósia', 'Cinza mais claro.', 'slate', { rail: '#1d1f25', chat: '#2c2f36', glow: '#8a94a6' }),
  dark('artico', 'Ártico', 'Azul-cinza frio.', '#5fa8d3', { rail: '#171c26', chat: '#272e3c', glow: '#5fa8d3' }),
  dark('oceano', 'Oceano', 'Verde-azulado profundo.', '#14a3a3', { rail: '#091318', chat: '#14242c', glow: '#1fb2c9' }),
  dark('floresta', 'Floresta', 'Verde escuro.', '#3fb27f', { rail: '#0e1511', chat: '#1b2720', glow: '#2fa36a' }),
  dark('lavanda', 'Lavanda', 'Roxo suave.', '#9b7bff', { rail: '#15111f', chat: '#251f34', glow: '#9b7bff' }),
  dark('rose', 'Rosé', 'Vinho com rosa.', '#e0559b', { rail: '#1b1017', chat: '#2c1c27', glow: '#ff5fa2' }),
  dark('brasa', 'Brasa', 'Marrom quente com laranja.', '#f08a24', {
    rail: '#19100e',
    chat: '#2a1d19',
    glow: '#ff6a3d',
  }),
  dark('cafe', 'Café', 'Marrom com dourado.', '#d9a514', { rail: '#161210', chat: '#26211c', glow: '#c58a4a' }),
  dark('neon', 'Neon', 'Quase preto com verde elétrico.', '#2ee6a6', {
    rail: '#050507',
    chat: '#101016',
    glow: '#2ee6a6',
  }),
  {
    id: 'claro',
    name: 'Claro',
    description: 'Branco e cinza.',
    scheme: 'light',
    patch: { theme: 'light', surface: 'default', palette: 'default' },
    preview: { rail: '#e3e5e8', chat: '#ffffff', glow: '#4d56fd' },
  },
  light('papel', 'Papel', 'Bege, como papel.', '#c2410c', { rail: '#e6e0d4', chat: '#faf7f0', glow: '#f0b27a' }),
  light('nevoa', 'Névoa', 'Branco azulado.', '#2d8cff', { rail: '#dde3ec', chat: '#f7f9fc', glow: '#6cc7ff' }),
  light('menta', 'Menta', 'Branco esverdeado.', '#14a3a3', { rail: '#d9e9e0', chat: '#f6fbf8', glow: '#3fb27f' }),
];

/** Qual entrada da galeria corresponde às configurações atuais. */
export function currentTheme(a: Appearance): ThemeId {
  if (a.palette !== 'default') return a.palette;
  if (a.theme === 'light') return 'claro';
  return a.surface === 'midnight'
    ? 'meia-noite'
    : a.surface === 'oled'
      ? 'oled'
      : a.surface === 'slate'
        ? 'ardosia'
        : 'grafite';
}

export const themeById = (id: ThemeId): ThemeDef => THEMES.find((t) => t.id === id) ?? (THEMES[0] as ThemeDef);
