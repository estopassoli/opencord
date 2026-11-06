/**
 * Atualização automática no Windows (ADR-0051, substitui o "avisar e baixar" do ADR anterior): o main consulta
 * /downloads/desktop do servidor configurado no app, baixa o instalador novo (mesma origem, https) para a pasta
 * temporária e confere tamanho e SHA-256 publicados pela API. Pronto, ele é instalado:
 * - ao encerrar o OpenCord (silencioso, sem reabrir) — menos no desligamento do Windows (cortaria a instalação);
 * - sozinho com a pessoa longe do PC e fora de chamada/jogo (silencioso, reabre do jeito que estava);
 * - na hora, em "Reiniciar e atualizar agora".
 * Em macOS/Linux nada muda: o clique abre o download.
 */
import { app, net, shell } from 'electron';
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { spawn } from 'node:child_process';
import type { UpdateStatus } from '../shared/ipc';
import {
  hashMatches,
  installerArgs,
  pickUpdate,
  shouldAutoInstall,
  startHiddenAfterUpdate,
  targetFor,
  type AutoInstallState,
  type DesktopFileDto,
  type InstallMode,
} from '../shared/update-core';
import { secureGet } from './secure-store';

const FIRST_CHECK_MS = 15_000;
/** verificação periódica (uma requisição pequena à API) */
const CHECK_EVERY_MS = 20 * 60 * 1000;
/** ao voltar para a janela ou acordar o PC, verifica de novo se a última foi há mais que isto */
const STALE_MS = 5 * 60 * 1000;

let status: UpdateStatus = { state: 'idle' };
let installerPath: string | null = null;
/** SHA-256 do instalador pronto (conferido com o publicado; refeito antes de executar) */
let installerHash: string | null = null;
let busy = false;
/** o instalador já foi chamado (não chamar de novo no will-quit) */
let launched = false;
/** o Windows está desligando/saindo: não começar uma instalação que seria cortada no meio */
let sessionEnding = false;
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

