/**
 * Codifica uma captura (vídeo + áudio) com WebCodecs (ADR-0022): H.264 na placa de vídeo quando possível e AAC
 * (ou Opus). Entrega os pedaços já codificados; quem chama decide se guarda na memória (clipes) ou grava em arquivo
 * (gravação da chamada).
 */
import type { StoredChunk } from './ring';

interface TrackProcessor<T> {
  readable: ReadableStream<T>;
}
const g = globalThis as unknown as {
  MediaStreamTrackProcessor?: new <T>(init: { track: MediaStreamTrack }) => TrackProcessor<T>;
};

export interface EncodeOptions {
  fps: number;
  /** bits por segundo do vídeo */
  bitrate: number;
  /** quadro-chave a cada N segundos (o clipe só pode começar num quadro-chave) */
  keyEverySec: number;
  /** 'quality' (gravação da chamada) gasta mais da placa para ficar mais nítido; padrão 'realtime' */
  latencyMode?: 'realtime' | 'quality';
}

export interface EncodeSink {
  video(c: StoredChunk): void;
  /** `track`: posição da trilha de áudio no stream (0 = a primeira) */
  audio(c: StoredChunk, track: number): void;
  /**
   * O codificador de vídeo foi recriado (mudou a resolução ou a placa falhou): o que veio antes não combina com o que
   * vem depois no mesmo arquivo.
   */
  restart?(): void;
  /** falha do codificador (diagnóstico); a captura segue e ele é recriado no próximo quadro */
  error?(reason: string): void;
}

export interface EncodeSession {
  /** codec do vídeo e do áudio para o MP4 (null = sem áudio) */
  readonly videoCodec: 'avc';
  audioCodec: 'aac' | 'opus' | null;
  width: number;
  height: number;
  sampleRate: number;
  channels: number;
  /** quadro-chave agora (início de gravação) */
  requestKeyFrame(): void;
  stop(): Promise<void>;
}

export const webCodecsAvailable = () =>
  typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && Boolean(g.MediaStreamTrackProcessor);

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

async function videoConfig(
  width: number,
  height: number,
  o: EncodeOptions,
  software = false,
): Promise<VideoEncoderConfig> {
  // High 5.1 cobre até 4K60; o Baseline fica de reserva. Depois de a placa falhar, só o codificador do processador
  const modes = software ? (['prefer-software'] as const) : (['prefer-hardware', 'no-preference'] as const);
  for (const codec of ['avc1.640033', 'avc1.4D0033', 'avc1.42E033']) {
    for (const hardwareAcceleration of modes) {
      const cfg: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate: o.bitrate,
        framerate: o.fps,
        hardwareAcceleration,
        latencyMode: o.latencyMode ?? 'realtime',
        bitrateMode: 'variable',
        avc: { format: 'avc' },
      };
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
    }
  }
  throw new Error('este computador não codifica H.264');
}

async function audioConfig(sampleRate: number, numberOfChannels: number): Promise<AudioEncoderConfig | null> {
  for (const codec of ['mp4a.40.2', 'opus']) {
    const cfg: AudioEncoderConfig = { codec, sampleRate, numberOfChannels, bitrate: 160_000 };
    if ((await AudioEncoder.isConfigSupported(cfg)).supported) return cfg;
  }
  return null;
}

/**
 * Começa a codificar as trilhas do `stream` até `stop()`. Sem trilha de vídeo, só o áudio (o replay nativo do app em
 * Tauri: o vídeo já vem codificado do oc-live).
 */
