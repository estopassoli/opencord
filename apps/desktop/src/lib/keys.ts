/**
 * Teclas de atalho: KeyboardEvent.code → acelerador do Electron (globalShortcut) e rótulos legíveis.
 * Qualquer tecla física entra (Insert, Page Down, End, Scroll Lock, Caps Lock, teclado numérico, mídia…);
 * só letras, números e pontuação exigem modificador, porque sozinhas atrapalhariam a digitação em outros apps.
 */

/** Teclas especiais: código do teclado → nome de acelerador do Electron e rótulo. */
const SPECIAL: Record<string, [accel: string, label: string]> = {
  Space: ['Space', 'Espaço'],
  Tab: ['Tab', 'Tab'],
  Backspace: ['Backspace', 'Backspace'],
  Delete: ['Delete', 'Delete'],
  Insert: ['Insert', 'Insert'],
  Home: ['Home', 'Home'],
  End: ['End', 'End'],
  PageUp: ['PageUp', 'Page Up'],
  PageDown: ['PageDown', 'Page Down'],
  ArrowUp: ['Up', 'Seta ↑'],
  ArrowDown: ['Down', 'Seta ↓'],
  ArrowLeft: ['Left', 'Seta ←'],
  ArrowRight: ['Right', 'Seta →'],
  Enter: ['Return', 'Enter'],
  NumpadEnter: ['Enter', 'Num Enter'],
  Escape: ['Escape', 'Esc'],
  CapsLock: ['Capslock', 'Caps Lock'],
  NumLock: ['Numlock', 'Num Lock'],
  ScrollLock: ['Scrolllock', 'Scroll Lock'],
  PrintScreen: ['PrintScreen', 'Print Screen'],
  NumpadDecimal: ['numdec', 'Num ,'],
  NumpadAdd: ['numadd', 'Num +'],
  NumpadSubtract: ['numsub', 'Num −'],
  NumpadMultiply: ['nummult', 'Num ×'],
  NumpadDivide: ['numdiv', 'Num ÷'],
  AudioVolumeUp: ['VolumeUp', 'Volume +'],
  AudioVolumeDown: ['VolumeDown', 'Volume −'],
  AudioVolumeMute: ['VolumeMute', 'Mudo'],
  MediaPlayPause: ['MediaPlayPause', 'Play/Pause'],
  MediaStop: ['MediaStop', 'Parar mídia'],
  MediaTrackNext: ['MediaNextTrack', 'Próxima faixa'],
  MediaTrackPrevious: ['MediaPreviousTrack', 'Faixa anterior'],
};

/** Pontuação: código → caractere do acelerador (o Electron aceita o símbolo). */
const PUNCT: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
};

export const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

/** Tecla de acelerador do Electron para um KeyboardEvent.code, ou null se o Electron não a registra. */
export function acceleratorKey(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit?.[1]) return digit[1];
  const num = /^Numpad([0-9])$/.exec(code);
  if (num?.[1]) return `num${num[1]}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return SPECIAL[code]?.[0] ?? PUNCT[code] ?? null;
}

/** Sozinha, a tecla atrapalharia a digitação em outros programas (atalho global exige modificador). */
export function needsModifier(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9])$/.test(code) || code in PUNCT;
}

/** Texto legível para um KeyboardEvent.code (ex.: "KeyV" → "V", "PageDown" → "Page Down"). */
export function formatCode(code: string): string {
  const special = SPECIAL[code]?.[1];
  if (special) return special;
  if (code in PUNCT) return PUNCT[code] ?? code;
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace(/Left$|Right$/, (m) => (m === 'Left' ? ' (esq.)' : ' (dir.)'));
}

const ACCEL_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(SPECIAL).map(([accel, label]) => [accel.toLowerCase(), label]),
);

/** Texto legível para um acelerador ("CommandOrControl+Shift+M" → "Ctrl + Shift + M"). */
export function formatAccelerator(acc: string): string {
  return acc
    .split('+')
    .map((p) => {
      if (p === 'CommandOrControl') return 'Ctrl';
      const num = /^num([0-9])$/.exec(p);
      if (num) return `Num ${num[1]}`;
      return ACCEL_LABEL[p.toLowerCase()] ?? p;
    })
    .join(' + ');
}

/**
 * Acelerador global para a tecla de pressionar para falar (guardada como código do teclado).
 * Fora da janela o atalho funciona como alternância (ADR-0005); letras e números sozinhos não viram atalho global.
 */
export function pushToTalkAccelerator(code: string | null): string | null {
  if (!code) return null;
  const key = acceleratorKey(code);
  if (!key || needsModifier(code)) return null;
  return key;
}
