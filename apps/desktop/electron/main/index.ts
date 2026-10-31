/**
 * Processo principal do OpenCord Desktop.
 * Segurança (docs/SECURITY.md): sandbox, contextIsolation, nodeIntegration=false, IPC com allowlist + validação Zod,
 * navegação e window.open bloqueados, permissões mínimas, CSP no HTML do renderer.
 */
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  AppPrefsSchema,
  CaptureSelectArgs,
  ClipSaveArgs,
  ExternalUrl,
  GamesConfigureArgs,
  IPC,
  NotifyArgs,
  SecureKey,
  ShortcutsArgs,
  TrayVoiceState,
  WindowControl,
  type AppInfo,
  type AppPrefsState,
  type ShortcutAction,
  type TrayAction,
} from '../shared/ipc';
import { installDisplayMediaHandler, listSources, selectSource } from './capture';
import { secureAvailable, secureDelete, secureGet, secureSet } from './secure-store';
import { appIcon, badgeIcon, trayIcon } from './icons';
import { readAppPrefs, writeAppPrefs } from './app-prefs';
import { checkForUpdate, checkIfStale, installUpdate, startUpdater, updateStatus } from './updater';
import { GameDetector } from './games';
import { prepareClipCapture, revealClip, saveClip } from './clips';

/** nome da janela da transmissão desanexada (src/features/voice/popout.tsx) */
const POPOUT_NAME = 'opencord-live';
const DEV_URL = process.env.OPENCORD_DEV_URL; // ex.: http://localhost:5173 (apenas desenvolvimento)
const RENDERER_INDEX = path.join(__dirname, '../dist/index.html');
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
  'display-capture',
  'speaker-selection',
]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let voice: z.infer<typeof TrayVoiceState> = { inVoice: false, muted: false, deafened: false };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

// Configurações → Sobre → Desempenho (só pode ser aplicado antes de o app ficar pronto).
// off: a GPU sai de cena; a live perde o encoder por hardware (NVENC/AMF/QSV) e a decodificação D3D11.
const gpuMode = readAppPrefs().gpuMode;
if (gpuMode === 'off') app.disableHardwareAcceleration();

// Necessário para notificações nativas no Windows.
app.setAppUserModelId('org.opencord.desktop');
// Voz não pode ser estrangulada com a janela em segundo plano.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Jogo em tela cheia cobre a janela: o Windows a dá como "ocluída" e o Chromium rebaixava a prioridade do
// renderer (que captura e codifica a live). Com o jogo disputando CPU/GPU, a live engasgava mesmo com o jogo liso.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// soma às features desligadas pela linha de comando (diagnóstico/E2E) em vez de substituí-las
app.commandLine.appendSwitch(
  'disable-features',
  [app.commandLine.getSwitchValue('disable-features'), 'CalculateNativeWinOcclusion'].filter(Boolean).join(','),
);
// NÃO ativar WebRtcAllowWgcUsingTexture: medido no E2E golive-real com animação na tela, a captura travava em ~12 fps
// com o conteúdo a 47 fps; sem a flag a captura acompanha o conteúdo (docs/MEDIA_ARCHITECTURE.md).

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  if (!win || e.sender.id !== win.webContents.id) return false;
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
}

/** Registra handler IPC validando remetente e argumentos. */
function handle<A extends unknown[], R>(
  channel: string,
  schemas: { [K in keyof A]: z.ZodType<A[K]> },
  fn: (...args: A) => R | Promise<R>,
) {
  ipcMain.handle(channel, async (e, ...raw: unknown[]) => {
    if (!isTrustedSender(e)) throw new Error('remetente IPC não confiável');
    if (raw.length !== schemas.length) throw new Error('argumentos inválidos');
    const args = schemas.map((s, i) => s.parse(raw[i])) as A;
    return fn(...args);
  });
}

