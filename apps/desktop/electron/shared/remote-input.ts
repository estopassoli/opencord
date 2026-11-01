/**
 * Controle remoto (ADR-0026): eventos de mouse e teclado que a janela de quem foi controlado repassa ao processo
 * principal, e a tabela de teclas. A tecla viaja pela posição física (`KeyboardEvent.code`), não pela letra: um teclado
 * ABNT de um lado e um americano do outro digitam o que o layout do PC controlado manda. Sem dependências do Electron:
 * a janela também usa a tabela para só mandar teclas conhecidas.
 */
import { z } from 'zod';

/** scancode do conjunto 1 e se é tecla estendida (prefixo E0) */
export const SCANCODES: Record<string, readonly [number, boolean]> = {
  Escape: [0x01, false],
  Digit1: [0x02, false],
  Digit2: [0x03, false],
  Digit3: [0x04, false],
  Digit4: [0x05, false],
  Digit5: [0x06, false],
  Digit6: [0x07, false],
  Digit7: [0x08, false],
  Digit8: [0x09, false],
  Digit9: [0x0a, false],
  Digit0: [0x0b, false],
  Minus: [0x0c, false],
  Equal: [0x0d, false],
  Backspace: [0x0e, false],
  Tab: [0x0f, false],
  KeyQ: [0x10, false],
  KeyW: [0x11, false],
  KeyE: [0x12, false],
  KeyR: [0x13, false],
  KeyT: [0x14, false],
  KeyY: [0x15, false],
  KeyU: [0x16, false],
  KeyI: [0x17, false],
  KeyO: [0x18, false],
  KeyP: [0x19, false],
  BracketLeft: [0x1a, false],
  BracketRight: [0x1b, false],
  Enter: [0x1c, false],
  ControlLeft: [0x1d, false],
  KeyA: [0x1e, false],
  KeyS: [0x1f, false],
  KeyD: [0x20, false],
  KeyF: [0x21, false],
  KeyG: [0x22, false],
  KeyH: [0x23, false],
  KeyJ: [0x24, false],
  KeyK: [0x25, false],
  KeyL: [0x26, false],
  Semicolon: [0x27, false],
  Quote: [0x28, false],
  Backquote: [0x29, false],
  ShiftLeft: [0x2a, false],
  Backslash: [0x2b, false],
  KeyZ: [0x2c, false],
  KeyX: [0x2d, false],
  KeyC: [0x2e, false],
  KeyV: [0x2f, false],
  KeyB: [0x30, false],
  KeyN: [0x31, false],
  KeyM: [0x32, false],
  Comma: [0x33, false],
  Period: [0x34, false],
  Slash: [0x35, false],
  ShiftRight: [0x36, false],
  NumpadMultiply: [0x37, false],
  AltLeft: [0x38, false],
  Space: [0x39, false],
  CapsLock: [0x3a, false],
  F1: [0x3b, false],
  F2: [0x3c, false],
  F3: [0x3d, false],
  F4: [0x3e, false],
  F5: [0x3f, false],
  F6: [0x40, false],
  F7: [0x41, false],
  F8: [0x42, false],
  F9: [0x43, false],
  F10: [0x44, false],
  NumLock: [0x45, true],
  ScrollLock: [0x46, false],
  Numpad7: [0x47, false],
  Numpad8: [0x48, false],
  Numpad9: [0x49, false],
  NumpadSubtract: [0x4a, false],
  Numpad4: [0x4b, false],
  Numpad5: [0x4c, false],
  Numpad6: [0x4d, false],
  NumpadAdd: [0x4e, false],
  Numpad1: [0x4f, false],
  Numpad2: [0x50, false],
  Numpad3: [0x51, false],
  Numpad0: [0x52, false],
  NumpadDecimal: [0x53, false],
  // tecla extra ao lado do Shift esquerdo (ISO) e a do "/?" do ABNT2, e o "." do teclado numérico do ABNT2
  IntlBackslash: [0x56, false],
  F11: [0x57, false],
  F12: [0x58, false],
  IntlRo: [0x73, false],
  NumpadComma: [0x7e, false],
  NumpadEnter: [0x1c, true],
  ControlRight: [0x1d, true],
  NumpadDivide: [0x35, true],
  PrintScreen: [0x37, true],
  AltRight: [0x38, true],
  Home: [0x47, true],
  ArrowUp: [0x48, true],
  PageUp: [0x49, true],
  ArrowLeft: [0x4b, true],
  ArrowRight: [0x4d, true],
  End: [0x4f, true],
  ArrowDown: [0x50, true],
  PageDown: [0x51, true],
  Insert: [0x52, true],
  Delete: [0x53, true],
  MetaLeft: [0x5b, true],
  MetaRight: [0x5c, true],
  ContextMenu: [0x5d, true],
};

