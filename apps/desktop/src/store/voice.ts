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
import { playSound } from '../lib/sounds';
import { useActivity } from './activity';
import { useMusic } from './music';
import { useScenes } from './scenes';
import { nameFor } from '../lib/names';

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
  /** nome da janela/tela que eu estou transmitindo (para o cabeçalho) */
  streamSource: string | null;
  perms: { canSpeak: boolean; canVideo: boolean; canStream: boolean };
  join(channelId: string, serverId: string): Promise<void>;
  leave(): Promise<void>;
  forcedOut(reason: string): void;
  toggleMute(): Promise<void>;
  toggleDeafen(): Promise<void>;
  toggleCamera(): Promise<void>;
  setPtt(down: boolean): void;
  setUserVolume(userId: string, v: number): void;
  /** silenciados só para mim nesta sessão do app */
  localMuted: Record<string, boolean>;
  setUserMuted(userId: string, muted: boolean): void;
  /** volume do áudio da transmissão de cada pessoa nesta sessão (0–2) */
  screenVolume: Record<string, number>;
  setScreenVolume(userId: string, v: number): void;
  openStreamPicker(): void;
  cancelStreamPicker(): void;
  startStream(
    sourceId: string | null,
    withAudio: boolean,
    profile: StreamProfileId,
    sourceName?: string | null,
  ): Promise<void>;
  stopStream(): Promise<void>;
  watch(identity: string, on: boolean): void;
  applySettings(s: UserSettings): void;
  engine(): VoiceEngine | null;
}

