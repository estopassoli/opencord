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
  CaptureSelectArgs,
  ExternalUrl,
  IPC,
  NotifyArgs,
  SecureKey,
  ShortcutsArgs,
  TrayVoiceState,
  type AppInfo,
  type ShortcutAction,
  type TrayAction,
} from '../shared/ipc';
import { installDisplayMediaHandler, listSources, selectSource } from './capture';
import { secureAvailable, secureDelete, secureGet, secureSet } from './secure-store';
import { appIcon, badgeIcon, trayIcon } from './icons';
import { checkForUpdate, installUpdate, startUpdater, updateStatus } from './updater';

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

// Necessário para notificações nativas no Windows.
app.setAppUserModelId('org.opencord.desktop');
// Voz não pode ser estrangulada com a janela em segundo plano.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

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
    // Barra de título integrada ao app; os botões minimizar/maximizar/fechar continuam nativos do Windows.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111317', symbolColor: '#b0b5bf', height: 32 },
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

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (ExternalUrl.safeParse(url).success) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());

  // Fechar a janela minimiza para a bandeja: a chamada de voz continua (P11).
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

function registerIpc() {
  handle(IPC.captureListSources, [], () => listSources());
  handle(IPC.captureSelect, [CaptureSelectArgs], (args) => selectSource(args));
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
  installDisplayMediaHandler();
  registerIpc();
  createWindow();
  tray = new Tray(trayIcon());
  tray.on('click', () => showWindow());
  buildTrayMenu();
  powerMonitor.on('resume', () => send(IPC.evPowerResume));
  startUpdater((s) => send(IPC.evUpdate, s));
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// Bloqueia criação de webContents não previstos (ex.: <webview>, popups).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});
