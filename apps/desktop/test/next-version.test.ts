import { describe, expect, it } from 'vitest';
import { bumpOf, compareVersions, nextVersion } from '../scripts/next-version.mjs';

describe('versão do app (SemVer pelos commits)', () => {
  it('feat sobe o minor e zera o patch; o resto sobe o patch', () => {
    expect(nextVersion('0.3.2', ['fix(oc-live): live nativa começa no Windows 10'])).toBe('0.3.3');
    expect(
      nextVersion('0.3.2', ['perf/fix(desktop): teste em massa', 'docs(tauri): plano', 'test(gunfight): média']),
    ).toBe('0.3.3');
    expect(nextVersion('0.3.2', ['fix: a', 'feat(chat): enquetes'])).toBe('0.4.0');
  });

  it('mudança incompatível (! ou BREAKING CHANGE) sobe o major', () => {
    expect(nextVersion('0.3.2', ['feat(api)!: rota nova de login'])).toBe('1.0.0');
    expect(nextVersion('1.4.7', ['refactor: troca o formato\n\nBREAKING CHANGE: sessões antigas saem'])).toBe('2.0.0');
    expect(bumpOf('fix(x): corpo menciona breaking change: em minúsculas\n\nnada')).toBe('patch');
  });

  it('Release-As no corpo fixa a versão (se for maior que a última)', () => {
    const feat = 'feat(admin): versões do app';
    expect(nextVersion('0.3.4', [feat, 'ci: fixa a versão\n\nRelease-As: 0.3.401'])).toBe('0.3.401');
    expect(nextVersion('0.3.4', [feat, 'ci: x\n\nrelease-as: v0.3.5', 'ci: y\n\nRelease-As: 0.3.6'])).toBe('0.3.6');
    // menor ou igual à última não volta a versão: segue o cálculo normal
    expect(nextVersion('0.3.4', [feat, 'ci: x\n\nRelease-As: 0.3.4'])).toBe('0.4.0');
    // só no corpo, não no assunto
    expect(nextVersion('0.3.4', ['fix: Release-As: 9.9.9'])).toBe('0.3.5');
  });

  it('sem commits ainda é uma build nova: sobe o patch', () => {
    expect(nextVersion('0.3.2', [])).toBe('0.3.3');
  });

  it('compara versões numericamente (0.3.10 > 0.3.9 > 0.2.393)', () => {
    expect(['0.3.10', '0.2.393', '0.3.9'].sort(compareVersions)).toEqual(['0.2.393', '0.3.9', '0.3.10']);
  });
});
