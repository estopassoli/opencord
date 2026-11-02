import { describe, expect, it } from 'vitest';
import { Accelerator } from '../electron/shared/ipc';
import { acceleratorKey, formatAccelerator, formatCode, needsModifier, pushToTalkAccelerator } from '../src/lib/keys';

describe('teclas de atalho (qualquer tecla do teclado)', () => {
  it('converte teclas especiais, numérico, mídia e pontuação em aceleradores do Electron', () => {
    expect(acceleratorKey('Insert')).toBe('Insert');
    expect(acceleratorKey('PageDown')).toBe('PageDown');
    expect(acceleratorKey('End')).toBe('End');
    expect(acceleratorKey('ScrollLock')).toBe('Scrolllock');
    expect(acceleratorKey('CapsLock')).toBe('Capslock');
    expect(acceleratorKey('Numpad5')).toBe('num5');
    expect(acceleratorKey('NumpadAdd')).toBe('numadd');
    expect(acceleratorKey('ArrowUp')).toBe('Up');
    expect(acceleratorKey('MediaPlayPause')).toBe('MediaPlayPause');
    expect(acceleratorKey('Backquote')).toBe('`');
    expect(acceleratorKey('KeyV')).toBe('V');
    expect(acceleratorKey('F13')).toBe('F13');
    expect(acceleratorKey('Pause')).toBeNull();
    expect(acceleratorKey('ControlLeft')).toBeNull();
  });
  it('tudo que a captura aceita passa na gramática que o Electron valida', () => {
    const codes = [
      'Insert',
      'PageDown',
      'End',
      'ScrollLock',
      'CapsLock',
      'NumLock',
      'PrintScreen',
      'Numpad0',
      'NumpadDecimal',
      'NumpadMultiply',
      'ArrowLeft',
      'Enter',
      'NumpadEnter',
      'Escape',
      'Space',
      'Tab',
      'Backspace',
      'Delete',
      'Home',
      'AudioVolumeMute',
      'MediaTrackNext',
      'Backslash',
      'Slash',
      'Quote',
      'F24',
      'KeyA',
      'Digit0',
    ];
    for (const c of codes) {
      const key = acceleratorKey(c);
      expect(key, c).not.toBeNull();
      const acc = needsModifier(c) ? `CommandOrControl+Shift+${key}` : key!;
      expect(Accelerator.safeParse(acc).success, acc).toBe(true);
    }
  });
  it('só letras, números e pontuação exigem modificador', () => {
    expect(needsModifier('KeyA')).toBe(true);
    expect(needsModifier('Digit7')).toBe(true);
    expect(needsModifier('Comma')).toBe(true);
    expect(needsModifier('Insert')).toBe(false);
    expect(needsModifier('Numpad3')).toBe(false);
    expect(needsModifier('F5')).toBe(false);
  });
  it('rótulos legíveis', () => {
    expect(formatCode('PageDown')).toBe('Page Down');
    expect(formatCode('ScrollLock')).toBe('Scroll Lock');
    expect(formatCode('KeyV')).toBe('V');
    expect(formatCode('Numpad7')).toBe('Num 7');
    expect(formatCode('ShiftLeft')).toBe('Shift (esq.)');
    expect(formatAccelerator('CommandOrControl+Shift+M')).toBe('Ctrl + Shift + M');
    expect(formatAccelerator('Alt+PageDown')).toBe('Alt + Page Down');
    expect(formatAccelerator('num5')).toBe('Num 5');
    expect(formatAccelerator('Capslock')).toBe('Caps Lock');
  });
  it('pressionar para falar: o código vira acelerador global só quando a tecla vale sozinha', () => {
    expect(pushToTalkAccelerator('Insert')).toBe('Insert');
    expect(pushToTalkAccelerator('Numpad0')).toBe('num0');
    expect(pushToTalkAccelerator('KeyV')).toBeNull();
    expect(pushToTalkAccelerator(null)).toBeNull();
  });
});
