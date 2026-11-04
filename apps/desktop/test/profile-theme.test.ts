import { describe, expect, it } from 'vitest';
import { profileThemeVars } from '../src/components/ProfileCardView';

describe('cores do perfil', () => {
  it('sem cores não muda nada; fundo escuro usa texto claro e fundo claro usa texto escuro', () => {
    expect(profileThemeVars(null)).toBeUndefined();
    expect(profileThemeVars(['#4a0d14', '#0b0c0e'])).toMatchObject({ '--pc-text': '#ffffff', '--pc-a': '#4a0d14' });
    expect(profileThemeVars(['#ffd166', '#6cc7ff'])).toMatchObject({ '--pc-text': '#111114' });
  });
});
