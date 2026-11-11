/**
 * Acelerador no formato do Electron (o que a interface salva, validado por `Accelerator` em ipc.ts) → formato do
 * plugin de atalhos globais do Tauri (nomes de tecla do `KeyboardEvent.code`).
 */
const KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Return: 'Enter',
  Enter: 'Enter',
  Escape: 'Escape',
  Capslock: 'CapsLock',
  Numlock: 'NumLock',
  Scrolllock: 'ScrollLock',
  PrintScreen: 'PrintScreen',
  VolumeUp: 'AudioVolumeUp',
  VolumeDown: 'AudioVolumeDown',
  VolumeMute: 'AudioVolumeMute',
  MediaPlayPause: 'MediaPlayPause',
  MediaStop: 'MediaStop',
  MediaNextTrack: 'MediaTrackNext',
  MediaPreviousTrack: 'MediaTrackPrevious',
  numdec: 'NumpadDecimal',
  numadd: 'NumpadAdd',
  numsub: 'NumpadSubtract',
  nummult: 'NumpadMultiply',
  numdiv: 'NumpadDivide',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
};

const MODS: Record<string, string> = {
  CommandOrControl: 'CommandOrControl',
  Control: 'Control',
  Ctrl: 'Control',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Super',
  Meta: 'Super',
};

export function toTauriAccelerator(accel: string): string {
  const parts = accel.split('+');
  // "+" sozinho não é tecla válida no contrato, então o último pedaço é sempre a tecla
  const key = parts.pop() ?? '';
  const mods = parts.map((m) => MODS[m] ?? m);
  let k = KEYS[key];
  if (!k) {
    if (/^[A-Z]$/.test(key)) k = `Key${key}`;
    else if (/^[0-9]$/.test(key)) k = `Digit${key}`;
    else if (/^num[0-9]$/.test(key)) k = `Numpad${key.slice(3)}`;
    else k = key; // F1–F24
  }
  return [...mods, k].join('+');
}
