/**
 * Contrato IPC renderer ↔ main. ÚNICA superfície exposta ao renderer (via preload/contextBridge).
 * Todo argumento é validado no main com estes schemas; canais fora da allowlist não existem.
 */
import { z } from 'zod';

export { IPC } from './channels';

export const SecureKey = z.enum(['session', 'serverUrl']);
export type SecureKey = z.infer<typeof SecureKey>;

export const CaptureSelectArgs = z.object({
  sourceId: z.string().regex(/^(screen|window):[\w:-]{1,64}$/),
  systemAudio: z.boolean(),
});
export type CaptureSelectArgs = z.infer<typeof CaptureSelectArgs>;

export const NotifyArgs = z.object({
  title: z.string().max(120),
  body: z.string().max(400),
  /** rota interna para abrir ao clicar (validada como caminho relativo) */
  route: z
    .string()
    .max(200)
    .regex(/^\/[\w\-/]*$/)
    .optional(),
  silent: z.boolean().optional(),
});
export type NotifyArgs = z.infer<typeof NotifyArgs>;

/** Acelerador Electron (ex.: CommandOrControl+Shift+M). Validado contra uma gramática restrita. */
export const Accelerator = z
  .string()
  .max(64)
  .regex(
    /^((CommandOrControl|Control|Ctrl|Alt|Shift|Super|Meta)\+){0,3}([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Num[0-9]|`|-|=|\[|\]|;|'|,|\.|\/)$/,
  );

export const ShortcutsArgs = z.object({
  toggleMute: Accelerator.nullable(),
  toggleDeafen: Accelerator.nullable(),
  /** PTT global em modo alternância (globalShortcut não informa key-up; ver docs/adr/0005). */
  pushToTalkToggle: Accelerator.nullable(),
});
export type ShortcutsArgs = z.infer<typeof ShortcutsArgs>;

export const ShortcutResult = z.object({ registered: z.array(z.string()), failed: z.array(z.string()) });
export type ShortcutResult = z.infer<typeof ShortcutResult>;

export const ExternalUrl = z.url().refine((u) => /^https?:\/\//i.test(u), 'apenas http(s)');

export const TrayVoiceState = z.object({ inVoice: z.boolean(), muted: z.boolean(), deafened: z.boolean() });
export type TrayVoiceState = z.infer<typeof TrayVoiceState>;

export interface CaptureSourceDto {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  appIcon?: string;
  displayId?: string;
}

export type ShortcutAction = 'toggleMute' | 'toggleDeafen' | 'pushToTalkToggle';
export type TrayAction = 'toggleMute' | 'toggleDeafen' | 'disconnect' | 'show';

/** Atualização "avisar e baixar": Windows baixa e fica `ready`; macOS/Linux ficam `available` (abre o download). */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string; progress: number }
  | { state: 'ready'; version: string }
  | { state: 'available'; version: string; url: string };

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  osRelease: string;
  secureStorage: boolean;
}

/** API exposta em `window.opencord`. */
export interface OpenCordBridge {
  capture: {
    listSources(): Promise<CaptureSourceDto[]>;
    /** Autoriza a PRÓXIMA chamada a getDisplayMedia a usar esta fonte (e áudio do sistema se pedido). */
    select(args: CaptureSelectArgs): Promise<void>;
  };
  secure: {
    get(key: SecureKey): Promise<string | null>;
    set(key: SecureKey, value: string): Promise<void>;
    delete(key: SecureKey): Promise<void>;
  };
  notify(args: NotifyArgs): Promise<void>;
  setShortcuts(args: ShortcutsArgs): Promise<ShortcutResult>;
  flashFrame(): Promise<void>;
  focusWindow(): Promise<void>;
  setBadge(count: number): Promise<void>;
  setTrayVoiceState(state: TrayVoiceState): Promise<void>;
  appInfo(): Promise<AppInfo>;
  openExternal(url: string): Promise<void>;
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    /** Abre o instalador baixado e fecha o app (ou abre o download, fora do Windows). */
    install(): Promise<void>;
  };
  on(event: 'shortcut', cb: (action: ShortcutAction) => void): () => void;
  on(event: 'notification-click', cb: (route: string) => void): () => void;
  on(event: 'power-resume', cb: () => void): () => void;
  on(event: 'tray-action', cb: (action: TrayAction) => void): () => void;
  on(event: 'update', cb: (status: UpdateStatus) => void): () => void;
}
