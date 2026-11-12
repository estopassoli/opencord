import { defaultUserSettings } from '@opencord/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setShortcuts = vi.fn(async () => ({ registered: [] as string[], failed: [] as string[] }));
vi.mock('../src/lib/bridge', () => ({ bridge: { setShortcuts } }));
vi.mock('../src/store/session', () => ({ api: vi.fn() }));

const toast = vi.fn();
vi.mock('../src/store/ui', () => ({ useUi: { getState: () => ({ toast }) } }));

const { syncShortcuts } = await import('../src/store/settings');

describe('atalhos globais nas configurações', () => {
  beforeEach(() => {
    setShortcuts.mockClear();
    toast.mockClear();
  });

  it('só registra de novo quando os atalhos mudam (arrastar um volume não repete o aviso)', async () => {
    const base = defaultUserSettings();
    setShortcuts.mockResolvedValue({ registered: [], failed: ['Shift+F10'] });
    syncShortcuts(base);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(setShortcuts).toHaveBeenCalledTimes(1);

    // mudanças que não mexem em atalho (volume de alguém, tema…) não registram nem avisam
    for (let i = 0; i < 5; i++) syncShortcuts({ ...base, appearance: { ...base.appearance, fontScale: 1 + i / 10 } });
    await Promise.resolve();
    expect(setShortcuts).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);

    // trocar um atalho registra de novo
    syncShortcuts({ ...base, keybinds: { ...base.keybinds, toggleMute: 'CommandOrControl+Shift+K' } });
    expect(setShortcuts).toHaveBeenCalledTimes(2);
  });
});