function send(channel: string, payload?: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: '#1b1d22',
    title: 'OpenCord',
    icon: appIcon(),
    autoHideMenuBar: true,
    // Barra de título integrada ao app, com minimizar/maximizar/fechar desenhados pelo próprio app (fora do macOS).
    // NÃO usar titleBarOverlay: medido no E2E ui-hover (RTX 5090, Windows 11), a sobreposição nativa fazia cada quadro
    // esperar ~16 ms para ser apresentado e o hover chegava 64 ms atrasado (76 hovers em 3 s); sem ela, 0 ms (544).
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win?.show());
  win.on('focus', () => checkIfStale());

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url, frameName }) => {
    // única janela filha permitida: a transmissão desanexada (about:blank do próprio app, sem preload/Node)
    if (url === 'about:blank' && frameName === POPOUT_NAME) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1120,
          height: 700,
          minWidth: 480,
          minHeight: 300,
          title: 'OpenCord — Transmissão',
          backgroundColor: '#000000',
          icon: appIcon(),
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        },
      };
    }
    if (ExternalUrl.safeParse(url).success) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    child.removeMenu();
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (e) => e.preventDefault());
  });
  wc.on('will-navigate', (e, url) => {
    if (!(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());

  // Fechar a janela minimiza para a bandeja: a chamada de voz continua (P11).
  const sendState = () => send(IPC.evWindowState, { maximized: Boolean(win?.isMaximized()) });
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(RENDERER_INDEX);
}

function buildTrayMenu() {
  if (!tray) return;
  const act = (a: TrayAction) => () => {
    if (a === 'show') showWindow();
    send(IPC.evTrayAction, a);
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir OpenCord', click: act('show') },
      { type: 'separator' },
      {
        label: voice.muted ? 'Ativar microfone' : 'Silenciar microfone',
        enabled: voice.inVoice,
        click: act('toggleMute'),
      },
      { label: voice.deafened ? 'Ativar áudio' : 'Ensurdecer', enabled: voice.inVoice, click: act('toggleDeafen') },
      { label: 'Sair da chamada', enabled: voice.inVoice, click: act('disconnect') },
      { type: 'separator' },
      {
        label: 'Encerrar OpenCord',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.setToolTip(voice.inVoice ? `OpenCord — em chamada${voice.muted ? ' (mudo)' : ''}` : 'OpenCord');
}

/**
 * Ao iniciar uma live: GPU (captura/NVENC) e renderer (WebRTC) acima do normal, para não perderem a disputa
 * com um jogo pesado. Fica assim até o app fechar (voz também se beneficia); falha é ignorada.
 */
function boostMediaPriority() {
  const rendererPid = win?.webContents.getOSProcessId();
  for (const m of app.getAppMetrics()) {
    if (m.type !== 'GPU' && m.pid !== rendererPid) continue;
    try {
      os.setPriority(m.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch {
      /* sem permissão para mudar a prioridade: segue normal */
    }
  }
}

const games = new GameDetector(({ game }) => send(IPC.evGame, game));

function registerIpc() {
  handle(IPC.captureListSources, [], () => listSources());
  handle(IPC.captureSelect, [CaptureSelectArgs], (args) => {
    boostMediaPriority();
    return selectSource(args);
  });
  handle(IPC.secureGet, [SecureKey], (k) => secureGet(k));
  handle(IPC.secureSet, [SecureKey, z.string().max(8192)], (k, v) => secureSet(k, v));
  handle(IPC.secureDelete, [SecureKey], (k) => secureDelete(k));
  handle(IPC.notify, [NotifyArgs], (n) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: n.title, body: n.body, silent: n.silent ?? false, icon: appIcon() });
    notification.on('click', () => {
      showWindow();
      if (n.route) send(IPC.evNotificationClick, n.route);
    });
    notification.show();
  });
  handle(IPC.shortcutsSet, [ShortcutsArgs], (s) => {
    globalShortcut.unregisterAll();
    const registered: string[] = [];
    const failed: string[] = [];
    for (const [action, accel] of Object.entries(s) as [ShortcutAction, string | null][]) {
      if (!accel) continue;
      // registro pode falhar se outro app já usa o atalho
      const ok = globalShortcut.register(accel, () => send(IPC.evShortcut, action));
      (ok ? registered : failed).push(accel);
    }
    return { registered, failed };
  });
  handle(IPC.windowFlash, [], () => {
    if (win && !win.isFocused()) win.flashFrame(true);
  });
  handle(IPC.windowFocus, [], () => showWindow());
  handle(IPC.windowControl, [WindowControl], (action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else win.close(); // o handler de 'close' esconde na bandeja, como o botão nativo fazia
  });
  handle(IPC.windowState, [], () => ({ maximized: Boolean(win?.isMaximized()) }));
  handle(IPC.badgeSet, [z.number().int().min(0).max(9999)], (count) => {
    if (!win) return;
    if (process.platform === 'win32')
      win.setOverlayIcon(count > 0 ? badgeIcon() : null, count > 0 ? `${count} não lidas` : '');
    else app.setBadgeCount(count);
  });
  handle(IPC.trayVoiceState, [TrayVoiceState], (s) => {
    voice = s;
    buildTrayMenu();
  });
  handle(IPC.appInfo, [], (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    osRelease: os.release(),
    secureStorage: secureAvailable(),
  }));
  handle(IPC.openExternal, [ExternalUrl], (url) => shell.openExternal(url));
  const prefsState = (): AppPrefsState => ({
    saved: readAppPrefs(),
    activeGpuMode: gpuMode,
  });
  handle(IPC.prefsGet, [], prefsState);
  handle(IPC.prefsSet, [AppPrefsSchema], (prefs) => {
    writeAppPrefs(prefs);
    return prefsState();
  });
  handle(IPC.clipsPrepare, [], () => prepareClipCapture());
  handle(IPC.clipsSave, [ClipSaveArgs], (a) => saveClip(a));
  handle(IPC.clipsReveal, [z.string().max(1024)], (p) => revealClip(p));
  handle(IPC.gamesConfigure, [GamesConfigureArgs], (a) => games.configure(a.enabled, a.custom));
  handle(IPC.gamesProcesses, [], () => games.processes());
  handle(IPC.gamesCurrent, [], () => games.game);
  handle(IPC.appRelaunch, [], () => {
    quitting = true;
    app.relaunch();
    app.quit();
  });
  handle(IPC.updateStatus, [], () => updateStatus());
  handle(IPC.updateCheck, [], () => checkForUpdate());
  handle(IPC.updateInstall, [], () =>
    installUpdate(() => {
      quitting = true;
      app.quit();
    }),
  );
}

app.whenReady().then(() => {
  // Permissões mínimas: só mídia/notificações/clipboard; geolocalização, HID, USB etc. negados.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  session.defaultSession.setDevicePermissionHandler(() => false);
  // Assistir juntos: o player embutido do YouTube exige Referer (sem ele, "erro 153"); páginas file:// não enviam.
  // Só para o player do YouTube, identificando o app.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*'] }, (d, cb) => {
    if (!d.requestHeaders.Referer) d.requestHeaders.Referer = 'https://opencord.pro/';
    cb({ requestHeaders: d.requestHeaders });
  });
  installDisplayMediaHandler();
  registerIpc();
  createWindow();
  tray = new Tray(trayIcon());
  tray.on('click', () => showWindow());
  buildTrayMenu();
  powerMonitor.on('resume', () => {
    send(IPC.evPowerResume);
    checkIfStale();
  });
  startUpdater((s) => send(IPC.evUpdate, s));
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  games.stop();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// Bloqueia criação de webContents não previstos (ex.: <webview>, popups).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});
