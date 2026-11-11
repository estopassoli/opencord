/**
 * `window.opencord` em cima do Tauri: o MESMO contrato do Electron (apps/desktop/electron/shared/ipc.ts), para a
 * interface (apps/desktop/src) rodar sem mudança. Os argumentos passam pelos mesmos schemas Zod antes de ir ao Rust.
 *
 * Diferenças conhecidas em relação ao Electron (protótipo de comparação):
 * - Go Live e clipes: o WebView2 não deixa o app escolher a fonte da captura; `listSources` devolve "escolher
 *   aplicativo" e "escolher tela", e a escolha acontece no seletor do próprio WebView2.
 * - Notificações sem clique para abrir a conversa; sem atualização automática; sem ícone do jogo detectado.
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, primaryMonitor, UserAttentionType } from '@tauri-apps/api/window';
import { isRegistered, register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { sendNotification } from '@tauri-apps/plugin-notification';
import {
  hasStreamingApp,
  pickableProcesses,
  pickGame,
  sameGame,
  type CustomGame,
  type DetectedGame,
} from '../../desktop/electron/shared/games-core';
import {
  AppPrefsSchema,
  CaptureSelectArgs,
  ClipExportArgs,
  ClipPath,
  ClipSaveArgs,
  ErrorReport,
  ExternalUrl,
  GamesConfigureArgs,
  NotifyArgs,
  SecureKey,
  ShortcutsArgs,
  TrayVoiceState,
  WinAudioId,
  WindowControl,
  type AppInfo,
  type AppPrefsState,
  type CaptureSourceDto,
  type NativeLiveEvent,
  type NativeLiveStartArgs,
  type ClipInfo,
  type DetectedGameDto,
  type OpenCordBridge,
  type ProcessMetric,
  type ShortcutAction,
  type UpdateStatus,
  type WinAudioOutput,
} from '../../desktop/electron/shared/ipc';
import { OverlayState } from '../../desktop/electron/shared/overlay';
import {
  inputLine,
  REMOTE_PANIC_ACCEL,
  RemoteClipboardArgs,
  RemoteFileChunkArgs,
  RemoteInputEvent,
  RemoteInputStartArgs,
  type RemoteFileResult,
  type RemoteInputStop,
} from '../../desktop/electron/shared/remote-input';
import { toTauriAccelerator } from './accelerator';

type Events =
  | 'shortcut'
  | 'notification-click'
  | 'power-resume'
  | 'idle'
  | 'tray-action'
  | 'update'
  | 'window-state'
  | 'game'
  | 'win-audio'
  | 'remote-input-stop'
  | 'streaming-app';
const listeners = new Map<string, Set<(arg: unknown) => void>>();
function fire(event: Events, arg?: unknown) {
  for (const cb of listeners.get(event) ?? []) {
    try {
      cb(arg);
    } catch (e) {
      console.error(e);
    }
  }
}

const win = getCurrentWindow();

/** JSON em base64 (UTF-8) para cabeçalhos do IPC (só aceitam ASCII). */
function b64json(v: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(v));
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- captura ----------

