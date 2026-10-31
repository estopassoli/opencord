/**
 * Clipes (ADR-0022), lado do processo principal: escolhe a tela a capturar (a principal), grava o arquivo pronto e
 * cuida da biblioteca de clipes na pasta escolhida (padrão Vídeos\OpenCord): listar, ler, apagar, copiar, exportar.
 * Ao lado de cada `<nome>.mp4` ficam `<nome>.json` (jogo, ícone, data, duração) e `<nome>.jpg` (miniatura).
 * O vídeo em si é codificado e guardado na memória pela janela (WebCodecs).
 */
import { app, BrowserWindow, clipboard, desktopCapturer, dialog, screen, shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClipExportArgs, ClipInfo, ClipSaveArgs } from '../shared/ipc';
import { selectSource } from './capture';

const dirFile = () => path.join(app.getPath('userData'), 'clips-dir.json');
const defaultDir = () => path.join(app.getPath('videos'), 'OpenCord');

/** Pasta dos clipes (escolhida pela pessoa ou a padrão). */
export function clipsDir(): string {
  try {
    if (existsSync(dirFile())) {
      const d = (JSON.parse(readFileSync(dirFile(), 'utf8')) as { dir?: unknown }).dir;
      if (typeof d === 'string' && path.isAbsolute(d)) return d;
    }
  } catch {
    /* arquivo inválido: usa a padrão */
  }
  return defaultDir();
}

/** Abre o seletor de pasta; devolve a pasta em uso depois da escolha. */
export async function chooseClipsDir(): Promise<string> {
  const win = BrowserWindow.getFocusedWindow();
  const opts: Electron.OpenDialogOptions = {
    title: 'Pasta dos clipes',
    defaultPath: clipsDir(),
    properties: ['openDirectory', 'createDirectory'],
  };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const picked = r.canceled ? null : r.filePaths[0];
  if (picked) writeFileSync(dirFile(), JSON.stringify({ dir: picked }));
  return clipsDir();
}

/** Autoriza a próxima captura: tela principal + som do computador. */
export async function prepareClipCapture(): Promise<boolean> {
  const primary = String(screen.getPrimaryDisplay().id);
  const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const src = screens.find((s) => s.display_id === primary) ?? screens[0];
  if (!src) return false;
  selectSource({ sourceId: src.id, systemAudio: true });
  return true;
}

// caracteres proibidos em nomes de arquivo do Windows (e de controle)
const safe = (s: string) =>
  [...s]
    .filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(ch))
    .join('')
    .trim() || 'Clipe';
const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

interface Sidecar {
  game: string;
  icon?: string;
  steamAppId?: number;
  createdAt: number;
  durationMs: number;
}

export async function saveClip(a: ClipSaveArgs): Promise<string> {
  const dir = clipsDir();
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, `${safe(a.game)} ${stamp(new Date())}`);
  const file = `${base}.mp4`;
  await writeFile(file, a.data);
  const meta: Sidecar = {
    game: a.game,
    createdAt: Date.now(),
    durationMs: a.durationMs,
    ...(a.icon ? { icon: a.icon } : {}),
    ...(a.steamAppId ? { steamAppId: a.steamAppId } : {}),
  };
  await writeFile(`${base}.json`, JSON.stringify(meta));
  if (a.thumb) await writeFile(`${base}.jpg`, a.thumb);
  return file;
}

/** Só arquivos .mp4 dentro da pasta de clipes (nada de caminhos vindos da janela fora dela). */
function inside(file: string): string {
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== path.resolve(clipsDir()) || !/\.mp4$/i.test(resolved))
    throw new Error('fora da pasta de clipes');
  return resolved;
}

export async function listClips(): Promise<ClipInfo[]> {
  const dir = clipsDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: ClipInfo[] = [];
  for (const name of names) {
    if (!/\.mp4$/i.test(name)) continue;
    const file = path.join(dir, name);
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) continue;
    const base = file.replace(/\.mp4$/i, '');
    let meta: Partial<Sidecar> = {};
    try {
      meta = JSON.parse(await readFile(`${base}.json`, 'utf8')) as Partial<Sidecar>;
    } catch {
      /* clipe sem dados (copiado de fora): só o arquivo */
    }
    const thumb = await readFile(`${base}.jpg`).catch(() => null);
    out.push({
      file,
      name: name.replace(/\.mp4$/i, ''),
      game: typeof meta.game === 'string' ? meta.game : null,
      icon: typeof meta.icon === 'string' ? meta.icon : null,
      steamAppId: typeof meta.steamAppId === 'number' ? meta.steamAppId : null,
      createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : st.mtimeMs,
      durationMs: typeof meta.durationMs === 'number' ? meta.durationMs : 0,
      sizeBytes: st.size,
      thumb: thumb ? `data:image/jpeg;base64,${thumb.toString('base64')}` : null,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
}

export async function readClip(file: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await readFile(inside(file)));
}

export async function deleteClip(file: string) {
  const f = inside(file);
  const base = f.replace(/\.mp4$/i, '');
  await Promise.all([f, `${base}.json`, `${base}.jpg`].map((p) => rm(p, { force: true })));
}

export function revealClip(file: string) {
  shell.showItemInFolder(inside(file));
}

/** Copia o arquivo para a área de transferência (colar no Explorer, no WhatsApp, no próprio chat). */
export async function copyClip(file: string) {
  const f = inside(file);
  if (process.platform !== 'win32') return clipboard.writeText(f);
  // lista de arquivos (CF_HDROP) pelo PowerShell: o clipboard do Electron só copia texto e imagem
  await new Promise<void>((resolve, reject) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath '${f.replace(/'/g, "''")}'`],
      { windowsHide: true, timeout: 10_000 },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}

/** Exporta um vídeo/áudio (cortado na janela) com "Salvar como". Devolve o caminho ou null se cancelou. */
export async function exportClip(a: ClipExportArgs): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow();
  const ext = a.kind === 'audio' ? 'm4a' : 'mp4';
  const opts = {
    title: a.kind === 'audio' ? 'Exportar áudio do clipe' : 'Exportar clipe',
    defaultPath: path.join(clipsDir(), `${safe(a.name)}.${ext}`),
    filters: [a.kind === 'audio' ? { name: 'Áudio', extensions: ['m4a'] } : { name: 'Vídeo', extensions: ['mp4'] }],
  };
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (r.canceled || !r.filePath) return null;
  await writeFile(r.filePath, a.data);
  return r.filePath;
}
