/**
 * Atalhos do Espaço 3D (ADR-0055), personalizáveis no menu de pausa e guardados neste computador.
 * Cada ação tem um "código": tecla (`KeyW`, `Space`, `Shift`…) ou botão do mouse (`Mouse0` esquerdo, `Mouse1` meio,
 * `Mouse2` direito). As setas sempre andam também. Esc é do navegador (solta o mouse e abre a pausa): não dá para usar.
 */
import { create } from 'zustand';

export const ACTIONS = [
  'forward',
  'back',
  'left',
  'right',
  'run',
  'jump',
  'wave',
  'interact',
  'primary',
  'secondary',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Andar para a frente',
  back: 'Andar para trás',
  left: 'Andar para a esquerda',
  right: 'Andar para a direita',
  run: 'Correr (segurar)',
  jump: 'Pular',
  wave: 'Acenar',
  interact: 'Interagir · pegar a bola · desafiar',
  primary: 'Ação: bater, chutar, tacar, socar, turbo',
  secondary: 'Defender no x1 (segurar)',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'Shift',
  jump: 'Space',
  wave: 'KeyE',
  interact: 'KeyF',
  primary: 'Mouse0',
  secondary: 'Mouse2',
};

const KEY = 'opencord.space3d.bindings';

/** Shift/Ctrl/Alt da esquerda e da direita contam como o mesmo */
export function normalizeCode(code: string): string {
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Control';
  if (code.startsWith('Alt')) return 'Alt';
  if (code.startsWith('Meta')) return 'Meta';
  return code;
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Espaço',
  Shift: 'Shift',
  Control: 'Ctrl',
  Alt: 'Alt',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse0: 'Botão esquerdo',
  Mouse1: 'Botão do meio',
  Mouse2: 'Botão direito',
  Mouse3: 'Botão lateral 1',
  Mouse4: 'Botão lateral 2',
};

/** nome curto para mostrar (W, Espaço, Shift, Botão esquerdo…) */
export function codeLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export const isMouse = (code: string) => code.startsWith('Mouse');

function load(): Record<Action, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    const v = JSON.parse(raw) as Partial<Record<Action, unknown>>;
    const out = { ...DEFAULT_BINDINGS };
    for (const a of ACTIONS) {
      const c = v[a];
      if (typeof c === 'string' && c.length > 0 && c.length < 32 && c !== 'Escape') out[a] = c;
    }
    return out;
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

interface BindingsStore {
  map: Record<Action, string>;
  /** troca o atalho; se o código já era de outra ação, as duas trocam */
  set(action: Action, code: string): void;
  reset(): void;
}

function save(map: Record<Action, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* sem armazenamento (janela privada): vale só nesta sessão */
  }
}

export const useBindings = create<BindingsStore>()((setState, get) => ({
  map: load(),
  set(action, code) {
    const c = normalizeCode(code);
    if (c === 'Escape') return;
    const map = { ...get().map };
    const other = ACTIONS.find((a) => a !== action && map[a] === c);
    if (other) map[other] = map[action];
    map[action] = c;
    save(map);
    setState({ map });
  },
  reset() {
    save(DEFAULT_BINDINGS);
    setState({ map: { ...DEFAULT_BINDINGS } });
  },
}));

/** ações ligadas a um código (tecla ou botão) */
export function actionsOf(code: string, map = useBindings.getState().map): Action[] {
  const c = normalizeCode(code);
  return ACTIONS.filter((a) => map[a] === c);
}
