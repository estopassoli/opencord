/**
 * Atalhos do Espaço 3D (ADR-0055), personalizáveis no menu de pausa e guardados neste computador.
 * Cada ação tem um "código": tecla (`KeyW`, `Space`, `Shift`…) ou botão do mouse (`Mouse0` esquerdo, `Mouse1` meio,
 * `Mouse2` direito). As setas sempre andam também. Esc é do navegador (solta o mouse e abre o menu): não dá para usar.
 * Convenção de PC: W A S D andar, Q/E girar a câmera, Tab segurado mostra o placar, R revanche, F interagir,
 * H mostra os comandos, botão do meio solta o cursor e Alt segurado olha em volta (visão livre).
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
  'turnLeft',
  'turnRight',
  'scoreboard',
  'rematch',
  'decline',
  'help',
  'cursor',
  'freeLook',
  'crouch',
  'view',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Andar para a frente',
  back: 'Andar para trás',
  left: 'Andar para a esquerda',
  right: 'Andar para a direita',
  run: 'Correr (segurar) · gunfight: um toque corre, outro toque liga a corrida tática',
  jump: 'Pular',
  wave: 'Acenar · gunfight: inspecionar a arma',
  interact: 'Interagir · pegar a bola · desafiar · gunfight: coronhada',
  primary: 'Ação: bater, chutar, tacar, socar, turbo · gunfight: atirar',
  secondary: 'Defender no x1 (segurar) · gunfight: mirar',
  turnLeft: 'Girar a câmera para a esquerda',
  turnRight: 'Girar a câmera para a direita',
  scoreboard: 'Ver o placar (segurar)',
  rematch: 'Começar partida · revanche · gunfight: recarregar',
  decline: 'Recusar um convite de x1',
  help: 'Mostrar ou esconder os comandos',
  cursor: 'Soltar o cursor (sem abrir o menu)',
  freeLook: 'Visão livre (segurar)',
  crouch: 'Gunfight: agachar · correndo, deslizar',
  view: 'Gunfight: primeira ou terceira pessoa',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'Shift',
  jump: 'Space',
  wave: 'KeyG',
  interact: 'KeyF',
  primary: 'Mouse0',
  secondary: 'Mouse2',
  turnLeft: 'KeyQ',
  turnRight: 'KeyE',
  scoreboard: 'Tab',
  rematch: 'KeyR',
  decline: 'KeyX',
  help: 'KeyH',
  cursor: 'Mouse1',
  freeLook: 'Alt',
  crouch: 'KeyC',
  view: 'KeyV',
};

/**
 * Padrões antigos que mudaram (2026-11-09: E passou a girar a câmera, acenar foi para G). Um mapa salvo antes disso
 * guarda o padrão antigo sem a pessoa ter escolhido: ele volta ao padrão novo.
 */
const LEGACY_DEFAULTS: Partial<Record<Action, string>> = { wave: 'KeyE' };

/** teclas livres para uma ação nova quando o padrão dela já foi escolhido pela pessoa para outra coisa */
const SPARE_CODES = ['KeyZ', 'KeyB', 'KeyJ', 'KeyK', 'KeyL', 'KeyN', 'KeyM', 'KeyT', 'KeyY'];

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
    return fromSaved(JSON.parse(raw) as Partial<Record<Action, unknown>>);
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

/**
 * Mapa salvo → mapa completo. Valor estragado volta ao padrão. Ação nova (que o mapa salvo não conhece) nunca rouba a
 * tecla que a pessoa escolheu: se o padrão dela estiver ocupado, ela fica com uma tecla livre.
 */
export function fromSaved(v: Partial<Record<Action, unknown>>): Record<Action, string> {
  const out = { ...DEFAULT_BINDINGS };
  const chosen = new Set<Action>();
  const old = ACTIONS.some((a) => !(a in v));
  for (const a of ACTIONS) {
    const c = v[a];
    if (typeof c !== 'string' || c.length === 0 || c.length >= 32 || c === 'Escape') continue;
    if (old && LEGACY_DEFAULTS[a] === c) continue;
    out[a] = c;
    chosen.add(a);
  }
  for (const a of ACTIONS) {
    if (chosen.has(a)) continue;
    const clash = ACTIONS.some(
      (b) => b !== a && out[b] === out[a] && (chosen.has(b) || ACTIONS.indexOf(b) < ACTIONS.indexOf(a)),
    );
    if (!clash) continue;
    const used = new Set(ACTIONS.map((b) => out[b]));
    out[a] = SPARE_CODES.find((k) => !used.has(k)) ?? out[a];
  }
  return out;
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
