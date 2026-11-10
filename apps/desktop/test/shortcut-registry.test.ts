/**
 * Atalhos globais com nova tentativa: um atalho em uso por outro programa (outra cópia do OpenCord aberta antes) volta
 * sozinho quando fica livre, sem reabrir o app; acelerador inválido não fica sendo tentado; trocar ou encerrar para as
 * tentativas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHORTCUT_RETRY_MS, ShortcutRegistry } from '../electron/main/shortcut-registry';

type Action = 'clip' | 'mute';

function fakeOs() {
  const taken = new Set<string>();
  const mine = new Map<string, () => void>();
  const fired: Action[] = [];
  const recovered: string[] = [];
  let resets = 0;
  const reg = new ShortcutRegistry<Action>({
    register: (accel, fire) => {
      if (accel === 'Bad+Key') throw new Error('acelerador inválido');
      if (taken.has(accel) || mine.has(accel)) return false;
      mine.set(accel, fire);
      return true;
    },
    unregisterAll: () => mine.clear(),
    fire: (a) => fired.push(a),
    afterReset: () => resets++,
    recovered: (a) => recovered.push(a),
  });
  return { reg, taken, mine, fired, recovered, resets: () => resets };
}

describe('ShortcutRegistry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registra os livres e aponta os que estão em uso', () => {
    const os = fakeOs();
    os.taken.add('Shift+F10');
    const r = os.reg.set({ clip: 'Shift+F10', mute: 'Ctrl+Shift+M' });
    expect(r).toEqual({ registered: ['Ctrl+Shift+M'], failed: ['Shift+F10'] });
    expect(os.reg.waiting).toEqual(['Shift+F10']);
    expect(os.resets()).toBe(1);
    os.mine.get('Ctrl+Shift+M')!();
    expect(os.fired).toEqual(['mute']);
  });

  it('o atalho em uso volta sozinho quando o outro programa solta', () => {
    const os = fakeOs();
    os.taken.add('Shift+F10');
    os.reg.set({ clip: 'Shift+F10' });
    vi.advanceTimersByTime(SHORTCUT_RETRY_MS * 3);
    expect(os.mine.has('Shift+F10')).toBe(false);
    os.taken.delete('Shift+F10');
    vi.advanceTimersByTime(SHORTCUT_RETRY_MS);
    expect(os.recovered).toEqual(['Shift+F10']);
    expect(os.reg.waiting).toEqual([]);
    os.mine.get('Shift+F10')!();
    expect(os.fired).toEqual(['clip']);
    // registrado: para de tentar (não chama de novo nem duplica)
    vi.advanceTimersByTime(SHORTCUT_RETRY_MS * 5);
    expect(os.recovered).toEqual(['Shift+F10']);
  });

  it('acelerador inválido falha e não fica sendo tentado', () => {
    const os = fakeOs();
    const r = os.reg.set({ clip: 'Bad+Key' });
    expect(r.failed).toEqual(['Bad+Key']);
    expect(os.reg.waiting).toEqual([]);
  });

  it('trocar os atalhos ou encerrar para as tentativas antigas', () => {
    const os = fakeOs();
    os.taken.add('Shift+F10');
    os.reg.set({ clip: 'Shift+F10' });
    os.reg.set({ clip: 'Shift+F9' });
    expect(os.reg.waiting).toEqual([]);
    os.taken.delete('Shift+F10');
    vi.advanceTimersByTime(SHORTCUT_RETRY_MS * 2);
    expect(os.mine.has('Shift+F10')).toBe(false);
    expect(os.mine.has('Shift+F9')).toBe(true);
    os.taken.add('Shift+F11');
    os.reg.set({ clip: 'Shift+F11' });
    os.reg.dispose();
    os.taken.delete('Shift+F11');
    vi.advanceTimersByTime(SHORTCUT_RETRY_MS * 2);
    expect(os.mine.size).toBe(0);
  });
});
