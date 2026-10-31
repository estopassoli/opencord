import type { ActiveRecording, CallRecording, ChannelRecordings } from '@opencord/contracts';
import { create } from 'zustand';
import { composeAvailable } from '../recording/compose';
import { CallRecorder, type RecorderApi } from '../recording/recorder';
import { webCodecsAvailable } from '../clips/encode';
import { useData } from './data';
import { api, describeError } from './session';
import { useUi } from './ui';
import { useVoice } from './voice';

/**
 * Gravação da chamada (ADR-0023): quem grava monta e envia o vídeo do próprio app; todos na chamada veem "Gravando";
 * pronta, fica 24 h para baixar.
 */
interface RecordingStore {
  /** gravação em andamento por canal (todos veem) */
  active: Record<string, ActiveRecording | null>;
  /** gravações prontas por canal (24 h) */
  ready: Record<string, CallRecording[]>;
  /** eu estou gravando este canal */
  mine: { id: string; channelId: string; startedAt: number } | null;
  stopping: boolean;
  load(channelId: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  download(r: CallRecording): Promise<void>;
  remove(r: CallRecording): Promise<void>;
  onState(channelId: string, recording: ActiveRecording | null): void;
  onReady(channelId: string, recording: CallRecording): void;
}

let recorder: CallRecorder | null = null;

const recorderApi: RecorderApi = {
  start: (channelId) => api().request<{ id: string }>('POST', `/voice/channels/${channelId}/recordings`),
  part: async (id, n, data) => {
    await api().upload(`/recordings/${id}/parts`, new File([data], `parte-${n}.mp4`, { type: 'video/mp4' }), {
      n: String(n),
    });
  },
  alive: (id) => api().request('POST', `/recordings/${id}/alive`),
  complete: (id, durationMs) => api().request<CallRecording>('POST', `/recordings/${id}/complete`, { durationMs }),
  abort: (id) => api().request('POST', `/recordings/${id}/abort`),
};

export const recordingSupported = () => webCodecsAvailable() && composeAvailable();

export const useRecording = create<RecordingStore>()((set, get) => ({
  active: {},
  ready: {},
  mine: null,
  stopping: false,
  async load(channelId) {
    try {
      const r = await api().request<ChannelRecordings>('GET', `/voice/channels/${channelId}/recordings`);
      set((s) => ({ active: { ...s.active, [channelId]: r.active }, ready: { ...s.ready, [channelId]: r.ready } }));
    } catch {
      /* API antiga ou sem acesso */
    }
  },
  async start() {
    const v = useVoice.getState();
    const channelId = v.machine.channelId;
    const engine = v.engine();
    if (!channelId || !engine || recorder) return;
    if (!recordingSupported()) {
      useUi.getState().toast('error', 'Este computador não consegue gravar a chamada (sem WebCodecs).');
      return;
    }
    // sempre o motor atual (reconectar cria outro) e a lista de participantes da tela
    const eng = () => useVoice.getState().engine();
    const source = {
      participants: () => useVoice.getState().participants,
      videoTrack: (id: string, src: 'camera' | 'screen') => eng()?.videoTrack(id, src) ?? null,
      callAudioTracks: () => eng()?.callAudioTracks() ?? [],
      setRecordAll: (on: boolean) => eng()?.setRecordAll(on),
      attach: (id: string, src: 'camera' | 'screen', el: HTMLVideoElement) =>
        eng()?.attach(id, src, el) ?? (() => undefined),
    };
    const rec = new CallRecorder(recorderApi, source, ({ ok, reason }) => {
      recorder = null;
      set({ mine: null, stopping: false });
      useUi.getState().toast(ok ? 'info' : 'error', reason);
    });
    recorder = rec;
    try {
      await rec.start(channelId);
      set({ mine: { id: rec.id!, channelId, startedAt: rec.startedAt } });
    } catch (e) {
      recorder = null;
      useUi.getState().toast('error', describeError(e));
    }
  },
  async stop() {
    const rec = recorder;
    if (!rec || get().stopping) return;
    set({ stopping: true });
    try {
      await rec.stop();
      useUi.getState().toast('success', 'Gravação encerrada. Ela fica disponível para baixar por 24 horas.');
    } catch (e) {
      useUi.getState().toast('error', `A gravação falhou: ${describeError(e)}`);
    } finally {
      recorder = null;
      set({ mine: null, stopping: false });
    }
  },
  async download(r) {
    try {
      const { url } = await api().request<{ url: string }>('POST', `/recordings/${r.id}/link`);
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      a.rel = 'noopener';
      a.click();
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  },
  async remove(r) {
    try {
      await api().request('DELETE', `/recordings/${r.id}`);
      set((s) => ({ ready: { ...s.ready, [r.channelId]: (s.ready[r.channelId] ?? []).filter((x) => x.id !== r.id) } }));
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  },
  onState(channelId, recording) {
    const before = get().active[channelId];
    set((s) => ({ active: { ...s.active, [channelId]: recording } }));
    // quem está na chamada é avisado quando outra pessoa começa a gravar
    const me = useData.getState().me?.id;
    if (recording && !before && recording.userId !== me && useVoice.getState().machine.channelId === channelId)
      useUi.getState().toast('info', 'Esta chamada começou a ser gravada.');
  },
  onReady(channelId, recording) {
    set((s) => ({
      ready: {
        ...s.ready,
        [channelId]: [recording, ...(s.ready[channelId] ?? []).filter((x) => x.id !== recording.id)],
      },
    }));
    // quem estava na chamada recebe o aviso com o atalho para baixar
    if (useVoice.getState().machine.channelId === channelId)
      useUi.getState().toast('success', 'A gravação da chamada está pronta (fica 24 h).', {
        label: 'Baixar',
        run: () => void get().download(recording),
      });
  },
}));

/** Sair da chamada (ou cair dela) encerra a minha gravação, com o que já foi gravado. */
useVoice.subscribe((v, prev) => {
  const mine = useRecording.getState().mine;
  if (mine && v.machine.channelId !== mine.channelId && prev.machine.channelId === mine.channelId)
    void useRecording.getState().stop();
});
