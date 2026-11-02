/**
 * Contrato IPC renderer ↔ main. ÚNICA superfície exposta ao renderer (via preload/contextBridge).
 * Todo argumento é validado no main com estes schemas; canais fora da allowlist não existem.
 */
import { z } from 'zod';
import type {
  RemoteClipboardArgs,
  RemoteFileChunkArgs,
  RemoteFileResult,
  RemoteInputEvent,
  RemoteInputStartArgs,
  RemoteInputStop,
} from './remote-input';
import type { OverlayState } from './overlay';

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
    /^((CommandOrControl|Control|Ctrl|Alt|Shift|Super|Meta)\+){0,3}([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|num[0-9]|numdec|numadd|numsub|nummult|numdiv|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Return|Enter|Escape|Capslock|Numlock|Scrolllock|PrintScreen|VolumeUp|VolumeDown|VolumeMute|MediaPlayPause|MediaStop|MediaNextTrack|MediaPreviousTrack|`|-|=|\[|\]|;|'|,|\.|\/|\\)$/,
  );

export const ShortcutsArgs = z.object({
  toggleMute: Accelerator.nullable(),
  toggleDeafen: Accelerator.nullable(),
  /** PTT global em modo alternância (globalShortcut não informa key-up; ver docs/adr/0005). */
  pushToTalkToggle: Accelerator.nullable(),
  /** salvar clipe (ADR-0022) */
  saveClip: Accelerator.nullable().optional(),
});
export type ShortcutsArgs = z.infer<typeof ShortcutsArgs>;

export const ShortcutResult = z.object({ registered: z.array(z.string()), failed: z.array(z.string()) });
export type ShortcutResult = z.infer<typeof ShortcutResult>;

/** Controles da janela desenhados pelo app (a sobreposição nativa titleBarOverlay atrasava a interface). */
export const WindowControl = z.enum(['minimize', 'toggle-maximize', 'close']);
export type WindowControl = z.infer<typeof WindowControl>;
export interface WindowState {
  maximized: boolean;
}

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

export type ShortcutAction = 'toggleMute' | 'toggleDeafen' | 'pushToTalkToggle' | 'saveClip';
export type TrayAction = 'toggleMute' | 'toggleDeafen' | 'disconnect' | 'show';

/** Atualização "avisar e baixar": Windows baixa e fica `ready`; macOS/Linux ficam `available` (abre o download). */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'downloading'; version: string; progress: number }
  | { state: 'ready'; version: string }
  | { state: 'available'; version: string; url: string };

/**
 * Uso da placa de vídeo:
 * - full: tudo na GPU (interface, decodificação e codificação das lives);
 * - off: sem aceleração (tudo no processador, inclusive a live).
 * O antigo "ui-software" (disable-gpu-compositing) saiu: medido no E2E golive-fps, ele também tirava da placa a
 * codificação (OpenH264, live a 2,5 fps com cena pesada) e a decodificação das lives (FFmpeg). Quem o tinha volta a "full".
 */
export const GpuMode = z.enum(['full', 'off']);
export type GpuMode = z.infer<typeof GpuMode>;
export const AppPrefsSchema = z.object({ gpuMode: GpuMode }).strict();
export type AppPrefs = z.infer<typeof AppPrefsSchema>;

export interface AppPrefsState {
  /** O que está salvo (vale a partir da próxima abertura). */
  saved: AppPrefs;
  /** Modo em uso AGORA (muda só ao reiniciar o app). */
  activeGpuMode: GpuMode;
}

/** Jogo detectado no computador (ADR-0021). */
export interface DetectedGameDto {
  name: string;
  startedAt: number;
  steamAppId?: number;
  exe?: string;
  /** ícone do executável (PNG em data URL) */
  icon?: string;
}
export const GamesConfigureArgs = z.object({
  enabled: z.boolean(),
  custom: z.array(z.object({ exe: z.string().trim().min(1).max(128), name: z.string().trim().min(1).max(64) })).max(50),
});
export type GamesConfigureArgs = z.infer<typeof GamesConfigureArgs>;

/** Uma saída de áudio do Windows (ADR-0024). */
export interface WinAudioOutput {
  id: string;
  name: string;
  /** dispositivo padrão (o que o Chromium já grava) */
  default: boolean;
  /** dispositivo de comunicação padrão */
  comm: boolean;
}
export const WinAudioId = z.string().min(1).max(256);
/**
 * "Saída" especial: o som de todos os programas MENOS o OpenCord (process loopback do Windows), para o áudio do Go Live
 * não levar as vozes da chamada (ADR-0025). Precisa do Windows 10 build 20348+; sem ele, `start` devolve false.
 */
export const WIN_AUDIO_EXCEPT_SELF = 'except-self';
/** PCM float32 estéreo 48 kHz de uma saída */
export interface WinAudioChunk {
  id: string;
  pcm: Uint8Array;
}

/** Clipe pronto para gravar em Vídeos\OpenCord (ADR-0022). */
export const ClipSaveArgs = z.object({
  /** nome do jogo, vira parte do nome do arquivo */
  game: z.string().trim().max(64),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(10 * 60_000),
  icon: z
    .string()
    .max(16 * 1024)
    .regex(/^data:image\/png;base64,/)
    .optional(),
  steamAppId: z.number().int().positive().optional(),
  /** miniatura JPEG */
  thumb: z
    .instanceof(Uint8Array)
    .refine((d) => d.byteLength <= 512 * 1024)
    .optional(),
  data: z
    .instanceof(Uint8Array)
    .refine((d) => d.byteLength > 0 && d.byteLength <= 1024 * 1024 * 1024, 'tamanho inválido'),
});
export type ClipSaveArgs = z.infer<typeof ClipSaveArgs>;

/** Clipe na pasta de clipes (com os dados que o OpenCord guardou ao lado). */
export interface ClipInfo {
  file: string;
  name: string;
  game: string | null;
  icon: string | null;
  steamAppId: number | null;
  createdAt: number;
  durationMs: number;
  sizeBytes: number;
  /** miniatura (data URL JPEG) */
  thumb: string | null;
}
export const ClipPath = z.string().min(1).max(1024);
export const ClipExportArgs = z.object({
  kind: z.enum(['video', 'audio']),
  name: z.string().trim().max(120),
  data: z.instanceof(Uint8Array).refine((d) => d.byteLength > 0 && d.byteLength <= 1024 * 1024 * 1024),
});
export type ClipExportArgs = z.infer<typeof ClipExportArgs>;

/** Erro da janela registrado no crash-log.txt (sem conteúdo do usuário). */
export const ErrorReport = z.object({
  where: z.enum(['boundary', 'window', 'promise']),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  componentStack: z.string().max(8000).optional(),
});
export type ErrorReport = z.infer<typeof ErrorReport>;

/** memória de cada processo do app (Configurações → Sobre → Memória) */
export interface ProcessMetric {
  pid: number;
  type: string;
  /** working set, em MB */
  mb: number;
}

/** memória da janela por tipo (do próprio processo, via preload) — em MB */
export interface RendererMemory {
  /** heap JS usado */
  heap: number;
  /** ArrayBuffers/typed arrays fora do heap (áudio PCM, pedaços de vídeo, arquivos lidos) */
  external: number;
  /** alocado pelo motor de layout/mídia (Blink) */
  blink: number;
  /** memória privada do processo */
  privateMb: number;
}

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
  windowControl(action: WindowControl): Promise<void>;
  windowState(): Promise<WindowState>;
  setBadge(count: number): Promise<void>;
  setTrayVoiceState(state: TrayVoiceState): Promise<void>;
  appInfo(): Promise<AppInfo>;
  /** impressão digital do aparelho (hash dos MACs) para o bloqueio de dispositivo (ADR-0036); null sem interface */
  hardwareId(): Promise<string | null>;
  appMetrics(): Promise<ProcessMetric[]>;
  rendererMemory(): Promise<RendererMemory>;
  openExternal(url: string): Promise<void>;
  prefs: {
    get(): Promise<AppPrefsState>;
    set(prefs: AppPrefs): Promise<AppPrefsState>;
  };
  /** Fecha e abre o app de novo (para aplicar preferências como a aceleração de hardware). */
  relaunch(): Promise<void>;
  clips: {
    /** autoriza a PRÓXIMA getDisplayMedia a capturar a tela principal com o som do computador */
    prepareCapture(): Promise<boolean>;
    /** grava o clipe e devolve o caminho do arquivo */
    save(args: ClipSaveArgs): Promise<string>;
    /** abre a pasta com o arquivo selecionado (só dentro da pasta de clipes) */
    reveal(path: string): Promise<void>;
    list(): Promise<ClipInfo[]>;
    read(path: string): Promise<Uint8Array<ArrayBuffer>>;
    remove(path: string): Promise<void>;
    /** copia o arquivo para a área de transferência */
    copy(path: string): Promise<void>;
    /** "Salvar como" de um vídeo/áudio cortado; null se cancelou */
    exportFile(args: ClipExportArgs): Promise<string | null>;
    dir(): Promise<string>;
    chooseDir(): Promise<string>;
  };
  games: {
    /** liga/desliga a detecção e informa os jogos que a pessoa cadastrou */
    configure(args: GamesConfigureArgs): Promise<void>;
    /** programas abertos agora (executáveis), para cadastrar um jogo */
    processes(): Promise<string[]>;
    current(): Promise<DetectedGameDto | null>;
  };
  /** som de cada saída de áudio do Windows para os clipes (ADR-0024); vazio fora do Windows */
  winAudio: {
    list(): Promise<WinAudioOutput[]>;
    /** começa a mandar o PCM da saída pelo evento 'win-audio'; false se a captura não começou */
    start(id: string): Promise<boolean>;
    stop(id: string): Promise<void>;
  };
  /**
   * mouse e teclado de quem controla este PC (ADR-0026); só no Windows. `start` só depois que a pessoa aceitou o pedido;
   * false se não deu para começar (fora do Windows, tela não encontrada)
   */
  remoteInput: {
    available(): Promise<boolean>;
    start(args: RemoteInputStartArgs): Promise<boolean>;
    send(ev: RemoteInputEvent): void;
    stop(): Promise<void>;
    /** texto de quem controla vai para a área de transferência (só durante uma sessão) */
    clipboard(args: RemoteClipboardArgs): Promise<void>;
    /** pedaço de arquivo de quem controla; no último devolve o caminho em Downloads/OpenCord */
    fileChunk(args: RemoteFileChunkArgs): Promise<RemoteFileResult>;
    /** abre a pasta com o arquivo recebido selecionado (só dentro de Downloads/OpenCord) */
    revealFile(path: string): Promise<void>;
  };
  /** overlay no jogo (ADR-0027): a janela manda o estado; o processo principal mostra/esconde a janelinha */
  overlay: {
    update(state: OverlayState): void;
  };
  /** registra um erro da janela no crash-log.txt */
  reportError(report: ErrorReport): Promise<void>;
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    /** Abre o instalador baixado e fecha o app (ou abre o download, fora do Windows). */
    install(): Promise<void>;
  };
  on(event: 'shortcut', cb: (action: ShortcutAction) => void): () => void;
  on(event: 'notification-click', cb: (route: string) => void): () => void;
  on(event: 'power-resume', cb: () => void): () => void;
  /** a cada 30 s: há quantos segundos ninguém mexe no computador (ausente automático) */
  on(event: 'idle', cb: (idleSeconds: number) => void): () => void;
  on(event: 'tray-action', cb: (action: TrayAction) => void): () => void;
  on(event: 'update', cb: (status: UpdateStatus) => void): () => void;
  on(event: 'window-state', cb: (state: WindowState) => void): () => void;
  on(event: 'game', cb: (game: DetectedGameDto | null) => void): () => void;
  on(event: 'win-audio', cb: (chunk: WinAudioChunk) => void): () => void;
  /** o controle remoto parou deste lado (atalho de emergência, botão da faixa, oc-input encerrado) */
  on(event: 'remote-input-stop', cb: (reason: RemoteInputStop) => void): () => void;
}
