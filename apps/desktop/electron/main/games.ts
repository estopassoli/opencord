/**
 * Detector do jogo aberto (ADR-0021): a cada 15 s olha o registro da Steam e a lista de processos do Windows
 * (`reg` e `tasklist`, sem módulo nativo) e avisa a janela quando o jogo muda. Fora do Windows não faz nada.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import {
  GAME_ICON_MAX,
  parseInstallDir,
  parseLibraryFolders,
  parseRegDword,
  parseRegString,
  parseTasklist,
  pickableProcesses,
  pickGame,
  sameGame,
  type CustomGame,
  type DetectedGame,
} from '../shared/games-core';

const POLL_MS = 15_000;
const STEAM_KEY = 'HKCU\\Software\\Valve\\Steam';

const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<string>((resolve) =>
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
        ...(env ? { env: { ...process.env, ...env } } : {}),
      },
      (err, out) => resolve(err ? '' : out),
    ),
  );

async function runningExes(): Promise<string[]> {
  return parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh']));
}

async function steamGame(): Promise<{ id: number; name: string | null }> {
  const id = parseRegDword(await run('reg', ['query', STEAM_KEY, '/v', 'RunningAppID']), 'RunningAppID');
  if (!id) return { id: 0, name: null };
  const name = parseRegString(await run('reg', ['query', `${STEAM_KEY}\\Apps\\${id}`, '/v', 'Name']), 'Name');
  return { id, name };
}

/** Caminho do executável em execução: pelo nome (fora da Steam) ou pela pasta do jogo (Steam). */
async function runningPath(game: DetectedGame): Promise<string | null> {
  // o valor vai por variável de ambiente, nunca dentro do script: nomes vêm da Steam/das configurações e podem ter
  // aspas (inclusive as Unicode, que o PowerShell também aceita como delimitador)
  let filter: string;
  let arg: string;
  if (game.steamAppId) {
    const dir = await steamGameDir(game.steamAppId);
    if (!dir) return null;
    arg = dir + path.sep;
    filter = `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:OPENCORD_ARG, 'OrdinalIgnoreCase') }`;
  } else if (game.exe) {
    arg = game.exe.replace(/\.exe$/i, '');
    filter = `Get-Process -Name $env:OPENCORD_ARG -ErrorAction SilentlyContinue`;
  } else return null;
  const out = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `${filter} | Select-Object -First 1 -ExpandProperty Path`],
    { OPENCORD_ARG: arg },
  );
  const p = out.trim().split(/\r?\n/)[0]?.trim();
  return p && /\.exe$/i.test(p) ? p : null;
}

/** Pasta do jogo da Steam: bibliotecas do libraryfolders.vdf + installdir do appmanifest. */
async function steamGameDir(appId: number): Promise<string | null> {
  const steam = parseRegString(await run('reg', ['query', STEAM_KEY, '/v', 'SteamPath']), 'SteamPath');
  if (!steam) return null;
  const vdf = await readFile(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => '');
  for (const lib of [steam, ...parseLibraryFolders(vdf)]) {
    const acf = await readFile(path.join(lib, 'steamapps', `appmanifest_${appId}.acf`), 'utf8').catch(() => null);
    const dir = acf && parseInstallDir(acf);
    if (dir) return path.join(lib, 'steamapps', 'common', dir);
  }
  return null;
}

const icons = new Map<string, string | null>();
/** Ícone do executável do jogo (32×32), guardado por jogo. */
async function iconOf(game: DetectedGame): Promise<string | null> {
  const key = game.steamAppId ? `steam:${game.steamAppId}` : `exe:${game.exe ?? game.name}`;
  if (icons.has(key)) return icons.get(key)!;
  let icon: string | null = null;
  try {
    const exe = await runningPath(game);
    if (exe) {
      const img = await app.getFileIcon(exe, { size: 'normal' });
      const url = img.isEmpty() ? '' : img.toDataURL();
      if (url && url.length <= GAME_ICON_MAX) icon = url;
    }
  } catch {
    /* sem ícone: a interface mostra o controle */
  }
  icons.set(key, icon);
  return icon;
}

export interface GameUpdate {
  game: (DetectedGame & { startedAt: number }) | null;
}

export class GameDetector {
  private timer: NodeJS.Timeout | null = null;
  private current: (DetectedGame & { startedAt: number }) | null = null;
  private custom: CustomGame[] = [];
  private busy = false;

  constructor(private readonly onChange: (u: GameUpdate) => void) {}

  get game() {
    return this.current;
  }

  /** liga/desliga e atualiza os jogos cadastrados pela pessoa */
  configure(enabled: boolean, custom: CustomGame[]) {
    this.custom = custom;
    if (process.platform !== 'win32') return;
    if (enabled && !this.timer) {
      this.timer = setInterval(() => void this.tick(), POLL_MS);
      void this.tick();
    } else if (!enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.set(null);
    } else if (enabled) void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** programas abertos agora, para a pessoa escolher qual é jogo */
  async processes(): Promise<string[]> {
    return process.platform === 'win32' ? pickableProcesses(await runningExes()) : [];
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const [exes, steam] = await Promise.all([runningExes(), steamGame()]);
      this.set(pickGame(exes, this.custom, steam.id, steam.name));
    } finally {
      this.busy = false;
    }
  }

  private set(game: DetectedGame | null) {
    if (sameGame(game, this.current)) return;
    const cur = game ? { ...game, startedAt: Date.now() } : null;
    this.current = cur;
    this.onChange({ game: cur });
    // o ícone vem depois (lê o executável): avisa de novo se o jogo ainda for o mesmo
    if (cur)
      void iconOf(cur).then((icon) => {
        if (icon && this.current === cur) {
          this.current = { ...cur, icon };
          this.onChange({ game: this.current });
        }
      });
  }
}
