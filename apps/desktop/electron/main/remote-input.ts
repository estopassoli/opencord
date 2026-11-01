/**
 * Controle remoto do lado de quem é controlado (ADR-0026). A janela só chama `start` depois que a pessoa aceitou o
 * pedido; daí em diante cada evento vindo de quem controla passa por aqui, é validado de novo e vira um comando do
 * `oc-input.exe` (native/win-input). Enquanto dura:
 * - uma faixa sempre visível no topo da tela controlada diz quem está controlando, com o botão "Parar";
 * - o atalho de emergência (Ctrl+Alt+Shift+S) corta tudo, mesmo com o OpenCord escondido ou um jogo em tela cheia.
 */
import { app, BrowserWindow, desktopCapturer, globalShortcut, screen, type Rectangle } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  inputLine,
  REMOTE_PANIC_ACCEL,
  REMOTE_PANIC_LABEL,
  type RemoteInputEvent,
  type RemoteInputStartArgs,
  type RemoteInputStop,
} from '../shared/remote-input';

const exe = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'oc-input.exe')
    : path.join(app.getAppPath(), 'resources', 'win', 'oc-input.exe');

export const remoteInputAvailable = () => process.platform === 'win32' && existsSync(exe());

let active: {
  child: ChildProcess;
  rect: Rectangle;
  banner: BrowserWindow | null;
  onStop: (r: RemoteInputStop) => void;
} | null = null;

/** Monitor da live: o id da fonte `screen:` aponta para um display do Electron. */
async function displayFor(sourceId: string) {
  const all = screen.getAllDisplays();
  const src = (await desktopCapturer.getSources({ types: ['screen'] })).find((s) => s.id === sourceId);
  return all.find((d) => String(d.id) === src?.display_id) ?? (all.length === 1 ? all[0] : undefined);
}

export async function startRemoteInput(
  args: RemoteInputStartArgs,
  onStop: (reason: RemoteInputStop) => void,
): Promise<boolean> {
  stopRemoteInput();
  if (!remoteInputAvailable()) return false;
  const display = await displayFor(args.sourceId);
  if (!display) return false;
  // a live captura o monitor em pixels físicos; o oc-input também trabalha neles
  const rect = screen.dipToScreenRect(null, display.bounds);
  const child = spawn(exe(), [], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    child.stderr.on('data', (b: Buffer) => {
      if (!b.toString().includes('ready')) return;
      clearTimeout(timer);
      resolve(true);
    });
    child.on('error', () => resolve(false));
    child.on('exit', () => resolve(false));
  });
  if (!ready) {
    child.kill();
    return false;
  }
  active = { child, rect, banner: showBanner(display.bounds, args.controller), onStop };
  child.on('exit', () => {
    if (active?.child === child) end('exit');
  });
  child.stdin.on('error', () => undefined);
  armPanic();
  return true;
}

export function sendRemoteInput(ev: RemoteInputEvent) {
  const a = active;
  if (!a || !a.child.stdin?.writable) return;
  a.child.stdin.write(inputLine(ev, a.rect).join('\n') + '\n');
}

/** Para por pedido da janela (sem avisá-la de volta). */
export function stopRemoteInput() {
  const a = active;
  if (!a) return;
  active = null;
  globalShortcut.unregister(REMOTE_PANIC_ACCEL);
  if (a.banner && !a.banner.isDestroyed()) a.banner.destroy();
  // "r" solta o que estiver apertado; fechar o stdin encerra (e solta de novo, por garantia)
  if (a.child.stdin?.writable) a.child.stdin.end('r\n');
  setTimeout(() => {
    if (a.child.exitCode === null) a.child.kill();
  }, 2000).unref();
}

function end(reason: RemoteInputStop) {
  const a = active;
  stopRemoteInput();
  a?.onStop(reason);
}

/**
 * Registra (de novo) o atalho de emergência. Os atalhos globais do usuário são trocados com `unregisterAll`, então
 * quem os troca chama isto em seguida.
 */
export function armPanic() {
  if (!active || globalShortcut.isRegistered(REMOTE_PANIC_ACCEL)) return;
  globalShortcut.register(REMOTE_PANIC_ACCEL, () => end('panic'));
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Faixa no topo do monitor controlado: não rouba o foco e fica acima de tudo (inclusive jogos em janela). */
function showBanner(bounds: Rectangle, controller: string): BrowserWindow | null {
  const width = 520;
  const height = 44;
  const banner = new BrowserWindow({
    x: Math.round(bounds.x + (bounds.width - width) / 2),
    y: bounds.y + 8,
    width,
    height,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#1b1d22',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  });
  banner.setAlwaysOnTop(true, 'screen-saver');
  banner.setVisibleOnAllWorkspaces(true);
  banner.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  banner.webContents.on('will-navigate', (e) => e.preventDefault());
  // sem preload nem IPC: o botão troca o título da página, e é isso que o processo principal escuta
  banner.on('page-title-updated', (e, title) => {
    e.preventDefault();
    if (title === 'stop') end('banner');
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>OpenCord</title><style>
    html,body{margin:0;height:100%;background:#1b1d22;color:#f2f3f5;font:13px/1.2 "Segoe UI",system-ui,sans-serif;
      overflow:hidden;user-select:none}
    body{display:flex;align-items:center;gap:10px;padding:0 6px 0 14px;box-sizing:border-box;
      border:2px solid #f0b232;border-radius:8px}
    .dot{width:8px;height:8px;border-radius:50%;background:#f0b232;flex:none}
    .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .k{color:#b5bac1;font-size:12px;white-space:nowrap}
    button{font:600 13px "Segoe UI",system-ui,sans-serif;color:#fff;background:#da373c;border:0;border-radius:6px;
      padding:6px 14px;cursor:pointer}
    button:hover{background:#a12828}
  </style></head><body><span class="dot"></span><span class="t"><b>${esc(controller)}</b> está controlando seu PC</span>
  <span class="k">${REMOTE_PANIC_LABEL}</span><button onclick="document.title='stop'">Parar</button></body></html>`;
  void banner.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  banner.once('ready-to-show', () => banner.showInactive());
  return banner;
}
