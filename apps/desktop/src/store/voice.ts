import type { UserSettings, VoiceJoinResponse } from '@opencord/contracts';
import {
  initialStreamState,
  initialVoiceState,
  PushToTalk,
  streamReducer,
  voiceReducer,
  type StreamEvent,
  type StreamProfileId,
  type StreamState,
  type VoiceEvent,
  type VoiceState,
} from '@opencord/media';
import { create } from 'zustand';
import { bridge } from '../lib/bridge';
import { RECONNECT, VoiceEngine, type AudioPrefs, type MediaStats, type ParticipantView } from '../voice/engine';
import { useData } from './data';
import { api, describeError } from './session';
import { useUi } from './ui';

interface VoiceStore {
  machine: VoiceState;
  stream: StreamState;
  serverId: string | null;
  participants: ParticipantView[];
  selfMute: boolean;
  selfDeaf: boolean;
  camera: boolean;
  pttActive: boolean;
  stats: MediaStats | null;
  perms: { canSpeak: boolean; canVideo: boolean; canStream: boolean };
  join(channelId: string, serverId: string): Promise<void>;
  leave(): Promise<void>;
  forcedOut(reason: string): void;
  toggleMute(): Promise<void>;
  toggleDeafen(): Promise<void>;
  toggleCamera(): Promise<void>;
  setPtt(down: boolean): void;
  setUserVolume(userId: string, v: number): void;
  openStreamPicker(): void;
  cancelStreamPicker(): void;
  startStream(sourceId: string | null, withAudio: boolean, profile: StreamProfileId): Promise<void>;
  stopStream(): Promise<void>;
  watch(identity: string, on: boolean): void;
  applySettings(s: UserSettings): void;
  engine(): VoiceEngine | null;
}

let engine: VoiceEngine | null = null;
let ptt: PushToTalk | null = null;

function prefsFrom(s: UserSettings | null): AudioPrefs {
  const a = s?.audio;
  return {
    inputDeviceId: a?.inputDeviceId ?? null,
    outputDeviceId: a?.outputDeviceId ?? null,
    echoCancellation: a?.echoCancellation ?? true,
    noiseSuppression: a?.noiseSuppression ?? true,
    autoGainControl: a?.autoGainControl ?? true,
    inputMode: a?.inputMode ?? 'vad',
    vadThresholdDb: a?.vadThreshold ?? -50,
    inputVolume: a?.inputVolume ?? 1,
    outputVolume: a?.outputVolume ?? 1,
  };
}

