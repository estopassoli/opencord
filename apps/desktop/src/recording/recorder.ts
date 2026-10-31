/**
 * Gravação da chamada no app de quem grava (ADR-0023): quadro composto (CallCompositor) + todo o áudio da chamada
 * misturado, codificados com WebCodecs (H.264 720p30 + AAC) num MP4 fragmentado que sobe em partes de 8 MB enquanto
 * a chamada acontece. Nada fica inteiro na memória.
 */
import { RECORDING_MAX_MS, RECORDING_PART_BYTES, type CallRecording } from '@opencord/contracts';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { encodeStream, type EncodeSession } from '../clips/encode';
import type { StoredChunk } from '../clips/ring';
import { CallCompositor, type CallSource } from './compose';

const FPS = 30;
const BITRATE = 2_500_000;
const ALIVE_MS = 30_000;
/** sem áudio depois disto, o arquivo sai só com vídeo */
const AUDIO_WAIT_US = 3_000_000;

export interface RecorderApi {
  start(channelId: string): Promise<{ id: string }>;
  part(id: string, n: number, data: Blob): Promise<void>;
  alive(id: string): Promise<void>;
  complete(id: string, durationMs: number): Promise<CallRecording>;
  abort(id: string): Promise<void>;
}

export interface RecorderEngine extends CallSource {
  callAudioTracks(): MediaStreamTrack[];
  setRecordAll(on: boolean): void;
}

/** Mistura todas as trilhas de áudio da chamada numa só (entra e sai gente: revisa a cada segundo). */
class AudioMix {
  private readonly ctx = new AudioContext({ sampleRate: 48_000 });
  private readonly dest = this.ctx.createMediaStreamDestination();
  private readonly nodes = new Map<string, MediaStreamAudioSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly tracks: () => MediaStreamTrack[]) {}

  start(): MediaStreamTrack {
    void this.ctx.resume().catch(() => undefined);
    this.sync();
    this.timer = setInterval(() => this.sync(), 1000);
    return this.dest.stream.getAudioTracks()[0]!;
  }

  private sync() {
    const live = new Map(
      this.tracks()
        .filter((t) => t.readyState === 'live')
        .map((t) => [t.id, t]),
    );
    for (const [id, node] of this.nodes)
      if (!live.has(id)) {
        node.disconnect();
        this.nodes.delete(id);
      }
    for (const [id, t] of live)
      if (!this.nodes.has(id)) {
        const node = this.ctx.createMediaStreamSource(new MediaStream([t]));
        node.connect(this.dest);
        this.nodes.set(id, node);
      }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const n of this.nodes.values()) n.disconnect();
    this.nodes.clear();
    void this.ctx.close().catch(() => undefined);
  }
}

/** Corta o arquivo em partes de tamanho fixo e envia uma de cada vez, em ordem (com novas tentativas). */
class PartUploader {
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private written = 0;
  private n = 0;
  private queue: Promise<void> = Promise.resolve();
  failed: Error | null = null;

  constructor(
    private readonly send: (n: number, data: Blob) => Promise<void>,
    private readonly onFail: (e: Error) => void,
  ) {}

  write(data: Uint8Array, position: number) {
    // MP4 fragmentado: só anexa ao fim
    if (position !== this.written) throw new Error(`escrita fora de ordem (${position} ≠ ${this.written})`);
    this.written += data.byteLength;
    this.pending.push(data.slice());
    this.pendingBytes += data.byteLength;
    while (this.pendingBytes >= RECORDING_PART_BYTES) this.cut(RECORDING_PART_BYTES);
  }

  private cut(size: number) {
    const all = new Uint8Array(this.pendingBytes);
    let at = 0;
    for (const p of this.pending) {
      all.set(p, at);
      at += p.byteLength;
    }
    const part = all.slice(0, size);
    const rest = all.slice(size);
    this.pending = rest.byteLength ? [rest] : [];
    this.pendingBytes = rest.byteLength;
    const n = ++this.n;
    const blob = new Blob([part], { type: 'video/mp4' });
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      for (let attempt = 0; ; attempt++) {
        try {
          await this.send(n, blob);
          return;
        } catch (e) {
          if (attempt >= 4) {
            this.failed = e instanceof Error ? e : new Error(String(e));
            this.onFail(this.failed);
            return;
          }
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
    });
  }

  /** envia o resto (última parte, menor) e espera tudo subir */
  async finish(): Promise<number> {
    if (this.pendingBytes) this.cut(this.pendingBytes);
    await this.queue;
    if (this.failed) throw this.failed;
    return this.n;
  }
}

export class CallRecorder {
  id: string | null = null;
  startedAt = 0;
  private compositor: CallCompositor | null = null;
  private mix: AudioMix | null = null;
  private session: EncodeSession | null = null;
  private muxer: Muxer<StreamTarget> | null = null;
  private uploader: PartUploader | null = null;
  private waiting: { v: StoredChunk[]; a: StoredChunk[] } = { v: [], a: [] };
  private base: number | null = null;
  private aliveTimer: ReturnType<typeof setInterval> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private lastV = -1;
  private stopping = false;

  constructor(
    private readonly api: RecorderApi,
    private readonly engine: RecorderEngine,
    /** a gravação parou sozinha (falha no envio ou limite de 4 h) */
    private readonly onEnded: (r: { ok: boolean; reason: string }) => void,
  ) {}