let engine: VoiceEngine | null = null;
// trocar de cena (ou editar a ativa) durante a live atualiza a composição sem reiniciar a transmissão
useScenes.setState({ onLiveChange: (scene) => void engine?.setScene(scene) });
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

  /** quem estava na sala na última atualização (outros participantes) → sons de entrada/saída/transmissão */
  let seen: Map<string, boolean> | null = null;
  function soundsFor(participants: ParticipantView[]) {
    const remote = participants.filter((p) => !p.isLocal);
    // lista vazia = desconectei/estou reconectando: zera a referência sem tocar nada
    if (!participants.length) {
      seen = null;
      return;
    }
    const now = new Map(remote.map((p) => [p.identity, p.hasScreen]));
    if (seen) {
      if ([...now.keys()].some((id) => !seen!.has(id))) playSound('peerJoin');
      else if ([...seen.keys()].some((id) => !now.has(id))) playSound('peerLeave');
      if ([...now].some(([id, screen]) => screen && seen!.get(id) === false)) playSound('streamStart');
    }
    seen = now;
  }

  async function connectWith(j: VoiceJoinResponse, generation: number) {
    const s = get();
    engine ??= new VoiceEngine(
      {
        onParticipants: (raw) => {
          // apelido que dei à pessoa (só eu vejo) no lugar do nome que veio da sala
          const participants = raw.map((p) => ({ ...p, name: nameFor(p.identity, p.name) }));
          soundsFor(participants);
          set({ participants });
        },
        onConnectionLost: () => {
          playSound('disconnect');
          dispatch({ type: 'CONNECTION_LOST' });
        },
        onReconnected: () => {
          playSound('reconnect');
          dispatch({ type: 'RECONNECTED' });
        },
        onDisconnected: (reason) => void handleDisconnect(reason),
        onStreamEnded: () => {
          sdispatch({ type: 'SOURCE_ENDED' });
          void get().stopStream();
        },
        onStats: (stats) => set({ stats }),
        // prévia também na API, para o card "Em atividade" de quem está fora da chamada (falha não afeta a live)
        onStreamPreview: (image) =>
          void api()
            .upload('/voice/stream-preview', new File([image], 'preview.jpg', { type: 'image/jpeg' }))
            .catch(() => undefined),
      },
      prefsFrom(useData.getState().settings),
    );
    for (const [id, m] of Object.entries(s.localMuted)) engine.setUserMuted(id, m);
    for (const [id, v] of Object.entries(s.screenVolume)) engine.setScreenVolume(id, v);
    const reconnecting = get().machine.status === 'reconnecting';
    await engine.connect(j.url, j.token, { canSpeak: j.canSpeak, selfMute: s.selfMute, selfDeaf: s.selfDeaf });
    dispatch({ type: 'CONNECTED', generation });
    // atividade já em andamento nesta chamada (Assistir juntos)
    if (j.channelId) void useActivity.getState().load(j.channelId);
    if (j.channelId) void useMusic.getState().load(j.channelId);
    if (!reconnecting) playSound('join');
  }

  /** SFU caiu sem ser intencional: reentrar com token novo e backoff; remoção/duplicação não reconecta. */
  async function handleDisconnect(reason: 'removed' | 'replaced' | 'failed' | 'ended') {
    const { machine, serverId } = get();
    if (reason === 'removed') return get().forcedOut('Você foi removido da chamada.');
    if (reason === 'replaced') return get().forcedOut('Você entrou nesta chamada em outro dispositivo.');
    if (!machine.channelId || !serverId) return;
    sdispatch({ type: 'RESET' });
    playSound('disconnect');
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
        playSound('reconnect');
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
    streamSource: null,
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
      useActivity.getState().reset();
      useMusic.getState().reset();
      if (wasIn) playSound('leave');
      set({ serverId: null, participants: [], camera: false, stream: initialStreamState, stats: null });
      if (wasIn) await useApiSafe((a) => a.request('POST', '/voice/leave'));
      syncTray();
    },

    forcedOut(reason) {
      ptt?.reset();
      void engine?.disconnect();
      dispatch({ type: 'FORCED_OUT', reason });
      playSound('leave');
      set({ serverId: null, participants: [], camera: false, stream: initialStreamState });
      useUi.getState().toast('error', reason);
      syncTray();
    },

    async toggleMute() {
      const selfMute = !get().selfMute;
      // desmutar enquanto ensurdecido também remove o ensurdecer
      const selfDeaf = selfMute ? get().selfDeaf : false;
      set({ selfMute, selfDeaf });
      playSound(selfMute ? 'mute' : 'unmute');
      await engine?.setDeafen(selfDeaf);
      await engine?.setSelfMute(selfMute);
      pushState();
      syncTray();
    },

    async toggleDeafen() {
      const selfDeaf = !get().selfDeaf;
      set({ selfDeaf, selfMute: selfDeaf ? true : false });
      playSound(selfDeaf ? 'deafen' : 'undeafen');
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

    screenVolume: {},
    setScreenVolume(userId, v) {
      set((s) => ({ screenVolume: { ...s.screenVolume, [userId]: v } }));
      engine?.setScreenVolume(userId, v);
    },

    localMuted: {},
    setUserMuted(userId, muted) {
      set((s) => ({ localMuted: { ...s.localMuted, [userId]: muted } }));
      engine?.setUserMuted(userId, muted);
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

    async startStream(sourceId, withAudio, profile, sourceName = null) {
      set({ streamSource: sourceName });
      sdispatch({
        type: 'START',
        sourceId: sourceId ?? 'browser',
        sourceKind: sourceId?.startsWith('window:') ? 'window' : 'screen',
        withAudio,
      });
      useUi.getState().openModal(null);
      try {
        const video = useData.getState().settings?.video;
        const codec = video?.preferredCodec ?? 'h264';
        const r = await (engine as VoiceEngine).startStream(
          sourceId,
          withAudio,
          profile,
          codec,
          video?.streamBitrate ?? 'medium',
          useScenes.getState().active(),
        );
        // `live` só após a publicação ser confirmada pela SFU
        sdispatch({ type: 'PUBLISHED', audioPublished: r.audioPublished });
        playSound('streamStart');
        // a própria transmissão abre em destaque (dá para voltar à grade)
        const me = get().participants.find((p) => p.isLocal);
        if (me) useUi.getState().focusStream(me.identity);
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
      playSound('streamStop');
      set({ streamSource: null });
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