export const useVoice = create<VoiceStore>()((set, get) => {
  const dispatch = (e: VoiceEvent) => set((s) => ({ machine: voiceReducer(s.machine, e) }));
  const sdispatch = (e: StreamEvent) => set((s) => ({ stream: streamReducer(s.stream, e) }));

  const syncTray = () => {
    const s = get();
    void bridge
      ?.setTrayVoiceState({ inVoice: s.machine.status !== 'disconnected', muted: s.selfMute, deafened: s.selfDeaf })
      .catch(() => undefined);
  };

  const pushState = () => {
    const { selfMute, selfDeaf, machine } = get();
    if (machine.status === 'disconnected') return;
    void api()
      .request('PATCH', '/voice/state', { selfMute, selfDeaf })
      .catch(() => undefined);
    syncTray();
  };

  async function connectWith(j: VoiceJoinResponse, generation: number) {
    const s = get();
    engine ??= new VoiceEngine(
      {
        onParticipants: (participants) => set({ participants }),
        onConnectionLost: () => dispatch({ type: 'CONNECTION_LOST' }),
        onReconnected: () => dispatch({ type: 'RECONNECTED' }),
        onDisconnected: (reason) => void handleDisconnect(reason),
        onStreamEnded: () => {
          sdispatch({ type: 'SOURCE_ENDED' });
          void get().stopStream();
        },
        onStats: (stats) => set({ stats }),
      },
      prefsFrom(useData.getState().settings),
    );
    await engine.connect(j.url, j.token, { canSpeak: j.canSpeak, selfMute: s.selfMute, selfDeaf: s.selfDeaf });
    dispatch({ type: 'CONNECTED', generation });
  }

  /** SFU caiu sem ser intencional: reentrar com token novo e backoff; remoção/duplicação não reconecta. */
  async function handleDisconnect(reason: 'removed' | 'replaced' | 'failed' | 'ended') {
    const { machine, serverId } = get();
    if (reason === 'removed') return get().forcedOut('Você foi removido da chamada.');
    if (reason === 'replaced') return get().forcedOut('Você entrou nesta chamada em outro dispositivo.');
    if (!machine.channelId || !serverId) return;
    sdispatch({ type: 'RESET' });
    for (let attempt = 0; attempt < RECONNECT.maxAttempts; attempt++) {
      dispatch({ type: 'CONNECTION_LOST' });
      await new Promise((r) => setTimeout(r, RECONNECT.delay(attempt)));
      const cur = get().machine;
      if (cur.status !== 'reconnecting' || cur.channelId !== machine.channelId) return;
      try {
        await engine?.disconnect();
        const j = await api().request<VoiceJoinResponse>('POST', `/voice/channels/${machine.channelId}/join`);
        await connectWith(j, cur.generation);
        dispatch({ type: 'RECONNECTED' });
        return;
      } catch {
        /* próxima tentativa */
      }
    }
    dispatch({ type: 'FAILED', error: 'Não foi possível reconectar à chamada.' });
    await engine?.disconnect();
  }

  return {
    machine: initialVoiceState,
    stream: initialStreamState,
    serverId: null,
    participants: [],
    selfMute: false,
    selfDeaf: false,
    camera: false,
    pttActive: false,
    stats: null,
    perms: { canSpeak: false, canVideo: false, canStream: false },
    engine: () => engine,

    async join(channelId, serverId) {
      const prev = get().machine;
      if (
        prev.channelId === channelId &&
        (prev.status === 'connected' || prev.status === 'connecting' || prev.status === 'authorizing')
      )
        return;
      if (engine && prev.status !== 'disconnected') {
        await get()
          .stopStream()
          .catch(() => undefined);
        await engine.disconnect();
      }
      dispatch({ type: 'JOIN', channelId });
      const gen = get().machine.generation;
      set({ serverId, camera: false, stream: initialStreamState });
      try {
        const j = await api().request<VoiceJoinResponse>('POST', `/voice/channels/${channelId}/join`);
        if (get().machine.generation !== gen) return; // usuário trocou/saiu nesse meio-tempo
        set({ perms: { canSpeak: j.canSpeak, canVideo: j.canVideo, canStream: j.canStream } });
        dispatch({ type: 'AUTHORIZED', generation: gen });
        await connectWith(j, gen);
        if (get().selfMute || get().selfDeaf) pushState();
        syncTray();
      } catch (e) {
        dispatch({ type: 'FAILED', error: describeError(e), generation: gen });
        await engine?.disconnect().catch(() => undefined);
        await api()
          .request('POST', '/voice/leave')
          .catch(() => undefined);
        useUi.getState().toast('error', `Falha ao entrar na chamada: ${describeError(e)}`);
      }
    },

    async leave() {
      ptt?.reset();
      await engine?.disconnect().catch(() => undefined);
      const wasIn = get().machine.status !== 'disconnected';
      dispatch({ type: 'LEAVE' });
      set({ serverId: null, participants: [], camera: false, stream: initialStreamState, stats: null });
      if (wasIn) await useApiSafe((a) => a.request('POST', '/voice/leave'));
      syncTray();
    },

    forcedOut(reason) {
      ptt?.reset();
      void engine?.disconnect();
      dispatch({ type: 'FORCED_OUT', reason });
      set({ serverId: null, participants: [], camera: false, stream: initialStreamState });
      useUi.getState().toast('error', reason);
      syncTray();
    },

    async toggleMute() {
      const selfMute = !get().selfMute;
      // desmutar enquanto ensurdecido também remove o ensurdecer
      const selfDeaf = selfMute ? get().selfDeaf : false;
      set({ selfMute, selfDeaf });
      await engine?.setDeafen(selfDeaf);
      await engine?.setSelfMute(selfMute);
      pushState();
      syncTray();
    },

    async toggleDeafen() {
      const selfDeaf = !get().selfDeaf;
      set({ selfDeaf, selfMute: selfDeaf ? true : false });
      await engine?.setDeafen(selfDeaf);
      await engine?.setSelfMute(selfDeaf);
      pushState();
      syncTray();
    },

    async toggleCamera() {
      const on = !get().camera;
      try {
        await engine?.setCamera(on, useData.getState().settings?.video.cameraDeviceId ?? null);
        set({ camera: on });
      } catch (e) {
        useUi.getState().toast('error', `Câmera indisponível: ${describeError(e)}`);
      }
    },

    setPtt(down) {
      ptt ??= new PushToTalk((open) => {
        engine?.setPtt(open);
        set({ pttActive: open });
      }, useData.getState().settings?.audio.pttReleaseDelayMs ?? 200);
      if (down) ptt.down();
      else ptt.up();
    },

    setUserVolume(userId, v) {
      engine?.setUserVolume(userId, v);
    },

    openStreamPicker() {
      if (get().machine.status !== 'connected')
        return useUi.getState().toast('info', 'Entre em um canal de voz para transmitir.');
      if (!get().perms.canStream)
        return useUi.getState().toast('error', 'Você não tem permissão para transmitir neste canal.');
      sdispatch({ type: 'OPEN_PICKER' });
      useUi.getState().openModal({ kind: 'screen-picker' });
    },

    cancelStreamPicker() {
      sdispatch({ type: 'CANCEL' });
      useUi.getState().openModal(null);
    },

    async startStream(sourceId, withAudio, profile) {
      sdispatch({
        type: 'START',
        sourceId: sourceId ?? 'browser',
        sourceKind: sourceId?.startsWith('window:') ? 'window' : 'screen',
        withAudio,
      });
      useUi.getState().openModal(null);
      try {
        const codec = useData.getState().settings?.video.preferredCodec ?? 'h264';
        const r = await (engine as VoiceEngine).startStream(sourceId, withAudio, profile, codec);
        // `live` só após a publicação ser confirmada pela SFU
        sdispatch({ type: 'PUBLISHED', audioPublished: r.audioPublished });
        if (withAudio && !r.audioPublished)
          useUi.getState().toast('info', 'Transmitindo sem áudio: o áudio do sistema não pôde ser capturado.');
      } catch (e) {
        sdispatch({ type: 'ERROR', error: describeError(e) });
        useUi.getState().toast('error', `Não foi possível iniciar a transmissão: ${describeError(e)}`);
      }
    },

    async stopStream() {
      if (get().stream.status === 'idle') return;
      sdispatch({ type: 'STOP' });
      await engine?.stopStream();
      sdispatch({ type: 'STOPPED' });
      const err = get().stream.error;
      if (err) useUi.getState().toast('info', `Transmissão encerrada: ${err}`);
    },

    watch(identity, on) {
      engine?.watch(identity, on);
      if (on) useUi.getState().focusStream(identity);
    },

    applySettings(s) {
      void engine?.applyPrefs(prefsFrom(s));
      ptt?.setReleaseDelay(s.audio.pttReleaseDelayMs);
      for (const [id, v] of Object.entries(s.perUserVolume)) engine?.setUserVolume(id, v);
    },
  };
});

async function useApiSafe(fn: (a: ReturnType<typeof api>) => Promise<unknown>) {
  try {
    await fn(api());
  } catch {
    /* sem sessão/servidor: o servidor encerra por timeout/reconcile */
  }
}

export const isInCall = (s: VoiceState) => s.status !== 'disconnected' && s.status !== 'failed';
export type { MediaStats, ParticipantView };
