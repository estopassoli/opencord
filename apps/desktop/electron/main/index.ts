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
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import os from 'node:os';
import { hardwareIdOf } from '../shared/hardware-id';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  AppPrefsSchema,
  CaptureSelectArgs,
  ClipExportArgs,
  ErrorReport,
  ClipPath,
  ClipSaveArgs,
  ExternalUrl,
  GamesConfigureArgs,
  IPC,
  NotifyArgs,
  SecureKey,
  ShortcutsArgs,
  TrayVoiceState,
  WindowControl,
  WinAudioId,
  type AppInfo,
  type ProcessMetric,
  type AppPrefsState,
  type ShortcutAction,
  type TrayAction,
} from '../shared/ipc';
import { installDisplayMediaHandler, listSources, selectSource } from './capture';
import {
  RemoteClipboardArgs,
  RemoteFileChunkArgs,
  RemoteInputEvent,
  RemoteInputStartArgs,
} from '../shared/remote-input';
import {
  armPanic,
  receiveRemoteFile,
  remoteInputAvailable,
  revealRemoteFile,
  sendRemoteInput,
  setRemoteClipboard,
  startRemoteInput,
  stopRemoteInput,
} from './remote-input';
import { destroyOverlay, updateOverlay } from './overlay';
import { OverlayState } from '../shared/overlay';
import { secureAvailable, secureDelete, secureGet, secureSet } from './secure-store';
import { appIcon, badgeIcon, trayIcon } from './icons';
import { readAppPrefs, writeAppPrefs } from './app-prefs';
import {
  autoInstallIfSafe,
  checkForUpdate,
  checkIfStale,
  consumeRelaunchMarker,
  installOnQuit,
  installUpdate,
  markSessionEnding,
  relaunchIntoUpdate,
  startUpdater,
  updateStatus,
} from './updater';
import { GameDetector } from './games';
import { logRendererError } from './crash-log';
import { ShortcutRegistry } from './shortcut-registry';
import {
  chooseClipsDir,
  clipsDir,
  copyClip,
  deleteClip,
  exportClip,
  listClips,
  prepareClipCapture,
  readClip,
  revealClip,
  saveClip,
} from './clips';
import { listOutputs, startOutput, stopAllOutputs, stopOutput } from './win-audio';

