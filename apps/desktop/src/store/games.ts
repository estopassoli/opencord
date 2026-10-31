import type { PlayingGame, UserSettings } from '@opencord/contracts';
import { create } from 'zustand';
import type { DetectedGameDto } from '../../electron/shared/ipc';
import { bridge } from '../lib/bridge';
import { useData } from './data';
import { useSession } from './session';

/**
 * Jogo que estou jogando (ADR-0021): o app desktop detecta (Steam ou executável conhecido/cadastrado) e aqui se
 * avisa o servidor, que repassa a quem vê minha presença. "Mostrar o jogo" desligado = os outros não recebem nada.
 */
interface GamesStore {
  /** detectado neste computador (mesmo com "mostrar" desligado: usado pelos clipes) */
  mine: DetectedGameDto | null;
}

export const useGames = create<GamesStore>()(() => ({ mine: null }));

/** reenvio periódico: o servidor esquece o jogo em 30 min se o app sumir sem avisar */
const REFRESH_MS = 10 * 60_000;
let refresh: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastSent: string | undefined;

const shown = (): PlayingGame | null => {
  const g = useGames.getState().mine;
  if (!g || useData.getState().settings?.games.showPlaying === false) return null;
  return {
    name: g.name,
    startedAt: g.startedAt,
    ...(g.steamAppId ? { steamAppId: g.steamAppId } : {}),
    ...(g.icon ? { icon: g.icon } : {}),
  };
};

/**
 * Manda ao servidor o jogo atual (ou null) se mudou. `force` reenvia mesmo igual: ao (re)conectar e no reenvio
 * periódico.
 */
export function publishGame(force = false) {
  const rt = useSession.getState().realtime;
  if (!rt || !bridge) return;
  const game = shown();
  const key = JSON.stringify(game);
  if (!force && key === lastSent) return;
  lastSent = key;
  void rt.command('presence:game', { game }).catch(() => {
    lastSent = undefined;
  });
  if (refresh) clearInterval(refresh);
  refresh = game ? setInterval(() => publishGame(true), REFRESH_MS) : null;
}

/** Liga a detecção conforme as configurações (chamado ao aplicar as configurações). */
export function configureGames(s: UserSettings) {
  if (!bridge) return;
  if (!started) {
    started = true;
    bridge.on('game', (g) => {
      useGames.setState({ mine: g });
      publishGame();
    });
    void bridge.games.current().then((g) => useGames.setState({ mine: g }));
  }
  void bridge.games.configure({ enabled: true, custom: s.games.custom }).catch(() => undefined);
  publishGame();
}
