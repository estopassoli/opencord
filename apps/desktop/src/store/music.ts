import type { MusicControl, MusicState } from '@opencord/contracts';
import { create } from 'zustand';
import { describeError, useSession } from './session';
import { useUi } from './ui';

/**
 * Música da chamada em que estou (ADR-0014). Como no "Assistir juntos", o servidor guarda só o estado (fila,
 * faixa atual, tocando/pausado, posição); cada pessoa toca no player oficial do YouTube. Volume é de cada um.
 */
interface MusicStore {
  state: MusicState | null;
  /** canais de voz com música tocando (indicador, inclusive de chamadas em que não estou) */
  channels: Record<string, true>;
  offsetMs: number;
  /** entrei para ouvir: o player só carrega depois de um clique (navegadores exigem gesto para tocar som) */
  joined: boolean;
  /** volume local (0–100), lembrado neste computador */
  volume: number;
  /** player aberto sem fila ainda (aberto pelo card "Música" em Atividades) */
  open: boolean;
  /** player minimizado: só capa, nome e tempo (lembrado neste computador) */
  minimized: boolean;
  /** pausado só para mim (quem ouve não controla o grupo); ao voltar, pula para onde o DJ está */
  localPaused: boolean;
  setLocalPaused(on: boolean): void;
  setMinimized(on: boolean): void;
  setOpen(on: boolean): void;
  apply(s: MusicState): void;
  observe(s: MusicState): void;
  ended(channelId: string): void;
  reset(): void;
  join(on: boolean): void;
  setVolume(v: number): void;
  load(channelId: string): Promise<void>;
  add(channelId: string, src: { videoId?: string; playlistId?: string }): Promise<boolean>;
  control(action: MusicControl['action'], extra?: { positionSec?: number; trackId?: string }): Promise<void>;
  stop(): Promise<void>;
  expectedPosition(): number;
}

const VOLUME_KEY = 'oc-music-volume';
const readVolume = () => {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 100 ? v : 60;
  } catch {
    return 60;
  }
};

async function cmd<T>(fn: (rt: NonNullable<ReturnType<typeof useSession.getState>['realtime']>) => Promise<T>) {
  const rt = useSession.getState().realtime;
  if (!rt) throw new Error('sem conexão');
  return fn(rt);
}

export const useMusic = create<MusicStore>()((set, get) => ({
  state: null,
  channels: {},
  offsetMs: 0,
  joined: false,
  volume: readVolume(),
  open: false,
  minimized: (() => {
    try {
      return localStorage.getItem('oc-music-min') === '1';
    } catch {
      return false;
    }
  })(),
  setMinimized(on) {
    try {
      localStorage.setItem('oc-music-min', on ? '1' : '0');
    } catch {
      /* vale só nesta sessão */
    }
    set({ minimized: on });
  },
  setOpen(on) {
    set({ open: on });
  },
  localPaused: false,
  setLocalPaused(on) {
    set({ localPaused: on });
  },
  observe(s) {
    set((st) => ({ channels: { ...st.channels, [s.channelId]: true } }));
  },
  apply(s) {
    get().observe(s);
    const cur = get().state;
    // eventos podem chegar fora de ordem: só avança
    if (cur && cur.channelId === s.channelId && s.revision < cur.revision) return;
    set({ state: s, offsetMs: s.serverNow - Date.now() });
  },
  ended(channelId) {
    set((st) => {
      const { [channelId]: _gone, ...channels } = st.channels;
      return { channels };
    });
    if (get().state?.channelId === channelId) set({ state: null, joined: false, open: false, localPaused: false });
  },
  reset() {
    set({ state: null, joined: false, open: false, localPaused: false });
  },
  join(on) {
    set({ joined: on });
  },
  setVolume(v) {
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
    set({ volume: v });
  },
  async load(channelId) {
    try {
      const s = await cmd((rt) => rt.command('music:get', { channelId }));
      if (s) get().apply(s);
      else set({ state: null, joined: false });
    } catch {
      /* sem música ou sem conexão */
    }
  },
  async add(channelId, src) {
    try {
      get().apply(await cmd((rt) => rt.command('music:add', { channelId, ...src })));
      set({ joined: true, open: false, localPaused: false });
      return true;
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível adicionar: ${describeError(e)}`);
      return false;
    }
  },
  async control(action, extra = {}) {
    const s = get().state;
    if (!s) return;
    try {
      const positionSec =
        extra.positionSec === undefined ? undefined : Math.max(0, Math.round(extra.positionSec * 10) / 10);
      get().apply(
        await cmd((rt) =>
          rt.command('music:control', {
            channelId: s.channelId,
            action,
            ...(positionSec === undefined ? {} : { positionSec }),
            ...(extra.trackId ? { trackId: extra.trackId } : {}),
          }),
        ),
      );
    } catch {
      /* o próximo estado do servidor corrige */
    }
  },
  async stop() {
    const s = get().state;
    if (!s) return;
    await cmd((rt) => rt.command('music:stop', { channelId: s.channelId })).catch(() => undefined);
    set({ state: null, joined: false, open: false });
  },
  expectedPosition() {
    const { state: s, offsetMs } = get();
    if (!s) return 0;
    if (!s.playing) return s.positionSec;
    return s.positionSec + (Date.now() + offsetMs - s.updatedAt) / 1000;
  },
}));
