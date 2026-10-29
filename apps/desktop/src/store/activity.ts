import type { ActivityState } from '@opencord/contracts';
import { create } from 'zustand';
import { describeError, useSession } from './session';
import { useUi } from './ui';

/**
 * Atividade da chamada em que estou ("Assistir juntos", ADR-0009). O servidor guarda só o estado; cada um toca o
 * vídeo no player oficial do YouTube. `offsetMs` estima a diferença entre o relógio do servidor e o meu.
 */
interface ActivityStore {
  state: ActivityState | null;
  /** atividades em andamento em canais de voz (indicador na barra lateral, inclusive de chamadas em que não estou) */
  channels: Record<string, Pick<ActivityState, 'videoId' | 'title'>>;
  offsetMs: number;
  /** entrei para assistir (o player só carrega depois de um clique: navegadores exigem gesto para tocar som) */
  joined: boolean;
  apply(s: ActivityState): void;
  observe(s: ActivityState): void;
  ended(channelId: string): void;
  reset(): void;
  join(on: boolean): void;
  load(channelId: string): Promise<void>;
  start(channelId: string, videoId: string): Promise<void>;
  control(action: 'play' | 'pause' | 'seek', positionSec: number): Promise<void>;
  stop(): Promise<void>;
  /** posição esperada agora (s), pelo relógio do servidor */
  expectedPosition(): number;
}

async function cmd<T>(fn: (rt: NonNullable<ReturnType<typeof useSession.getState>['realtime']>) => Promise<T>) {
  const rt = useSession.getState().realtime;
  if (!rt) throw new Error('sem conexão');
  return fn(rt);
}

export const useActivity = create<ActivityStore>()((set, get) => ({
  state: null,
  channels: {},
  offsetMs: 0,
  joined: false,
  observe(s) {
    set((st) => ({ channels: { ...st.channels, [s.channelId]: { videoId: s.videoId, title: s.title } } }));
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
    if (get().state?.channelId === channelId) set({ state: null, joined: false });
  },
  reset() {
    set({ state: null, joined: false });
  },
  join(on) {
    set({ joined: on });
  },
  async load(channelId) {
    try {
      const s = await cmd((rt) => rt.command('activity:get', { channelId }));
      if (s) get().apply(s);
      else set({ state: null, joined: false });
    } catch {
      /* sem atividade ou sem conexão: nada a mostrar */
    }
  },
  async start(channelId, videoId) {
    try {
      const s = await cmd((rt) => rt.command('activity:youtube:start', { channelId, videoId }));
      get().apply(s);
      set({ joined: true });
      useUi.getState().focusStream('activity');
    } catch (e) {
      useUi.getState().toast('error', `Não foi possível iniciar: ${describeError(e)}`);
    }
  },
  async control(action, positionSec) {
    const s = get().state;
    if (!s) return;
    try {
      get().apply(
        await cmd((rt) =>
          rt.command('activity:youtube:control', {
            channelId: s.channelId,
            action,
            positionSec: Math.max(0, Math.round(positionSec * 10) / 10),
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
    await cmd((rt) => rt.command('activity:stop', { channelId: s.channelId })).catch(() => undefined);
    set({ state: null, joined: false });
  },
  expectedPosition() {
    const { state: s, offsetMs } = get();
    if (!s) return 0;
    if (!s.playing) return s.positionSec;
    return s.positionSec + (Date.now() + offsetMs - s.updatedAt) / 1000;
  },
}));