async function download(url: string, file: string, size: number | null, version: string): Promise<string> {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status})`);
  const total = size ?? Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  let lastPct = -1;
  const hash: Hash = createHash('sha256');
  const progress = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      hash.update(chunk);
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
  return hash.digest('hex');
}

function hashOf(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Antes de executar: o arquivo na pasta temporária ainda é o que foi baixado e conferido? */
async function installerIntact(): Promise<boolean> {
  if (!installerPath || !installerHash) return false;
  try {
    if (hashMatches(installerHash, await hashOf(installerPath))) return true;
  } catch {
    /* apagado/inacessível */
  }
  console.warn('instalador da atualização mudou depois do download; descartado');
  installerPath = null;
  installerHash = null;
  set({ state: 'idle' });
  return false;
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (busy) return status;
  lastCheck = Date.now();
  const server = serverUrl();
  const target = targetFor(process.platform, process.arch, Boolean(process.env.APPIMAGE));
  if (!server || !target) return status;
  busy = true;
  // com uma versão já baixada/oferecida, só interessa uma ainda mais nova (saiu outra enquanto esperava o clique)
  const prev = status;
  const baseline = prev.state === 'ready' || prev.state === 'available' ? prev.version : app.getVersion();
  try {
    const res = await net.fetch(new URL('/downloads/desktop', server).toString(), { cache: 'no-store' });
    if (!res.ok) return status;
    const body = (await res.json()) as { files?: DesktopFileDto[] };
    const upd = pickUpdate(body.files ?? [], target, baseline, server);
    if (!upd) return status;
    if (target.platform !== 'windows') {
      set({ state: 'available', version: upd.version, url: upd.url });
      return status;
    }
    const root = path.join(app.getPath('temp'), 'opencord-update');
    // cada versão na própria pasta: a já baixada continua instalável se o download da nova falhar
    const dir = path.join(root, upd.version);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, upd.fileName);
    set({ state: 'downloading', version: upd.version, progress: 0 });
    const digest = await download(upd.url, file, upd.sizeBytes, upd.version);
    if (!hashMatches(upd.sha256, digest)) {
      await rm(dir, { recursive: true, force: true });
      throw new Error(`SHA-256 do instalador ${upd.version} não confere com o publicado`);
    }
    if (!upd.sha256) console.warn('servidor não publica SHA-256; conferidos só origem (https) e tamanho');
    const old = installerPath;
    installerPath = file;
    installerHash = digest;
    set({ state: 'ready', version: upd.version });
    if (old && path.dirname(old) !== dir) await rm(path.dirname(old), { recursive: true, force: true });
  } catch (e) {
    console.warn('verificação de atualização falhou', e);
    // volta ao que havia (versão anterior pronta, ou nada); a próxima verificação tenta de novo
    if (status.state === 'downloading') set(prev.state === 'downloading' ? { state: 'idle' } : prev);
  } finally {
    busy = false;
  }
  return status;
}

/** Instalar sem clique: só no app instalado no Windows (em dev/E2E o "instalador" é falso e nunca roda sozinho). */
const autoAllowed = () => enabled && app.isPackaged && process.platform === 'win32';

/** Chama o instalador (destacado do app) — só com um instalador pronto e conferido, e uma vez só. */
function launch(mode: InstallMode): boolean {
  if (launched || status.state !== 'ready' || !installerPath || !installerHash) return false;
  try {
    const child = spawn(installerPath, installerArgs(mode), { detached: true, stdio: 'ignore' });
    child.on('error', (e) => console.warn('instalador da atualização não abriu', e));
    child.unref();
    launched = true;
    return true;
  } catch (e) {
    console.warn('instalador da atualização não abriu', e);
    return false;
  }
}

/** "Reiniciar e atualizar agora": abre o instalador e fecha o app para os arquivos poderem ser trocados. */
export async function installUpdate(quit: () => void) {
  if (status.state === 'available') {
    await shell.openExternal(status.url);
    return;
  }
  if (status.state !== 'ready' || !installerPath) return;
  // pode ter saído outra versão enquanto esta esperava o clique (relato: 0.2.21 → 0.2.22 → já pedia 0.2.23):
  // confere agora e, se houver, baixa e instala direto a mais nova (falha na conferência = instala a pronta)
  await checkForUpdate();
  if (status.state !== 'ready' || !(await installerIntact())) return;
  if (launch('manual')) quit();
}

/**
 * Chamado a cada minuto pelo main: com a pessoa longe do PC, fora de chamada e sem jogo aberto, instala em silêncio
 * e reabre o app do jeito que estava (escondido na bandeja continua escondido). Nunca interrompe uma chamada:
 * o estado é conferido de novo depois de reconferir o arquivo.
 */
export async function autoInstallIfSafe(state: () => AutoInstallState, quit: () => void) {
  if (!autoAllowed() || busy || launched || !shouldAutoInstall(state())) return;
  if (!(await installerIntact())) return;
  const now = state();
  if (busy || !shouldAutoInstall(now)) return;
  try {
    writeFileSync(markerPath(), JSON.stringify({ hidden: !now.windowVisible, at: Date.now() }));
  } catch {
    /* sem a marca o app só reabre com a janela à mostra */
  }
  if (launch('auto')) quit();
}

/** Encerrar com atualização pronta (bandeja → Encerrar, app.quit): instala em silêncio, sem reabrir. Síncrono. */
export function installOnQuit() {
  if (!autoAllowed() || sessionEnding) return;
  launch('quit');
}

/** Windows desligando/saindo da conta: a instalação seria cortada no meio — fica para a próxima vez. */
export function markSessionEnding() {
  sessionEnding = true;
}

/** "Reiniciar o app" (configuração que pede reinício) com atualização pronta: instala e reabre já na nova. */
export function relaunchIntoUpdate(quit: () => void): boolean {
  if (!autoAllowed() || !launch('auto')) return false;
  quit();
  return true;
}

const markerPath = () => path.join(app.getPath('userData'), 'update-relaunch.json');

/** Na abertura: reaberto pelo instalador depois de instalar sozinho com a janela escondida? (consome a marca) */
export function consumeRelaunchMarker(): boolean {
  let raw: unknown = null;
  try {
    raw = JSON.parse(readFileSync(markerPath(), 'utf8'));
    rmSync(markerPath(), { force: true });
  } catch {
    return false;
  }
  return startHiddenAfterUpdate(raw, process.argv, Date.now());
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