  async start(channelId: string) {
    const { id } = await this.api.start(channelId);
    this.id = id;
    this.startedAt = Date.now();
    try {
      this.engine.setRecordAll(true);
      this.compositor = new CallCompositor(this.engine, 1280, 720, FPS);
      this.mix = new AudioMix(() => this.engine.callAudioTracks());
      const stream = new MediaStream([this.compositor.start(), this.mix.start()]);
      this.uploader = new PartUploader(
        (n, data) => this.api.part(id, n, data),
        () => void this.fail('não consegui enviar a gravação ao servidor'),
      );
      this.session = encodeStream(
        stream,
        { fps: FPS, bitrate: BITRATE, keyEverySec: 2 },
        {
          video: (c) => this.onChunk('v', c),
          audio: (c) => this.onChunk('a', c),
        },
      );
      this.aliveTimer = setInterval(() => void this.api.alive(id).catch(() => undefined), ALIVE_MS);
      this.maxTimer = setTimeout(
        () =>
          void this.stop().then(() =>
            this.onEnded({ ok: true, reason: 'A gravação chegou ao limite de 4 horas e foi encerrada.' }),
          ),
        RECORDING_MAX_MS,
      );
    } catch (e) {
      await this.teardown();
      await this.api.abort(id).catch(() => undefined);
      throw e;
    }
  }

  private onChunk(kind: 'v' | 'a', c: StoredChunk) {
    if (!this.muxer) {
      // espera o primeiro quadro-chave (com a configuração) e o primeiro áudio para abrir o arquivo
      if (kind === 'v' && !this.waiting.v.length && !c.key) return;
      this.waiting[kind].push(c);
      const firstV = this.waiting.v[0];
      const firstA = this.waiting.a[0];
      const lastV = this.waiting.v.at(-1);
      if (!firstV || !this.session) return;
      if (!firstA && lastV && lastV.ts - firstV.ts < AUDIO_WAIT_US) return;
      this.open(firstV, firstA);
      const { v, a } = this.waiting;
      this.waiting = { v: [], a: [] };
      for (const x of v) this.addV(x);
      for (const x of a) this.addA(x);
      return;
    }
    if (kind === 'v') this.addV(c);
    else this.addA(c);
  }

  private open(firstV: StoredChunk, firstA: StoredChunk | undefined) {
    const s = this.session!;
    const vcfg = firstV.config as VideoDecoderConfig | undefined;
    const withAudio = Boolean(firstA && s.audioCodec);
    this.base = firstV.ts;
    this.muxer = new Muxer({
      target: new StreamTarget({
        onData: (data, position) => this.uploader?.write(data, position),
        chunked: true,
        chunkSize: 1024 * 1024,
      }),
      video: {
        codec: 'avc',
        width: vcfg?.codedWidth ?? s.width,
        height: vcfg?.codedHeight ?? s.height,
        frameRate: FPS,
      },
      ...(withAudio ? { audio: { codec: s.audioCodec!, numberOfChannels: s.channels, sampleRate: s.sampleRate } } : {}),
      fastStart: 'fragmented',
      firstTimestampBehavior: 'cross-track-offset',
    });
    this.audioOn = withAudio;
  }

  private audioOn = false;
  private audioConfigSent = false;
  private videoConfigSent = false;

  private addV(c: StoredChunk) {
    if (!this.muxer || this.base === null) return;
    const ts = Math.max(c.ts - this.base, this.lastV + 1);
    this.lastV = ts;
    const meta = !this.videoConfigSent && c.config ? { decoderConfig: c.config as VideoDecoderConfig } : undefined;
    this.videoConfigSent ||= Boolean(meta);
    this.muxer.addVideoChunkRaw(c.data, c.key ? 'key' : 'delta', ts, c.dur, meta);
  }

  private addA(c: StoredChunk) {
    if (!this.muxer || this.base === null || !this.audioOn || c.ts < this.base) return;
    const meta = !this.audioConfigSent && c.config ? { decoderConfig: c.config as AudioDecoderConfig } : undefined;
    this.audioConfigSent ||= Boolean(meta);
    this.muxer.addAudioChunkRaw(c.data, 'key', c.ts - this.base, c.dur, meta);
  }

  private async teardown() {
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.aliveTimer = null;
    this.maxTimer = null;
    this.compositor?.stop();
    this.mix?.stop();
    await this.session?.stop().catch(() => undefined);
    this.engine.setRecordAll(false);
  }

  /** Para, fecha o arquivo, sobe o resto e avisa o servidor. */
  async stop(): Promise<CallRecording | null> {
    if (this.stopping || !this.id) return null;
    this.stopping = true;
    const id = this.id;
    await this.teardown();
    try {
      if (!this.muxer) throw new Error('nada foi gravado');
      this.muxer.finalize();
      await this.uploader!.finish();
      return await this.api.complete(id, Date.now() - this.startedAt);
    } catch (e) {
      await this.api.abort(id).catch(() => undefined);
      throw e;
    }
  }

  private async fail(reason: string) {
    if (this.stopping || !this.id) return;
    this.stopping = true;
    await this.teardown();
    await this.api.abort(this.id).catch(() => undefined);
    this.onEnded({ ok: false, reason });
  }
}