const pickerThumb = (label: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" rx="12" fill="#23262d"/><text x="320" y="190" fill="#b5bac1" font-family="Segoe UI, sans-serif" font-size="26" text-anchor="middle">${label}</text></svg>`,
  )}`;

const SOURCES: CaptureSourceDto[] = [
  {
    id: 'window:picker',
    name: 'Escolher aplicativo',
    kind: 'window',
    thumbnail: pickerThumb('Escolher na janela do Windows'),
  },
  {
    id: 'screen:picker',
    name: 'Escolher tela',
    kind: 'screen',
    thumbnail: pickerThumb('Escolher na janela do Windows'),
  },
];

// ---------- atalhos globais ----------

let shortcutAccels: string[] = [];
/** atalhos que outro programa já usava: tentados de novo até ficarem livres (como no Electron, `shortcut-registry.ts`) */
const shortcutPending = new Map<string, { accel: string; action: ShortcutAction }>();
let shortcutRetry: ReturnType<typeof setInterval> | null = null;
const SHORTCUT_RETRY_MS = 5_000;

/** registra um atalho já convertido; `false` = outro programa usa */
async function tryShortcut(t: string, action: ShortcutAction): Promise<boolean> {
  try {
    await register(t, (e) => {
      if (e.state === 'Pressed') fire('shortcut', action);
    });
    shortcutAccels.push(t);
    return true;
  } catch {
    return false;
  }
}

async function retryShortcuts() {
  for (const [t, p] of [...shortcutPending]) if (await tryShortcut(t, p.action)) shortcutPending.delete(t);
  if (!shortcutPending.size && shortcutRetry) {
    clearInterval(shortcutRetry);
    shortcutRetry = null;
  }
}

async function registerShortcuts(s: ShortcutsArgs) {
  if (shortcutRetry) clearInterval(shortcutRetry);
  shortcutRetry = null;
  shortcutPending.clear();
  await unregisterAll().catch(() => undefined);
  shortcutAccels = [];
  const registered: string[] = [];
  const failed: string[] = [];
  for (const [action, accel] of Object.entries(s) as [ShortcutAction, string | null | undefined][]) {
    if (!accel) continue;
    let t: string;
    try {
      t = toTauriAccelerator(accel);
    } catch {
      // a tecla não existe no Tauri: não adianta tentar de novo
      failed.push(accel);
      continue;
    }
    if (await tryShortcut(t, action)) registered.push(accel);
    else {
      // outro app já usa o atalho (ex.: o Shift+F10 de um gravador): volta sozinho quando ficar livre
      failed.push(accel);
      shortcutPending.set(t, { accel, action });
    }
  }
  // o unregisterAll acima também tirou o atalho de emergência do controle remoto
  await armPanic();
  if (shortcutPending.size) shortcutRetry = setInterval(() => void retryShortcuts(), SHORTCUT_RETRY_MS);
  return { registered, failed };
}

// ---------- detecção de jogos (mesma lógica do Electron: games-core) ----------

const games = {
  timer: null as ReturnType<typeof setInterval> | null,
  custom: [] as CustomGame[],
  current: null as DetectedGameDto | null,
  streamApp: false,
  busy: false,
  async exes(): Promise<string[]> {
    const list = await invoke<string[]>('processes').catch(() => [] as string[]);
    return [...new Set(list.map((n) => n.toLowerCase()))];
  },
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const [exes, steam] = await Promise.all([
        this.exes(),
        invoke<{ id: number; name: string | null }>('steam_running').catch(() => ({ id: 0, name: null })),
      ]);
      this.set(pickGame(exes, this.custom, steam.id, steam.name));
      const stream = hasStreamingApp(exes);
      if (stream !== this.streamApp) {
        this.streamApp = stream;
        fire('streaming-app', stream);
      }
    } finally {
      this.busy = false;
    }
  },
  set(g: DetectedGame | null) {
    if (sameGame(g, this.current)) return;
    this.current = g ? { ...g, startedAt: Date.now() } : null;
    fire('game', this.current);
  },
  configure(enabled: boolean, custom: CustomGame[]) {
    this.custom = custom;
    if (enabled && !this.timer) {
      this.timer = setInterval(() => void this.tick(), 15_000);
      void this.tick();
    } else if (!enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.set(null);
    } else if (enabled) void this.tick();
  },
};

// ---------- controle remoto ----------

let remote: { rect: { x: number; y: number; width: number; height: number } } | null = null;

async function armPanic() {
  if (!remote) return;
  const accel = toTauriAccelerator(REMOTE_PANIC_ACCEL);
  if (await isRegistered(accel).catch(() => false)) return;
  await register(accel, (e) => {
    if (e.state === 'Pressed') endRemote('panic');
  }).catch(() => undefined);
}

async function stopRemoteLocal() {
  if (!remote) return;
  remote = null;
  await unregister(toTauriAccelerator(REMOTE_PANIC_ACCEL)).catch(() => undefined);
  await invoke('banner_close').catch(() => undefined);
  await invoke('remote_input_stop').catch(() => undefined);
}

function endRemote(reason: RemoteInputStop) {
  if (!remote) return;
  void stopRemoteLocal();
  fire('remote-input-stop', reason);
}

// ---------- overlay ----------

let lastOverlay = '';

// ---------- a ponte ----------

const bridge: OpenCordBridge = {
  capture: {
    // seletor do próprio OpenCord (ADR-0062): telas e janelas com miniatura pelo oc-live, não o do WebView2
    listSources: () => invoke<CaptureSourceDto[]>('live_sources').catch(() => SOURCES),
    select: async (args) => {
      CaptureSelectArgs.parse(args);
      await invoke('boost_media_priority');
    },
  },
  nativeLive: {
    start: (args: NativeLiveStartArgs) => invoke<{ encoder: string; audio: boolean }>('live_start', { args }),
    stop: () => invoke('live_stop'),
    onEvent: (cb) => {
      const off = listen<NativeLiveEvent>('live-event', (e) => cb(e.payload));
      return () => void off.then((f) => f());
    },
  },
  secure: {
    get: (key) => invoke<string | null>('secure_get', { key: SecureKey.parse(key) }),
    set: (key, value) => invoke('secure_set', { key: SecureKey.parse(key), value }),
    delete: (key) => invoke('secure_delete', { key: SecureKey.parse(key) }),
  },
  notify: async (args) => {
    const n = NotifyArgs.parse(args);
    sendNotification({ title: n.title, body: n.body, ...(n.silent ? { silent: true } : {}) });
  },
  setShortcuts: async (args) => registerShortcuts(ShortcutsArgs.parse(args)),
  flashFrame: async () => {
    if (!(await win.isFocused())) await win.requestUserAttention(UserAttentionType.Informational);
  },
  focusWindow: async () => {
    await win.unminimize();
    await win.show();
    await win.setFocus();
  },
  windowControl: async (action) => {
    const a = WindowControl.parse(action);
    if (a === 'minimize') await win.minimize();
    else if (a === 'toggle-maximize') await win.toggleMaximize();
    // como o botão nativo no Electron: esconde na bandeja e a chamada continua
    else await win.hide();
  },
  windowState: async () => ({ maximized: await win.isMaximized() }),
  setBadge: (count) => invoke('set_badge', { count: Math.max(0, Math.min(9999, Math.trunc(count))) }),
  setTrayVoiceState: (state) => invoke('tray_voice_state', { state: TrayVoiceState.parse(state) }),
  appInfo: () => invoke<AppInfo>('app_info'),
  hardwareId: () => invoke<string | null>('hardware_id'),
  appMetrics: () => invoke<ProcessMetric[]>('app_metrics'),
  rendererMemory: async () => {
    // o WebView2 não dá as estatísticas do Blink; o heap JS vem do performance.memory do Chromium
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const mb = (b: number) => Math.round(b / (1024 * 1024));
    return { heap: m ? mb(m.usedJSHeapSize) : 0, external: 0, blink: 0, privateMb: 0 };
  },
  openExternal: (url) => invoke('open_external', { url: ExternalUrl.parse(url) }),
  prefs: {
    get: () => invoke<AppPrefsState>('prefs_get'),
    set: (prefs) => invoke<AppPrefsState>('prefs_set', { prefs: AppPrefsSchema.parse(prefs) }),
  },
  relaunch: () => invoke('relaunch'),
  clips: {
    // a tela é escolhida no seletor do WebView2 (que exige um clique da pessoa antes)
    prepareCapture: async () => true,
    save: async (args) => {
      const a = ClipSaveArgs.parse(args);
      const thumb = a.thumb ?? new Uint8Array(0);
      const body = new Uint8Array(thumb.byteLength + a.data.byteLength);
      body.set(thumb, 0);
      body.set(a.data, thumb.byteLength);
      const meta = {
        game: a.game,
        durationMs: a.durationMs,
        thumbLen: thumb.byteLength,
        ...(a.icon ? { icon: a.icon } : {}),
        ...(a.steamAppId ? { steamAppId: a.steamAppId } : {}),
      };
      return invoke<string>('clips_save', body, { headers: { 'x-meta': b64json(meta) } });
    },
    reveal: (path) => invoke('clips_reveal', { path: ClipPath.parse(path) }),
    list: () => invoke<ClipInfo[]>('clips_list'),
    read: async (path) => new Uint8Array(await invoke<ArrayBuffer>('clips_read', { path: ClipPath.parse(path) })),
    remove: (path) => invoke('clips_remove', { path: ClipPath.parse(path) }),
    copy: (path) => invoke('clips_copy', { path: ClipPath.parse(path) }),
    exportFile: async (args) => {
      const a = ClipExportArgs.parse(args);
      return invoke<string | null>('clips_export', a.data, {
        headers: { 'x-meta': b64json({ kind: a.kind, name: a.name }) },
      });
    },
    dir: () => invoke<string>('clips_dir'),
    chooseDir: () => invoke<string>('clips_choose_dir'),
  },
  games: {
    configure: async (args) => {
      const a = GamesConfigureArgs.parse(args);
      games.configure(a.enabled, a.custom);
    },
    processes: async () => pickableProcesses(await games.exes()),
    current: async () => games.current,
  },
  winAudio: {
    list: () => invoke<WinAudioOutput[]>('win_audio_list'),
    start: async (id) => {
      const audioId = WinAudioId.parse(id);
      const ch = new Channel<ArrayBuffer>();
      ch.onmessage = (buf) => fire('win-audio', { id: audioId, pcm: new Uint8Array(buf) });
      return invoke<boolean>('win_audio_start', { id: audioId, onChunk: ch });
    },
    stop: (id) => invoke('win_audio_stop', { id: WinAudioId.parse(id) }),
  },
  remoteInput: {
    available: () => invoke<boolean>('remote_input_available'),
    start: async (args) => {
      const a = RemoteInputStartArgs.parse(args);
      await stopRemoteLocal();
      // a fonte da live vem do seletor do WebView2 (sem id de monitor): vale o monitor principal
      const m = await primaryMonitor();
      if (!m) return false;
      if (!(await invoke<boolean>('remote_input_start'))) return false;
      remote = { rect: { x: m.position.x, y: m.position.y, width: m.size.width, height: m.size.height } };
      await invoke('banner_show', { controller: a.controller }).catch(() => undefined);
      await armPanic();
      return true;
    },
    send: (ev) => {
      const r = remote;
      if (!r) return;
      const p = RemoteInputEvent.safeParse(ev);
      if (!p.success) return;
      void invoke('remote_input_send', { lines: inputLine(p.data, r.rect).join('\n') + '\n' });
    },
    stop: () => stopRemoteLocal(),
    clipboard: async (args) => {
      if (!remote) return;
      await invoke('remote_set_clipboard', { text: RemoteClipboardArgs.parse(args).text });
    },
    fileChunk: async (args) => {
      const c = RemoteFileChunkArgs.parse(args);
      const meta = { id: c.id, name: c.name, size: c.size, index: c.index, total: c.total };
      return invoke<RemoteFileResult>('remote_file_chunk', c.data, { headers: { 'x-meta': b64json(meta) } });
    },
    revealFile: (path) => invoke('remote_reveal_file', { path: String(path).slice(0, 1024) }),
  },
  overlay: {
    update: (state) => {
      const s = OverlayState.safeParse(state);
      if (!s.success) return;
      const key = JSON.stringify(s.data);
      if (key === lastOverlay) return;
      lastOverlay = key;
      void invoke('overlay_update', { state: s.data });
    },
  },
  reportError: (report) => invoke('report_error', { report: ErrorReport.parse(report) }),
  updates: {
    status: async (): Promise<UpdateStatus> => ({ state: 'idle' }),
    check: async (): Promise<UpdateStatus> => ({ state: 'idle' }),
    install: async () => undefined,
  },
  on: ((event: Events, cb: (arg: unknown) => void) => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }) as unknown as OpenCordBridge['on'],
};

window.opencord = bridge;

// ---------- eventos do processo principal ----------

void listen<string>('oc:tray-action', (e) => fire('tray-action', e.payload));
void listen<{ maximized: boolean }>('oc:window-state', (e) => fire('window-state', e.payload));
void listen<RemoteInputStop>('oc:remote-input-stop', () => {
  // o oc-input saiu sozinho; o Rust já parou a sessão
  if (!remote) return;
  remote = null;
  void unregister(toTauriAccelerator(REMOTE_PANIC_ACCEL)).catch(() => undefined);
  void invoke('banner_close').catch(() => undefined);
  fire('remote-input-stop', 'exit');
});
void listen('oc:banner-stop', () => endRemote('banner'));

// ausente automático: a cada 30 s, há quanto tempo ninguém mexe no computador
setInterval(() => void invoke<number>('idle_seconds').then((s) => fire('idle', s)), 30_000);

// voltou da suspensão: o relógio pula (o Electron usa o powerMonitor)
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  if (now - lastTick > 30_000) fire('power-resume');
  lastTick = now;
}, 5_000);

// Barra de título: o CSS da interface marca as áreas de arrastar com -webkit-app-region (Electron). O WebView2 do
// Tauri não lê essa propriedade; o arrasto e o duplo clique para maximizar são feitos aqui.
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  for (let el = e.target as Element | null; el && el !== document.documentElement; el = el.parentElement) {
    const region = getComputedStyle(el).getPropertyValue('-webkit-app-region').trim();
    if (region === 'no-drag') return;
    if (region === 'drag') {
      e.preventDefault();
      if (e.detail === 2) void win.toggleMaximize();
      else void win.startDragging();
      return;
    }
  }
});
