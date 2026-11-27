/** Atalhos do app em Tauri: o mesmo acelerador vai para o plugin (RegisterHotKey) e para o gancho de teclado. */
import { describe, expect, it } from 'vitest';
import { toTauriAccelerator, toVirtualKey } from '../../desktop-tauri/src/accelerator';

describe('acelerador → tecla do Windows (gancho de teclado)', () => {
  it('modificadores viram bits (Ctrl 1, Alt 2, Shift 4, Win 8) e F1–F24, letras e números viram a tecla virtual', () => {
    expect(toVirtualKey('Shift+F10')).toEqual({ mods: 4, vk: 0x79 });
    expect(toVirtualKey('CommandOrControl+Alt+M')).toEqual({ mods: 3, vk: 0x4d });
    expect(toVirtualKey('Ctrl+Shift+Alt+Super+F24')).toEqual({ mods: 15, vk: 0x87 });
    expect(toVirtualKey('F1')).toEqual({ mods: 0, vk: 0x70 });
    expect(toVirtualKey('Alt+7')).toEqual({ mods: 2, vk: 0x37 });
    expect(toVirtualKey('Control+num5')).toEqual({ mods: 1, vk: 0x65 });
    expect(toVirtualKey('Shift+numadd')).toEqual({ mods: 4, vk: 0x6b });
    expect(toVirtualKey('Alt+`')).toEqual({ mods: 2, vk: 0xc0 });
    expect(toVirtualKey('Ctrl+\\')).toEqual({ mods: 1, vk: 0xdc });
    expect(toVirtualKey('MediaPlayPause')).toEqual({ mods: 0, vk: 0xb3 });
  });

  it('tecla ou modificador desconhecido: fica só no atalho global', () => {
    expect(toVirtualKey('Shift+F25')).toBeNull();
    expect(toVirtualKey('Hyper+A')).toBeNull();
    expect(toVirtualKey('Shift+')).toBeNull();
  });

  it('o atalho global continua no formato do plugin', () => {
    expect(toTauriAccelerator('Shift+F10')).toBe('Shift+F10');
    expect(toTauriAccelerator('Ctrl+Up')).toBe('Control+ArrowUp');
  });
});