export const KeyCode = z.string().refine((c) => Object.hasOwn(SCANCODES, c), 'tecla desconhecida');

/** posição relativa na tela controlada (0–1, canto superior esquerdo = 0,0) */
const Pos = z.number().min(0).max(1);
export const MouseButton = z.enum(['left', 'middle', 'right', 'back', 'forward']);
export type MouseButton = z.infer<typeof MouseButton>;
export const BUTTON_INDEX: Record<MouseButton, number> = { left: 0, middle: 1, right: 2, back: 3, forward: 4 };
const Wheel = z.number().int().min(-1200).max(1200);

export const RemoteInputEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), x: Pos, y: Pos }),
  z.object({ type: z.literal('button'), button: MouseButton, down: z.boolean(), x: Pos, y: Pos }),
  z.object({ type: z.literal('wheel'), dx: Wheel, dy: Wheel }),
  z.object({ type: z.literal('key'), code: KeyCode, down: z.boolean() }),
  /** solta tudo que estiver apertado (quem controla perdeu o foco da janela) */
  z.object({ type: z.literal('release') }),
]);
export type RemoteInputEvent = z.infer<typeof RemoteInputEvent>;

export const RemoteInputStartArgs = z.object({
  /** a tela da live (janela não serve: ela muda de lugar e de tamanho) */
  sourceId: z.string().regex(/^screen:[\w:-]{1,64}$/),
  /** nome de quem vai controlar, para a faixa no topo da tela */
  controller: z.string().trim().min(1).max(64),
});
export type RemoteInputStartArgs = z.infer<typeof RemoteInputStartArgs>;

/** texto colado por quem controla (vai para a área de transferência deste PC antes do Ctrl+V) */
export const RemoteClipboardArgs = z.object({ text: z.string().max(12_000) });
export type RemoteClipboardArgs = z.infer<typeof RemoteClipboardArgs>;
/** pedaço de um arquivo enviado por quem controla (gravado em Downloads/OpenCord) */
export const RemoteFileChunkArgs = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().min(1).max(200),
  size: z
    .number()
    .int()
    .min(0)
    .max(25 * 1024 * 1024),
  index: z.number().int().min(0),
  total: z.number().int().min(1).max(2000),
  data: z.instanceof(Uint8Array).refine((d) => d.byteLength <= 16_384),
});
export type RemoteFileChunkArgs = z.infer<typeof RemoteFileChunkArgs>;
export type RemoteFileResult = { done: false } | { done: true; path: string };

/** atalho de emergência: corta o controle mesmo com o OpenCord escondido */
export const REMOTE_PANIC_ACCEL = 'Control+Alt+Shift+S';
export const REMOTE_PANIC_LABEL = 'Ctrl+Alt+Shift+S';

/** por que o controle parou do lado do processo principal */
export type RemoteInputStop = 'panic' | 'banner' | 'exit';

/** Retângulo em pixels físicos → linha de comando do oc-input. Puro, para teste. */
export function inputLine(ev: RemoteInputEvent, rect: { x: number; y: number; width: number; height: number }) {
  const px = (x: number, y: number) =>
    `${Math.round(rect.x + x * (rect.width - 1))} ${Math.round(rect.y + y * (rect.height - 1))}`;
  switch (ev.type) {
    case 'move':
      return [`m ${px(ev.x, ev.y)}`];
    case 'button':
      return [`m ${px(ev.x, ev.y)}`, `b ${BUTTON_INDEX[ev.button]} ${ev.down ? 1 : 0}`];
    case 'wheel':
      return [`w ${ev.dx} ${ev.dy}`];
    case 'key': {
      const [scan, ext] = SCANCODES[ev.code] as readonly [number, boolean];
      return [`k ${scan} ${ext ? 1 : 0} ${ev.down ? 1 : 0}`];
    }
    case 'release':
      return ['r'];
  }
}