/** nome da janela da transmissão desanexada (src/features/voice/popout.tsx) */
const POPOUT_NAME = 'opencord-live';
const DEV_URL = process.env.OPENCORD_DEV_URL; // ex.: http://localhost:5173 (apenas desenvolvimento)
const RENDERER_INDEX = path.join(__dirname, '../dist/index.html');
const ALLOWED_PERMISSIONS = new Set([
  // Espaço 3D (ADR-0055): o mouse fica preso na visão; só nas páginas do app (permissionAllowed)
  'pointerLock',
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
const shortcuts = new ShortcutRegistry<ShortcutAction>({
  register: (accel, fire) => globalShortcut.register(accel, fire),
  unregisterAll: () => globalShortcut.unregisterAll(),
  fire: (action) => send(IPC.evShortcut, action),
  // o unregisterAll também tira o atalho de emergência do controle remoto
  afterReset: () => armPanic(),
});
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
// O id de app do Windows liga a janela ao atalho/ícone da barra de tarefas. Em desenvolvimento (electron.exe) usa
// outro id: com o mesmo, o Windows guardava o ícone do Electron para o id e o app instalado herdava o átomo na barra.
app.setAppUserModelId(app.isPackaged ? 'org.opencord.desktop' : 'org.opencord.desktop.dev');
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

/** A página do próprio app: em produção, exatamente o index.html empacotado (não qualquer file://). */
function isAppPage(url: string): boolean {
  if (DEV_URL) return url.startsWith(DEV_URL);
  if (!url.startsWith('file://')) return false;
  try {
    const p = path.resolve(fileURLToPath(url.split(/[?#]/)[0] ?? ''));
    const want = path.resolve(RENDERER_INDEX);
    return process.platform === 'win32' ? p.toLowerCase() === want.toLowerCase() : p === want;
  } catch {
    return false;
  }
}

function isTrustedSender(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (!win || e.sender.id !== win.webContents.id) return false;
  return isAppPage(e.senderFrame?.url ?? '');
}

/** Permissões só para a página do app (e o popout dela, about:blank); tela cheia também para o player embutido. */
function permissionAllowed(permission: string, url: string): boolean {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  // a checagem recebe só a origem: para file:// ela vem como "file://" ou "file:///"
  return (
    permission === 'fullscreen' || url === 'about:blank' || isAppPage(url) || (!DEV_URL && /^file:\/\/\/?$/.test(url))
  );
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
  // a janela caiu (falta de memória, GPU): fica registrado para diagnóstico
  win.webContents.on('render-process-gone', (_e, d) => {
    logRendererError({ where: 'window', message: `processo da janela encerrado: ${d.reason} (código ${d.exitCode})` });
    stopAllOutputs();
    stopRemoteInput();
  });
  // recarregar a janela perde quem ouvia o som das saídas (e quem controlava este PC)
  win.webContents.on('did-start-navigation', (e) => {
    if (e.isMainFrame && !e.isSameDocument) {
      stopAllOutputs();
      stopRemoteInput();
    }
  });
  win.removeMenu();
  // reaberto pelo instalador depois de atualizar sozinho com a janela escondida: continua na bandeja
  const startHidden = consumeRelaunchMarker();
  win.once('ready-to-show', () => {
    if (!startHidden) win?.show();
  });
  // desligando o Windows: não começar a instalação da atualização (seria cortada no meio)
  win.on('query-session-end', () => markSessionEnding());
  win.on('session-end', () => markSessionEnding());
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

const quitForUpdate = () => {
  quitting = true;
  app.quit();
};

function updateMenuItem(): Electron.MenuItemConstructorOptions {
  const u = updateStatus();
  if (u.state === 'ready' || u.state === 'available')
    return {
      label: u.state === 'ready' ? `Reiniciar e atualizar agora (${u.version})` : `Baixar atualização ${u.version}`,
      click: () => void installUpdate(quitForUpdate),
    };
  if (u.state === 'downloading') return { label: `Baixando atualização ${u.version}… ${u.progress}%`, enabled: false };
  return { label: 'Procurar atualização', click: () => void checkForUpdate().then(buildTrayMenu) };
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
      // pelo processo principal: funciona mesmo se a janela travar ou mostrar "Algo deu errado"
      updateMenuItem(),
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

const games = new GameDetector(
  ({ game }) => send(IPC.evGame, game),
  (open) => send(IPC.evStreamingApp, open),
);

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
  // registro pode falhar se outro app já usa o atalho; os que falharam são tentados de novo até ficarem livres
  handle(IPC.shortcutsSet, [ShortcutsArgs], (s) => shortcuts.set(s));
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
  handle(IPC.appMetrics, [], (): ProcessMetric[] =>
    app
      .getAppMetrics()
      .map((m) => ({ pid: m.pid, type: m.type, mb: Math.round(m.memory.workingSetSize / 1024) }))
      .sort((a, b) => b.mb - a.mb),
  );
  handle(IPC.appInfo, [], (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    osRelease: os.release(),
    secureStorage: secureAvailable(),
  }));
  handle(IPC.openExternal, [ExternalUrl], (url) => shell.openExternal(url));
  // só o hash sai da máquina (ADR-0036)
  handle(IPC.hardwareId, [], () => hardwareIdOf(os.networkInterfaces()));
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
  handle(IPC.clipsReveal, [ClipPath], (p) => revealClip(p));
  handle(IPC.clipsList, [], () => listClips());
  handle(IPC.clipsRead, [ClipPath], (p) => readClip(p));
  handle(IPC.clipsRemove, [ClipPath], (p) => deleteClip(p));
  handle(IPC.clipsCopy, [ClipPath], (p) => copyClip(p));
  handle(IPC.clipsExport, [ClipExportArgs], (a) => exportClip(a));
  handle(IPC.clipsDir, [], () => clipsDir());
  handle(IPC.clipsChooseDir, [], () => chooseClipsDir());
  handle(IPC.errorReport, [ErrorReport], (r) => logRendererError(r));
  handle(IPC.gamesConfigure, [GamesConfigureArgs], (a) => games.configure(a.enabled, a.custom));
  handle(IPC.gamesProcesses, [], () => games.processes());
  handle(IPC.gamesCurrent, [], () => games.game);
  handle(IPC.winAudioList, [], () => listOutputs());
  handle(IPC.winAudioStart, [WinAudioId], (id) => (win ? startOutput(id, win.webContents, IPC.evWinAudio) : false));
  handle(IPC.winAudioStop, [WinAudioId], (id) => stopOutput(id));
  handle(IPC.remoteInputAvailable, [], () => remoteInputAvailable());
  handle(IPC.remoteInputStart, [RemoteInputStartArgs], (a) =>
    startRemoteInput(a, (reason) => send(IPC.evRemoteInputStop, reason)),
  );
  handle(IPC.remoteInputStop, [], () => stopRemoteInput());
  handle(IPC.remoteInputClipboard, [RemoteClipboardArgs], (a) => setRemoteClipboard(a.text));
  handle(IPC.remoteInputFile, [RemoteFileChunkArgs], (a) => receiveRemoteFile(a));
  handle(IPC.remoteInputReveal, [z.string().max(1024)], (p) => revealRemoteFile(p));
  ipcMain.on(IPC.remoteInputSend, (e, raw: unknown) => {
    if (!isTrustedSender(e)) return;
    const ev = RemoteInputEvent.safeParse(raw);
    if (ev.success) sendRemoteInput(ev.data);
  });
  ipcMain.on(IPC.overlayUpdate, (e, raw: unknown) => {
    if (!isTrustedSender(e)) return;
    const s = OverlayState.safeParse(raw);
    if (s.success) updateOverlay(s.data);
  });
  handle(IPC.appRelaunch, [], () => {
    // com atualização pronta, o instalador reabre o app já na versão nova
    if (relaunchIntoUpdate(quitForUpdate)) return;
    quitting = true;
    app.relaunch();
    app.quit();
  });
  handle(IPC.updateStatus, [], () => updateStatus());
  handle(IPC.updateCheck, [], () => checkForUpdate());
  handle(IPC.updateInstall, [], () => installUpdate(quitForUpdate));
}

app.whenReady().then(() => {
  // Permissões mínimas: só mídia/notificações/clipboard; geolocalização, HID, USB etc. negados.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) =>
    cb(permissionAllowed(permission, details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permissionAllowed(permission, origin));
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
  // ausente automático: a janela decide a partir do tempo sem teclado/mouse no sistema
  setInterval(() => send(IPC.evIdle, powerMonitor.getSystemIdleTime()), 30_000).unref();
  // instalação automática: a cada minuto confere se a pessoa está longe e fora de chamada/jogo (ADR-0051)
  setInterval(
    () =>
      void autoInstallIfSafe(
        () => ({
          platform: process.platform,
          ready: updateStatus().state === 'ready',
          inVoice: voice.inVoice,
          gameRunning: games.game !== null,
          windowVisible: Boolean(win && win.isVisible() && !win.isMinimized()),
          idleSeconds: powerMonitor.getSystemIdleTime(),
        }),
        quitForUpdate,
      ),
    60_000,
  ).unref();
  startUpdater((s) => {
    send(IPC.evUpdate, s);
    // o menu da bandeja acompanha (rebaixa o progresso só a cada mudança de estado/10%)
    if (s.state !== 'downloading' || s.progress % 10 === 0) buildTrayMenu();
  });
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  // atualização pronta: instala em silêncio ao encerrar (a próxima abertura já é a versão nova)
  installOnQuit();
  shortcuts.dispose();
  games.stop();
  stopAllOutputs();
  stopRemoteInput();
  destroyOverlay();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// Bloqueia criação de webContents não previstos (ex.: <webview>, popups).
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});
