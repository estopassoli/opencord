/**
 * Motor de mídia sobre livekit-client. Mídia trafega SOMENTE pela SFU (LiveKit); a API só emite tokens.
 * - Microfone: publicado uma vez; PTT e VAD abrem/fecham via `mediaStreamTrack.enabled` (sem sinalização, sem latência);
 *   mute próprio usa `track.mute()` (estado visível aos outros).
 * - Ensurdecer: volume 0 em todas as trilhas remotas + mute.
 * - Go Live: captura via bridge Electron (loopback do sistema com restrictOwnAudio, ADR-0003) e publica
 *   `screen_share` + `screen_share_audio`. Espectadores assinam streams sob demanda (P08).
 */
import {
  backoffDelay,
  effectiveProfile,
  isHardwareEncoder,
  MAX_RECONNECT_ATTEMPTS,
  SpeakingDebouncer,
  type StreamProfileId,
} from '@opencord/media';
import {
  ConnectionQuality,
  DisconnectReason,
  LocalAudioTrack,
  LocalVideoTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  type VideoCodec,
} from 'livekit-client';
import { RNNOISE, RnnoiseProcessor } from './noise';
import { bridge } from '../lib/bridge';

export interface ParticipantView {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micMuted: boolean;
  hasCamera: boolean;
  hasScreen: boolean;
  screenAudio: boolean;
  watchingScreen: boolean;
  quality: 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';
}

export interface MediaStats {
  rttMs: number | null;
  jitterMs: number | null;
  lossPct: number | null;
  outKbps: number | null;
  stream?: {
    encoder: string | null;
    hardware: boolean | null;
    fps: number | null;
    width: number | null;
    height: number | null;
    limitation: string | null;
    codec: string | null;
    /** fmtp negociado (para H.264, o perfil decide se o encoder de hardware é usado) */
    fmtp: string | null;
    /** vídeo enviado de fato (kb/s) e estimativa de banda de subida do WebRTC (kb/s) */
    kbps: number | null;
    availableKbps: number | null;
  };
}

export interface EngineCallbacks {
  onParticipants(list: ParticipantView[]): void;
  onConnectionLost(): void;
  onReconnected(): void;
  /** Desconexão definitiva vinda da SFU (removido, duplicado, sala encerrada) ou falha após retries. */
  onDisconnected(reason: 'removed' | 'replaced' | 'failed' | 'ended', detail?: string): void;
  onStreamEnded(): void;
  onStats(s: MediaStats): void;
}

export interface AudioPrefs {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputMode: 'vad' | 'ptt';
  vadThresholdDb: number;
  inputVolume: number;
  outputVolume: number;
}

const QUALITY: Record<ConnectionQuality, ParticipantView['quality']> = {
  [ConnectionQuality.Excellent]: 'excellent',
  [ConnectionQuality.Good]: 'good',
  [ConnectionQuality.Poor]: 'poor',
  [ConnectionQuality.Lost]: 'lost',
  [ConnectionQuality.Unknown]: 'unknown',
};

export class VoiceEngine {
  room: Room | null = null;
  private intentional = false;
  private speaking = new Map<string, SpeakingDebouncer>();
  private speakingSet = new Set<string>();
  /** fala local medida aqui mesmo (40 ms): o indicador da SFU chega com ~0,5 s de atraso */
  private localLoud = false;
  private vadClone: MediaStreamTrack | null = null;
  private watching = new Set<string>();
  private volumes = new Map<string, number>();
  /** silenciados só para mim (não afeta os outros participantes) */
  private mutedUsers = new Set<string>();
  private deafened = false;
  private selfMuted = false;
  private gateOpen = true;
  private pttOpen = false;
  private prefs: AudioPrefs;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private vadCtx: AudioContext | null = null;
  private screen: { video: LocalVideoTrack; audio: LocalAudioTrack | null; stream: MediaStream } | null = null;
  private lastBytes: { t: number; bytes: number } | null = null;
  private lastVideoBytes: { t: number; bytes: number } | null = null;

  constructor(
    private readonly cb: EngineCallbacks,
    prefs: AudioPrefs,
  ) {
    this.prefs = prefs;
  }

