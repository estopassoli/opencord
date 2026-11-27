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

/** teclas virtuais do Windows (as de pontuação são as do teclado americano, como no `RegisterHotKey` do plugin) */
const VK: Record<string, number> = {
  Space: 0x20,
  Tab: 0x09,
  Backspace: 0x08,
  Delete: 0x2e,
  Insert: 0x2d,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  Up: 0x26,
  Down: 0x28,
  Left: 0x25,
  Right: 0x27,
  Return: 0x0d,
  Enter: 0x0d,
  Escape: 0x1b,
  Capslock: 0x14,
  Numlock: 0x90,
  Scrolllock: 0x91,
  PrintScreen: 0x2c,
  VolumeUp: 0xaf,
  VolumeDown: 0xae,
  VolumeMute: 0xad,
  MediaPlayPause: 0xb3,
  MediaStop: 0xb2,
  MediaNextTrack: 0xb0,
  MediaPreviousTrack: 0xb1,
  numdec: 0x6e,
  numadd: 0x6b,
  numsub: 0x6d,
  nummult: 0x6a,
  numdiv: 0x6f,
  '`': 0xc0,
  '-': 0xbd,
  '=': 0xbb,
  '[': 0xdb,
  ']': 0xdd,
  ';': 0xba,
  "'": 0xde,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  '\\': 0xdc,
};

/** modificadores no formato do gancho de teclado (keyhook.rs): Ctrl 1, Alt 2, Shift 4, Win 8 */
const VK_MODS: Record<string, number> = {
  CommandOrControl: 1,
  Control: 1,
  Ctrl: 1,
  Alt: 2,
  Shift: 4,
  Super: 8,
  Meta: 8,
};

/**
 * Acelerador do Electron → tecla virtual e modificadores, para o gancho de teclado de baixo nível do app em Tauri
 * (`keyhook_set`). `null` = tecla que o gancho não conhece (fica só no atalho global).
 */
export function toVirtualKey(accel: string): { mods: number; vk: number } | null {
  const parts = accel.split('+');
  const key = parts.pop() ?? '';
  let mods = 0;
  for (const m of parts) {
    const bit = VK_MODS[m];
    if (!bit) return null;
    mods |= bit;
  }
  let vk = VK[key];
  if (vk === undefined) {
    if (/^[A-Z]$/.test(key)) vk = key.charCodeAt(0);
    else if (/^[0-9]$/.test(key)) vk = key.charCodeAt(0);
    else if (/^num[0-9]$/.test(key)) vk = 0x60 + Number(key.slice(3));
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) vk = 0x70 + Number(key.slice(1)) - 1;
    else return null;
  }
  return { mods, vk };
}
