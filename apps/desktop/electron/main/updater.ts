/**
 * Atualização "avisar e baixar" (decisão do mantenedor em docs/DECISIONS.md): os instaladores não são assinados,
 * então nada é instalado sozinho. O main consulta /downloads/desktop do servidor configurado no app; no Windows
 * baixa o instalador novo (mesma origem, https) para a pasta temporária e só o executa quando a pessoa clica em
 * "Atualização pronta" — o SmartScreen e o instalador pedem confirmação. Em macOS/Linux o clique abre o download.
 */
import { app, net, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { spawn } from 'node:child_process';
import type { UpdateStatus } from '../shared/ipc';
import { pickUpdate, targetFor, type DesktopFileDto } from '../shared/update-core';
import { secureGet } from './secure-store';

const FIRST_CHECK_MS = 15_000;
/** verificação periódica (uma requisição pequena à API) */
const CHECK_EVERY_MS = 20 * 60 * 1000;
/** ao voltar para a janela ou acordar o PC, verifica de novo se a última foi há mais que isto */
const STALE_MS = 5 * 60 * 1000;

let status: UpdateStatus = { state: 'idle' };
let installerPath: string | null = null;
let busy = false;
let enabled = false;
let lastCheck = 0;
let notify: (s: UpdateStatus) => void = () => undefined;

const set = (s: UpdateStatus) => {
  status = s;
  notify(s);
};

export const updateStatus = () => status;

/** Servidor do app (o mesmo do login); sem ele não há de onde atualizar. */
function serverUrl(): string | null {
  return secureGet('serverUrl') ?? process.env.OPENCORD_UPDATE_SERVER ?? null;
}

async function download(url: string, file: string, size: number | null, version: string) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status})`);
  const total = size ?? Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  let lastPct = -1;
  const progress = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      const pct = total ? Math.floor((received / total) * 100) : 0;
      if (pct !== lastPct) {
        lastPct = pct;
        set({ state: 'downloading', version, progress: pct });
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), progress, createWriteStream(file));
  const st = await stat(file);
  if (size !== null && st.size !== size) throw new Error('tamanho do instalador não confere');
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (busy || status.state === 'ready') return status;
  lastCheck = Date.now();
  const server = serverUrl();
  const target = targetFor(process.platform, process.arch, Boolean(process.env.APPIMAGE));
  if (!server || !target) return status;
  busy = true;
  try {
    const res = await net.fetch(new URL('/downloads/desktop', server).toString(), { cache: 'no-store' });
    if (!res.ok) return status;
    const body = (await res.json()) as { files?: DesktopFileDto[] };
    const upd = pickUpdate(body.files ?? [], target, app.getVersion(), server);
    if (!upd) return status;
    if (target.platform !== 'windows') {
      set({ state: 'available', version: upd.version, url: upd.url });
      return status;
    }
    const dir = path.join(app.getPath('temp'), 'opencord-update');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, upd.fileName);
    set({ state: 'downloading', version: upd.version, progress: 0 });
    await download(upd.url, file, upd.sizeBytes, upd.version);
    installerPath = file;
    set({ state: 'ready', version: upd.version });
  } catch (e) {
    console.warn('verificação de atualização falhou', e);
    // volta a idle: a próxima verificação tenta de novo
    if (status.state === 'downloading') set({ state: 'idle' });
  } finally {
    busy = false;
  }
  return status;
}

/** Clique em "Atualização pronta": abre o instalador e fecha o app para os arquivos poderem ser trocados. */
export async function installUpdate(quit: () => void) {
  if (status.state === 'available') {
    await shell.openExternal(status.url);
    return;
  }
  if (status.state !== 'ready' || !installerPath) return;
  const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
  child.unref();
  quit();
}

/** Janela voltou ao foco / PC acordou: verifica se a última verificação já ficou velha. */
export function checkIfStale() {
  if (enabled && Date.now() - lastCheck > STALE_MS) void checkForUpdate();
}

export function startUpdater(onStatus: (s: UpdateStatus) => void) {
  notify = onStatus;
  // só no app instalado: em desenvolvimento/E2E o app roda sem empacotar (OPENCORD_UPDATE_SERVER força, para testes)
  if (!app.isPackaged && !process.env.OPENCORD_UPDATE_SERVER) return;
  enabled = true;
  setTimeout(() => void checkForUpdate(), Number(process.env.OPENCORD_UPDATE_DELAY_MS ?? FIRST_CHECK_MS));
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}