  // ---------- conexão ----------
  async connect(url: string, token: string, opts: { canSpeak: boolean; selfMute: boolean; selfDeaf: boolean }) {
    this.intentional = false;
    preferHardwareH264();
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: true,
      disconnectOnPageLeave: true,
      stopLocalTrackOnUnpublish: true,
      audioCaptureDefaults: this.captureOpts(),
      audioOutput: this.prefs.outputDeviceId ? { deviceId: this.prefs.outputDeviceId } : {},
      publishDefaults: { dtx: true, red: true, stopMicTrackOnMute: false },
    });
    this.room = room;
    this.bind(room);
    await room.connect(url, token, { autoSubscribe: false });
    this.selfMuted = opts.selfMute;
    this.deafened = opts.selfDeaf;
    // assinar microfones/câmeras já publicados; streams só sob demanda
    for (const p of room.remoteParticipants.values())
      for (const pub of p.trackPublications.values()) this.autoSubscribe(pub as RemoteTrackPublication, p);
    if (opts.canSpeak) {
      await room.localParticipant.setMicrophoneEnabled(true, this.captureOpts());
      await this.applyNoiseFilter();
      await this.applyMic();
      this.startVad();
    }
    this.applyDeafen();
    this.startStats();
    this.emit();
  }

  /** Nova conexão com token novo (usado na reconexão completa após falha da SFU). */
  async disconnect() {
    this.intentional = true;
    await this.stopStream().catch(() => undefined);
    this.stopVad();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    const r = this.room;
    this.room = null;
    if (r) this.detachAudio(r);
    await r?.disconnect(true);
    this.speaking.clear();
    this.speakingSet.clear();
    this.watching.clear();
    this.cb.onParticipants([]);
  }

  private captureOpts() {
    return {
      echoCancellation: this.prefs.echoCancellation,
      noiseSuppression: this.prefs.noiseSuppression,
      autoGainControl: this.prefs.autoGainControl,
      ...(this.prefs.inputDeviceId ? { deviceId: this.prefs.inputDeviceId } : {}),
    };
  }

  private bind(room: Room) {
    const emit = () => this.emit();
    room
      .on(RoomEvent.ParticipantConnected, emit)
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        this.watching.delete(p.identity);
        emit();
      })
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
        this.autoSubscribe(pub, p);
        emit();
      })
      .on(RoomEvent.TrackUnpublished, emit)
      .on(RoomEvent.TrackSubscribed, (t: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
        if (pub.kind === Track.Kind.Audio) {
          // o livekit-client só toca áudio remoto anexado a um elemento <audio>
          const el = t.attach();
          el.hidden = true;
          document.body.append(el);
          this.applyVolume(p);
        }
        emit();
      })
      .on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => {
        if (t.kind === Track.Kind.Audio) for (const el of t.detach()) el.remove();
        emit();
      })
      // navegador bloqueou autoplay: libera o áudio no próximo clique/tecla
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (room.canPlaybackAudio) return;
        const unlock = () => {
          window.removeEventListener('pointerdown', unlock);
          window.removeEventListener('keydown', unlock);
          void room.startAudio().catch(() => undefined);
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
      })
      .on(RoomEvent.TrackMuted, emit)
      .on(RoomEvent.TrackUnmuted, emit)
      .on(RoomEvent.LocalTrackPublished, emit)
      .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
        if (pub.source === Track.Source.ScreenShare && this.screen) this.cb.onStreamEnded();
        emit();
      })
      .on(RoomEvent.ConnectionQualityChanged, emit)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const now = new Set(speakers.map((s) => s.identity));
        const all = [room.localParticipant.identity, ...room.remoteParticipants.keys()];
        for (const id of all) {
          let d = this.speaking.get(id);
          if (!d) {
            d = new SpeakingDebouncer((v) => {
              if (v) this.speakingSet.add(id);
              else this.speakingSet.delete(id);
              this.emit();
            }, 350);
            this.speaking.set(id, d);
          }
          d.update(now.has(id));
        }
      })
      .on(RoomEvent.Reconnecting, () => this.cb.onConnectionLost())
      .on(RoomEvent.Reconnected, () => this.cb.onReconnected())
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        this.detachAudio(room);
        if (this.intentional) return;
        this.stopVad();
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) this.cb.onDisconnected('removed');
        else if (reason === DisconnectReason.DUPLICATE_IDENTITY) this.cb.onDisconnected('replaced');
        else if (reason === DisconnectReason.ROOM_DELETED) this.cb.onDisconnected('ended');
        else this.cb.onDisconnected('failed', reason !== undefined ? DisconnectReason[reason] : undefined);
      });
  }

  private detachAudio(room: Room) {
    for (const p of room.remoteParticipants.values())
      for (const pub of p.audioTrackPublications.values()) for (const el of pub.track?.detach() ?? []) el.remove();
  }

  private autoSubscribe(pub: RemoteTrackPublication, p: RemoteParticipant) {
    const isStream = pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
    pub.setSubscribed(isStream ? this.watching.has(p.identity) : true);
  }

  // ---------- microfone / PTT / VAD ----------
  private get micTrack(): LocalAudioTrack | undefined {
    return this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as
      LocalAudioTrack | undefined;
  }

  /** Estado efetivo do microfone: mute próprio sinalizado; gate (VAD/PTT) via enabled. */
  private async applyMic() {
    const t = this.micTrack;
    if (!t) return;
    if (this.selfMuted || this.deafened) {
      if (!t.isMuted) await t.mute();
    } else if (t.isMuted) await t.unmute();
    const open = this.prefs.inputMode === 'ptt' ? this.pttOpen : this.gateOpen;
    t.mediaStreamTrack.enabled = open && !this.selfMuted && !this.deafened;
    this.emit();
  }

  /** RNNoise junto com a supressão do navegador quando "Supressão de ruído" está ligada. Falha → segue sem filtro. */
  private async applyNoiseFilter() {
    const t = this.micTrack;
    if (!t) return;
    const active = t.getProcessor()?.name === RNNOISE;
    try {
      if (this.prefs.noiseSuppression && !active) await t.setProcessor(new RnnoiseProcessor());
      else if (!this.prefs.noiseSuppression && active) await t.stopProcessor();
    } catch (e) {
      console.warn('supressão de ruído (RNNoise) indisponível', e);
    }
  }

  /** Mede o nível do microfone: abre o gate no modo VAD e acende o próprio indicador de fala sem esperar a SFU. */
  private startVad() {
    this.stopVad();
    const t = this.micTrack;
    if (!t) return;
    const ctx = new AudioContext();
    this.vadCtx = ctx;
    // analisa uma cópia: o gate desabilita a trilha publicada, não a análise
    this.vadClone = t.mediaStreamTrack.clone();
    const src = ctx.createMediaStreamSource(new MediaStream([this.vadClone]));
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let lastLoud = 0;
    this.vadTimer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-12);
      const now = performance.now();
      if (db >= this.prefs.vadThresholdDb) lastLoud = now;
      const loud = now - lastLoud < 400;
      if (this.prefs.inputMode === 'vad' && loud !== this.gateOpen) {
        this.gateOpen = loud;
        this.localLoud = loud;
        void this.applyMic();
      } else if (loud !== this.localLoud) {
        this.localLoud = loud;
        this.emit();
      }
    }, 40);
  }

  private stopVad() {
    if (this.vadTimer) clearInterval(this.vadTimer);
    this.vadTimer = null;
    void this.vadCtx?.close().catch(() => undefined);
    this.vadCtx = null;
    this.vadClone?.stop();
    this.vadClone = null;
    this.gateOpen = true;
    this.localLoud = false;
  }

  setPtt(open: boolean) {
    this.pttOpen = open;
    void this.applyMic();
  }

  async setSelfMute(m: boolean) {
    this.selfMuted = m;
    await this.applyMic();
  }

  async setDeafen(d: boolean) {
    this.deafened = d;
    this.applyDeafen();
    await this.applyMic();
  }

  private applyDeafen() {
    if (!this.room) return;
    for (const p of this.room.remoteParticipants.values()) this.applyVolume(p);
  }

  private applyVolume(p: RemoteParticipant) {
    const v =
      this.deafened || this.mutedUsers.has(p.identity)
        ? 0
        : (this.volumes.get(p.identity) ?? 1) * this.prefs.outputVolume;
    p.setVolume(v, Track.Source.Microphone);
    p.setVolume(this.deafened ? 0 : this.prefs.outputVolume, Track.Source.ScreenShareAudio);
  }

  setUserMuted(identity: string, muted: boolean) {
    if (muted) this.mutedUsers.add(identity);
    else this.mutedUsers.delete(identity);
    const p = this.room?.remoteParticipants.get(identity);
    if (p) this.applyVolume(p);
  }

  setUserVolume(identity: string, v: number) {
    this.volumes.set(identity, v);
    const p = this.room?.remoteParticipants.get(identity);
    if (p) this.applyVolume(p);
  }

  async applyPrefs(prefs: AudioPrefs) {
    const prev = this.prefs;
    this.prefs = prefs;
    if (!this.room) return;
    if (prefs.inputDeviceId !== prev.inputDeviceId && prefs.inputDeviceId)
      await this.room.switchActiveDevice('audioinput', prefs.inputDeviceId).catch(() => undefined);
    if (prefs.outputDeviceId !== prev.outputDeviceId && prefs.outputDeviceId)
      await this.room.switchActiveDevice('audiooutput', prefs.outputDeviceId).catch(() => undefined);
    const procChanged =
      prefs.echoCancellation !== prev.echoCancellation ||
      prefs.noiseSuppression !== prev.noiseSuppression ||
      prefs.autoGainControl !== prev.autoGainControl;
    if (procChanged) await this.micTrack?.restartTrack(this.captureOpts()).catch(() => undefined);
    if (prefs.noiseSuppression !== prev.noiseSuppression) await this.applyNoiseFilter();
    // trocar microfone também troca a trilha medida pelo VAD
    if (prefs.inputMode !== prev.inputMode || procChanged || prefs.inputDeviceId !== prev.inputDeviceId) {
      this.pttOpen = false;
      this.startVad();
    }
    this.applyDeafen();
    await this.applyMic();
  }

  // ---------- câmera ----------
  async setCamera(on: boolean, deviceId: string | null) {
    if (!this.room) return;
    await this.room.localParticipant.setCameraEnabled(
      on,
      on ? { ...(deviceId ? { deviceId } : {}), resolution: { width: 1280, height: 720, frameRate: 30 } } : undefined,
    );
    this.emit();
  }

  // ---------- Go Live ----------
  /** Inicia captura e publicação. Retorna se o áudio do sistema foi publicado. */
  async startStream(
    sourceId: string | null,
    withAudio: boolean,
    profileId: StreamProfileId,
    codec: VideoCodec,
  ): Promise<{ audioPublished: boolean }> {
    if (!this.room) throw new Error('não conectado');
    const profile = effectiveProfile(profileId, { hardware: codec === 'h264' ? null : false });
    if (bridge && sourceId) await bridge.capture.select({ sourceId, systemAudio: withAudio });
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: profile.width },
        height: { ideal: profile.height },
        frameRate: { ideal: profile.fps, max: profile.fps },
      },
      // restrictOwnAudio: exclui as vozes da chamada tocadas pelo próprio OpenCord (evita eco para quem assiste)
      audio: withAudio
        ? ({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            restrictOwnAudio: true,
          } as MediaTrackConstraints)
        : false,
      // navegador (sem bridge): pede o áudio do sistema já marcado no seletor do Chrome/Edge e esconde a própria aba
      ...(bridge ? {} : { systemAudio: withAudio ? 'include' : 'exclude', selfBrowserSurface: 'exclude' }),
    } as DisplayMediaStreamOptions);
    const [v] = stream.getVideoTracks();
    if (!v) throw new Error('nenhuma trilha de vídeo capturada');
    // Pensado para jogos: 'motion' mantém o fps de captura ('detail' põe o WebRTC em modo de tela e limitou um jogo
    // a 16 fps); a nitidez vem de maintain-resolution + bitrate alto (abaixo).
    v.contentHint = 'motion';
    const [a] = stream.getAudioTracks();
    const video = new LocalVideoTrack(v, undefined, false);
    const audio = a ? new LocalAudioTrack(a, undefined, false) : null;
    this.screen = { video, audio, stream };
    // fonte encerrada (janela fechada/monitor removido) → parar a publicação imediatamente
    v.addEventListener('ended', () => this.cb.onStreamEnded(), { once: true });
    try {
      await this.room.localParticipant.publishTrack(video, {
        source: Track.Source.ScreenShare,
        videoCodec: codec,
        backupCodec: codec === 'vp8' ? false : { codec: 'vp8' },
        // Camada única: com simulcast, banda estimada baixa desligava a camada cheia e o espectador recebia só a
        // de meia resolução (960×540, texto borrado — relato real). Medido no E2E golive-real: com 'detail' +
        // maintain-resolution a camada única mantém 1920×1080 no espectador. Custo: sem camada leve para
        // espectadores com download fraco (aceitável para grupos pequenos).
        simulcast: false,
        // prioridade alta: na disputa de banda, o vídeo da live vem antes das câmeras
        screenShareEncoding: { maxBitrate: profile.maxBitrate, maxFramerate: profile.fps, priority: 'high' },
        // sob pressão cai o fps, não a resolução ("balanced" derrubava 1080p para 540p no espectador — E2E golive-real)
        degradationPreference: 'maintain-resolution',
      });
      if (audio) {
        await this.room.localParticipant.publishTrack(audio, {
          source: Track.Source.ScreenShareAudio,
          dtx: false,
          red: false,
          audioPreset: { maxBitrate: 128_000 },
        });
      }
    } catch (e) {
      await this.stopStream();
      throw e;
    }
    this.emit();
    return { audioPublished: Boolean(audio) };
  }

  async stopStream() {
    const s = this.screen;
    this.screen = null;
    this.lastVideoBytes = null;
    if (!s) return;
    const lp = this.room?.localParticipant;
    if (lp) {
      await lp.unpublishTrack(s.video, true).catch(() => undefined);
      if (s.audio) await lp.unpublishTrack(s.audio, true).catch(() => undefined);
    }
    for (const t of s.stream.getTracks()) t.stop();
    this.emit();
  }

  get streaming() {
    return this.screen !== null;
  }

  /** Assinar/cancelar assinatura da stream de alguém. */
  watch(identity: string, on: boolean) {
    if (on) this.watching.add(identity);
    else this.watching.delete(identity);
    const p = this.room?.remoteParticipants.get(identity);
    if (p) {
      for (const pub of p.trackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio)
          (pub as RemoteTrackPublication).setSubscribed(on);
      }
    }
    this.emit();
  }

  // ---------- trilhas para a UI ----------
  videoTrack(identity: string, source: 'camera' | 'screen'): MediaStreamTrack | null {
    const room = this.room;
    if (!room) return null;
    const src = source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
    if (identity === room.localParticipant.identity) {
      if (source === 'screen') return this.screen?.video.mediaStreamTrack ?? null;
      return room.localParticipant.getTrackPublication(src)?.track?.mediaStreamTrack ?? null;
    }
    const pub = room.remoteParticipants.get(identity)?.getTrackPublication(src);
    return pub?.isSubscribed && pub.track ? pub.track.mediaStreamTrack : null;
  }

  /** Anexa trilha remota a um elemento <video> (adaptiveStream usa o tamanho do elemento). */
  attach(identity: string, source: 'camera' | 'screen', el: HTMLVideoElement): () => void {
    const room = this.room;
    const src = source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
    if (!room) return () => undefined;
    if (identity === room.localParticipant.identity) {
      const t = this.videoTrack(identity, source);
      el.srcObject = t ? new MediaStream([t]) : null;
      return () => {
        el.srcObject = null;
      };
    }
    const track = room.remoteParticipants.get(identity)?.getTrackPublication(src)?.track;
    if (!track) return () => undefined;
    track.attach(el);
    return () => track.detach(el);
  }

  /** Falando e de fato transmitindo (gate/PTT abertos, sem mute). */
  private localSpeaking() {
    const t = this.micTrack;
    return Boolean(
      this.localLoud && t && !t.isMuted && t.mediaStreamTrack.enabled && !this.selfMuted && !this.deafened,
    );
  }

  private emit() {
    const room = this.room;
    if (!room) return this.cb.onParticipants([]);
    const views: ParticipantView[] = [];
    const lp = room.localParticipant;
    const toView = (p: Participant, isLocal: boolean): ParticipantView => {
      const mic = p.getTrackPublication(Track.Source.Microphone);
      return {
        identity: p.identity,
        name: p.name || p.identity,
        isLocal,
        speaking: isLocal ? this.localSpeaking() : this.speakingSet.has(p.identity),
        micMuted: !mic || mic.isMuted || (isLocal && (this.selfMuted || this.deafened)),
        hasCamera: Boolean(
          p.getTrackPublication(Track.Source.Camera) && !p.getTrackPublication(Track.Source.Camera)?.isMuted,
        ),
        hasScreen: isLocal ? this.screen !== null : Boolean(p.getTrackPublication(Track.Source.ScreenShare)),
        screenAudio: isLocal
          ? Boolean(this.screen?.audio)
          : Boolean(p.getTrackPublication(Track.Source.ScreenShareAudio)),
        watchingScreen: isLocal ? this.screen !== null : this.watching.has(p.identity),
        quality: QUALITY[p.connectionQuality] ?? 'unknown',
      };
    };
    views.push(toView(lp, true));
    for (const p of room.remoteParticipants.values()) views.push(toView(p, false));
    this.cb.onParticipants(views);
  }

  /** Diagnóstico somente leitura (sem segredos): assinaturas e áudio recebido por participante. */
  async diagnostics() {
    const room = this.room;
    if (!room) return null;
    const remotes = [];
    for (const p of room.remoteParticipants.values()) {
      const pub = p.getTrackPublication(Track.Source.Microphone);
      let bytes: number | null = null;
      let level: number | null = null;
      const rep = await pub?.track?.getRTCStatsReport().catch(() => undefined);
      rep?.forEach((r: Record<string, unknown>) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          if (typeof r.bytesReceived === 'number') bytes = r.bytesReceived;
          if (typeof r.audioLevel === 'number') level = r.audioLevel;
        }
      });
      remotes.push({
        identity: p.identity,
        micPublished: Boolean(pub),
        micSubscribed: pub?.isSubscribed ?? false,
        micMuted: pub?.isMuted ?? null,
        bytesReceived: bytes,
        audioLevel: level,
        speaking: this.speakingSet.has(p.identity),
      });
    }
    const mic = this.micTrack;
    return {
      state: room.state,
      local: {
        identity: room.localParticipant.identity,
        micPublished: Boolean(mic),
        micEnabled: mic?.mediaStreamTrack.enabled ?? null,
        micMuted: mic?.isMuted ?? null,
        gateOpen: this.gateOpen,
        inputMode: this.prefs.inputMode,
        noiseFilter: mic?.getProcessor()?.name ?? null,
      },
      remotes,
    };
  }

  // ---------- métricas (NFR-08) ----------
  private startStats() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => void this.collectStats(), 2000);
  }

  private async collectStats() {
    const mic = this.micTrack;
    const report = await mic?.getRTCStatsReport().catch(() => undefined);
    const s: MediaStats = { rttMs: null, jitterMs: null, lossPct: null, outKbps: null };
    report?.forEach((r: Record<string, unknown>) => {
      if (r.type === 'remote-inbound-rtp') {
        if (typeof r.roundTripTime === 'number') s.rttMs = Math.round(r.roundTripTime * 1000);
        if (typeof r.jitter === 'number') s.jitterMs = Math.round(r.jitter * 1000);
        if (typeof r.fractionLost === 'number') s.lossPct = Math.round(r.fractionLost * 1000) / 10;
      }
      if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number' && s.rttMs === null)
        s.rttMs = Math.round(r.currentRoundTripTime * 1000);
      if (r.type === 'outbound-rtp' && typeof r.bytesSent === 'number') {
        const now = performance.now();
        if (this.lastBytes)
          s.outKbps = Math.round(((r.bytesSent - this.lastBytes.bytes) * 8) / (now - this.lastBytes.t));
        this.lastBytes = { t: now, bytes: r.bytesSent };
      }
    });
    if (this.screen) {
      const vr = await this.screen.video.getRTCStatsReport().catch(() => undefined);
      let best: Record<string, unknown> | null = null;
      let videoBytes = 0;
      let availableKbps: number | null = null;
      vr?.forEach((r: Record<string, unknown>) => {
        if (r.type === 'outbound-rtp' && r.kind === 'video' && typeof r.bytesSent === 'number')
          videoBytes += r.bytesSent;
        if (r.type === 'candidate-pair' && r.nominated && typeof r.availableOutgoingBitrate === 'number')
          availableKbps = Math.round(r.availableOutgoingBitrate / 1000);
        if (
          r.type === 'outbound-rtp' &&
          r.kind === 'video' &&
          (!best || Number(r.frameWidth ?? 0) > Number(best.frameWidth ?? 0))
        )
          best = r;
      });
      const now = performance.now();
      const prev = this.lastVideoBytes;
      const kbps =
        prev && videoBytes >= prev.bytes ? Math.round(((videoBytes - prev.bytes) * 8) / (now - prev.t)) : null;
      this.lastVideoBytes = { t: now, bytes: videoBytes };
      const b = best as Record<string, unknown> | null;
      if (b) {
        const c =
          typeof b.codecId === 'string'
            ? (vr?.get(b.codecId) as { mimeType?: string; sdpFmtpLine?: string } | undefined)
            : undefined;
        const codec = c?.mimeType ?? null;
        const encoder = typeof b.encoderImplementation === 'string' ? b.encoderImplementation : null;
        s.stream = {
          encoder,
          hardware: typeof b.powerEfficientEncoder === 'boolean' ? b.powerEfficientEncoder : isHardwareEncoder(encoder),
          fps: typeof b.framesPerSecond === 'number' ? Math.round(b.framesPerSecond) : null,
          width: typeof b.frameWidth === 'number' ? b.frameWidth : null,
          height: typeof b.frameHeight === 'number' ? b.frameHeight : null,
          limitation: typeof b.qualityLimitationReason === 'string' ? b.qualityLimitationReason : null,
          codec,
          fmtp: c?.sdpFmtpLine ?? null,
          kbps,
          availableKbps,
        };
      }
    }
    this.cb.onStats(s);
  }
}

