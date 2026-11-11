import { appVersionOf, describeDevice } from '@opencord/contracts';
import { describe, expect, it } from 'vitest';
import { percents } from '../src/features/admin/adminKit';
import { compareVersions, newestVersion, versionSlices } from '../src/features/admin/versions';

describe('versões do app no painel admin', () => {
  it('lê a versão do user agent do Electron e do Tauri; navegador não tem', () => {
    const electron =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) OpenCord/0.2.393 Chrome/152.0.7977.149 Electron/44.7.1 Safari/537.36';
    const tauri =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.4341.46 OpenCord/0.3.4';
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
    expect(appVersionOf(electron)).toBe('0.2.393');
    expect(appVersionOf(tauri)).toBe('0.3.4');
    expect(describeDevice(tauri)).toBe('App OpenCord no Windows');
    expect(appVersionOf(chrome)).toBeNull();
    expect(appVersionOf(null)).toBeNull();
  });

  it('compara versões número a número', () => {
    expect(['0.3.10', '0.2.393', '0.3.9'].sort(compareVersions)).toEqual(['0.2.393', '0.3.9', '0.3.10']);
    expect(newestVersion([null, '0.3.4', '0.3.10', undefined, '0.2.999'])).toBe('0.3.10');
    expect(newestVersion([null])).toBeNull();
  });

  it('porcentagens inteiras somam 100', () => {
    expect(percents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percents([997, 2, 1])).toEqual([100, 0, 0]);
    expect(percents([0, 0])).toEqual([0, 0]);
    expect(percents([5, 3, 2]).reduce((a, b) => a + b)).toBe(100);
  });

  it('fatias: a mais recente sempre aparece, até 4 versões da mais nova para a mais antiga, resto em "Outras"', () => {
    const slices = versionSlices(
      [
        { version: '0.2.390', users: 40 },
        { version: '0.3.3', users: 12 },
        { version: null, users: 9 },
        { version: '0.3.4', users: 1 },
        { version: '0.3.0', users: 20 },
        { version: '0.2.393', users: 15 },
        { version: '0.3.2', users: 3 },
      ],
      '0.3.4',
    );
    expect(slices.map((s) => [s.label, s.value])).toEqual([
      ['0.3.4', 1],
      ['0.3.0', 20],
      ['0.2.393', 15],
      ['0.2.390', 40],
      ['Outras versões', 15],
      ['Navegador', 9],
    ]);
    expect(slices[0]).toMatchObject({ latest: true, color: 'var(--adm-series-1)' });
    expect(slices.find((s) => s.id === 'other')?.folded).toEqual(['0.3.3', '0.3.2']);
    // o navegador tem cor fixa, não importa quantas versões existam
    expect(versionSlices([{ version: null, users: 2 }]).map((s) => s.color)).toEqual(['var(--adm-series-5)']);
  });

  it('sem a versão publicada, a mais nova em uso é a "mais recente"; fatias vazias somem', () => {
    const slices = versionSlices([
      { version: '0.3.3', users: 2 },
      { version: '0.3.4', users: 1 },
      { version: '0.3.1', users: 0 },
    ]);
    expect(slices.map((s) => [s.label, s.latest])).toEqual([
      ['0.3.4', true],
      ['0.3.3', false],
    ]);
  });
});
