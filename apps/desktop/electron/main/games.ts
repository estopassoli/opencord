/**
 * Detector do jogo aberto (ADR-0021): a cada 15 s olha o registro da Steam e a lista de processos do Windows
 * (`reg` e `tasklist`, sem módulo nativo) e avisa a janela quando o jogo muda. Fora do Windows não faz nada.
 */
import { execFile } from 'node:child_process';
import {
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

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      resolve(err ? '' : out),
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
    this.current = game ? { ...game, startedAt: Date.now() } : null;
    this.onChange({ game: this.current });
  }
}