export function encodeStream(stream: MediaStream, o: EncodeOptions, sink: EncodeSink): EncodeSession {
  const Processor = g.MediaStreamTrackProcessor;
  if (!Processor || !webCodecsAvailable()) throw new Error('WebCodecs indisponível');
  const [vTrack] = stream.getVideoTracks();
  const aTracks = stream.getAudioTracks();
  if (!vTrack && !aTracks.length) throw new Error('nenhuma trilha');
  let stopped = false;
  let forceKey = true;
  let lastKey = -Infinity;
  let vEnc: VideoEncoder | null = null;
  const aEncs: AudioEncoder[] = [];
  let vConfig: VideoDecoderConfig | undefined;

  // cada trilha tem seu relógio (medido: vídeo da tela no tempo do sistema, áudio começando em zero): a diferença para
  // performance.now() no primeiro quadro/amostra leva as duas ao mesmo relógio
  const now = () => Math.round(performance.now() * 1000);
  let vOffset: number | null = null;

  const session: EncodeSession = {
    videoCodec: 'avc',
    audioCodec: null,
    width: 0,
    height: 0,
    sampleRate: 0,
    channels: 0,
    requestKeyFrame: () => {
      forceKey = true;
    },
    stop: async () => {
      stopped = true;
      await Promise.all([vEnc, ...aEncs].map((e) => e?.flush().catch(() => undefined)));
      for (const e of [vEnc, ...aEncs]) if (e && e.state !== 'closed') e.close();
    },
  };
  const copy = (c: EncodedVideoChunk | EncodedAudioChunk) => {
    const data = new Uint8Array(c.byteLength);
    c.copyTo(data);
    return data;
  };

  const runVideo = async () => {
    const reader = new Processor<VideoFrame>({ track: vTrack! }).readable.getReader();
    let configuring: Promise<void> | null = null;
    // a placa de vídeo pode derrubar o codificador (jogo entrando em tela cheia, troca de resolução, driver)
    let broken = false;
    let failures = 0;
    const fail = (e: unknown) => {
      if (stopped) return;
      failures++;
      if (!broken) sink.error?.(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      broken = true;
    };
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done || stopped) {
        frame?.close();
        break;
      }
      vOffset ??= now() - frame.timestamp;
      const w = even(frame.displayWidth);
      const h = even(frame.displayHeight);
      // primeira imagem (ou mudou a resolução): configura o codificador para ela
      if (!vEnc || broken || w !== session.width || h !== session.height) {
        // nem no processador: desiste (o vídeo para; quem chama vê pelo erro)
        if (failures > 6) {
          frame.close();
          break;
        }
        if (!configuring) {
          configuring = (async () => {
            // falhou duas vezes na placa: segue no processador
            const cfg = await videoConfig(w, h, o, failures >= 2);
            if (vEnc && vEnc.state !== 'closed') vEnc.close();
            if (vEnc) sink.restart?.();
            vConfig = undefined;
            broken = false;
            vEnc = new VideoEncoder({
              output: (chunk, meta) => {
                if (meta?.decoderConfig) vConfig = meta.decoderConfig;
                const key = chunk.type === 'key';
                sink.video({
                  ts: chunk.timestamp + (vOffset ?? 0),
                  dur: chunk.duration ?? Math.round(1e6 / o.fps),
                  key,
                  data: copy(chunk),
                  ...(key && vConfig ? { config: vConfig } : {}),
                });
              },
              error: fail,
            });
            vEnc.configure(cfg);
            session.width = w;
            session.height = h;
            forceKey = true;
          })()
            .catch(fail)
            .finally(() => {
              configuring = null;
            });
        }
        frame.close();
        continue;
      }
      // codificador atrasado (placa ocupada): pula o quadro em vez de acumular atraso e memória
      if (vEnc.encodeQueueSize > 4) {
        frame.close();
        continue;
      }
      const key = forceKey || frame.timestamp - lastKey >= o.keyEverySec * 1e6;
      if (key) {
        lastKey = frame.timestamp;
        forceKey = false;
      }
      try {
        vEnc.encode(frame, { keyFrame: key });
      } catch (e) {
        fail(e);
      }
      frame.close();
    }
  };

  // cada trilha de áudio tem seu codificador e seu relógio
  const runAudio = async (track: MediaStreamTrack, index: number) => {
    const reader = new Processor<AudioData>({ track }).readable.getReader();
    let enc: AudioEncoder | null = null;
    let offset: number | null = null;
    let config: AudioDecoderConfig | undefined;
    for (;;) {
      const { value: data, done } = await reader.read();
      if (done || stopped) {
        data?.close();
        break;
      }
      offset ??= now() - data.timestamp;
      if (!enc) {
        const cfg = await audioConfig(data.sampleRate, data.numberOfChannels);
        if (!cfg) {
          data.close();
          return;
        }
        if (index === 0) {
          session.audioCodec = cfg.codec === 'opus' ? 'opus' : 'aac';
          session.sampleRate = data.sampleRate;
          session.channels = data.numberOfChannels;
        }
        const off = offset;
        enc = new AudioEncoder({
          output: (chunk, meta) => {
            if (meta?.decoderConfig) config = meta.decoderConfig;
            sink.audio(
              {
                ts: chunk.timestamp + off,
                dur: chunk.duration ?? 0,
                key: true,
                data: copy(chunk),
                ...(config ? { config } : {}),
              },
              index,
            );
          },
          error: () => undefined,
        });
        enc.configure(cfg);
        aEncs.push(enc);
      }
      if (enc.encodeQueueSize < 50) enc.encode(data);
      data.close();
    }
  };

  if (vTrack) void runVideo().catch(() => undefined);
  aTracks.forEach((t, i) => void runAudio(t, i).catch(() => undefined));
  return session;
}
