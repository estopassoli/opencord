// F0.3/F0.4 — PoC Electron: enumeração de fontes (monitor/janela), captura de vídeo
// e captura de áudio do sistema via loopback do Chromium no Windows.
// Modo --selftest=<arquivo>: executa os testes automaticamente, grava JSON e encerra.
// Privacidade: títulos de janelas NÃO são gravados no relatório (apenas contagens/tipos).
const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function makeWav(hz, seconds, amp) {
  const rate = 48000;
  const n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amp * 32767), 44 + i * 2);
  return buf;
}

const selftestArg = process.argv.find((a) => a.startsWith('--selftest='));
// Testes de tom audível são opt-in: tocam som no dispositivo de saída do usuário.
const withTone = process.argv.includes('--with-tone');
const outFile = selftestArg ? path.resolve(selftestArg.slice('--selftest='.length)) : null;

// Fonte que o handler de getDisplayMedia deve conceder no próximo pedido (definida via IPC validado).
let pendingGrant = null;
const knownSources = new Map();
const report = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  osRelease: require('node:os').release(),
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  sources: null,
  tests: [],
  handlerErrors: [],
};

async function listSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  return sources;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // necessário em selftest com janela oculta para não estrangular timers/áudio
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => (outFile ? win.showInactive() : win.show()));
  win.loadFile(path.join(__dirname, 'renderer.html'));
  return win;
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const grant = pendingGrant;
    pendingGrant = null;
    try {
      if (!grant) throw new Error('nenhuma concessão pendente');
      // Reutiliza a fonte da listagem inicial; IDs de janela podem não reaparecer em nova listagem.
      const src = knownSources.get(grant.sourceId) ?? (await listSources()).find((s) => s.id === grant.sourceId);
      if (!src) throw new Error(`fonte não encontrada (${grant.sourceId.split(':')[0]})`);
      callback(grant.audio ? { video: src, audio: 'loopback' } : { video: src });
    } catch (e) {
      report.handlerErrors.push(String(e.message));
      // Negar explicitamente: o renderer recebe NotAllowedError em vez de ficar pendurado.
      callback({ video: null });
    }
  });

  // Janela-alvo controlada pela PoC: torna o teste de janela determinístico e permite
  // verificar que fechar a fonte encerra a trilha.
  let target = new BrowserWindow({ width: 640, height: 360, title: 'OpenCord PoC Target', show: false, backgroundColor: '#5865f2', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await target.loadURL('data:text/html,<title>OpenCord PoC Target</title><body style="background:%235865f2"></body>');
  target.showInactive();
  await new Promise((r) => setTimeout(r, 500));
  const targetId = target.getMediaSourceId();
  const all = await listSources();
  for (const s of all) knownSources.set(s.id, s);
  const screens = all.filter((s) => s.id.startsWith('screen:'));
  const windows = all.filter((s) => s.id.startsWith('window:'));
  report.sources = {
    screens: screens.length,
    windows: windows.length,
    screenThumbnails: screens.map((s) => s.thumbnail.getSize()),
    nonEmptyThumbnails: all.filter((s) => !s.thumbnail.isEmpty()).length,
  };

  // IPC allowlist: apenas estes canais, com validação de parâmetros.
  ipcMain.handle('poc:plan', () => ({
    selftest: Boolean(outFile),
    withTone,
    screenId: screens[0]?.id ?? null,
    // primeira janela que não seja a própria PoC
    targetWindowId: knownSources.has(targetId) ? targetId : null,
    targetIdListed: knownSources.has(targetId),
    // janela arbitrária de terceiros (informativo; pode não ser capturável)
    windowId: windows.find((w) => w.id !== targetId && !w.name.includes('OpenCord Capture PoC'))?.id ?? null,
  }));
  ipcMain.handle('poc:grant', (_e, arg) => {
    if (typeof arg !== 'object' || arg === null) throw new Error('invalid');
    const { sourceId, audio } = arg;
    if (typeof sourceId !== 'string' || !/^(screen|window):[\w:-]+$/.test(sourceId)) throw new Error('invalid sourceId');
    if (typeof audio !== 'boolean') throw new Error('invalid audio');
    pendingGrant = { sourceId, audio };
    return true;
  });
  ipcMain.handle('poc:result', (_e, test) => {
    if (typeof test !== 'object' || test === null || typeof test.name !== 'string') throw new Error('invalid');
    report.tests.push(test);
    return true;
  });
  // Toca um tom a partir de OUTRO processo (PowerShell), simulando áudio de jogo/app externo.
  ipcMain.handle('poc:externalTone', (_e, hz) => {
    if (!withTone) throw new Error('tone disabled');
    if (typeof hz !== 'number' || hz < 100 || hz > 5000) throw new Error('invalid hz');
    const wav = path.join(app.getPath('temp'), 'opencord-poc-tone.wav');
    fs.writeFileSync(wav, makeWav(hz, 1.6, 0.05));
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${wav}').PlaySync()`], { stdio: 'ignore', windowsHide: true });
    return new Promise((resolve) => ps.on('exit', (code) => resolve({ pid: ps.pid, code })));
  });
  ipcMain.handle('poc:closeTarget', () => {
    if (target && !target.isDestroyed()) target.destroy();
    target = null;
    return true;
  });
  ipcMain.handle('poc:done', () => {
    report.finishedAt = new Date().toISOString();
    if (outFile) {
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
      setTimeout(() => app.quit(), 200);
    }
    return true;
  });

  createWindow();
  if (outFile) {
    setTimeout(() => {
      report.timeout = true;
      fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
      app.exit(2);
    }, 60000);
  }
});

app.on('window-all-closed', () => app.quit());