/**
 * Encoder de GPU para H.264. O SFU escolhe H.264 Constrained Baseline (profile-level-id 42e0xx) quando ele é
 * oferecido, e o Chromium só codifica esse perfil em software (OpenH264). Medido no PC do mantenedor (RTX, Electron
 * 44): Baseline 42001f, Main 4d001f e High 64xxxx usam MediaFoundation/NVENC. Antes de cada oferta, os transceivers
 * de envio de vídeo deixam de oferecer 42e0xx, e o SFU responde com um perfil acelerável. Se este Chromium não
 * anuncia nenhum outro perfil H.264, nada muda.
 */
let h264Patched = false;
function preferHardwareH264() {
  if (h264Patched || typeof RTCPeerConnection === 'undefined' || !RTCRtpSender.getCapabilities) return;
  h264Patched = true;
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
  const isH264 = (c: RTCRtpCodec) => c.mimeType.toLowerCase() === 'video/h264';
  const constrainedBaseline = (c: RTCRtpCodec) => isH264(c) && /profile-level-id=42e0/i.test(c.sdpFmtpLine ?? '');
  if (!codecs.some((c) => isH264(c) && !constrainedBaseline(c))) return;
  const prefs = codecs.filter((c) => !constrainedBaseline(c));
  const createOffer = RTCPeerConnection.prototype.createOffer;
  RTCPeerConnection.prototype.createOffer = function (this: RTCPeerConnection, ...args: unknown[]) {
    for (const t of this.getTransceivers()) {
      const sending = t.direction === 'sendonly' || t.direction === 'sendrecv';
      if (sending && t.sender.track?.kind === 'video') {
        try {
          t.setCodecPreferences(prefs);
        } catch {
          /* transceiver parado ou preferência recusada: segue com a oferta padrão */
        }
      }
    }
    return (createOffer as (...a: unknown[]) => Promise<RTCSessionDescriptionInit>).apply(this, args);
  } as typeof createOffer;
}

export const RECONNECT = {
  maxAttempts: MAX_RECONNECT_ATTEMPTS,
  delay: (attempt: number) => backoffDelay(attempt, 750, 10_000),
};
