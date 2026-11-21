/**
 * Tela de uma live com cena no app em Tauri (ADR-0015/0062). O `getDisplayMedia` do WebView2 sempre abre o seletor de
 * tela dele (não dá para escolher a fonte por código), então a fonte escolhida no seletor do OpenCord é capturada pelo
 * oc-live (H.264 da placa, com folga de bitrate), decodificada aqui (WebCodecs) e entregue como uma trilha
 * (MediaStreamTrackGenerator), no lugar da captura do navegador: o compositor e a prévia do editor de cenas não mudam.
 */
import type { NativeClipChunk, NativeFeedArgs, OpenCordBridge } from '../../electron/shared/ipc';
import { AnnexBToAvc } from '../clips/annexb';

type Feed = NonNullable<NonNullable<OpenCordBridge['nativeLive']>['feed']>;

interface TrackGenerator extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}
const g = globalThis as unknown as {
  MediaStreamTrackGenerator?: new (init: { kind: 'video' }) => TrackGenerator;
  MediaStreamTrackProcessor?: unknown;
};

/** o WebView tem o que é preciso (decodificar H.264 e montar/ler trilhas quadro a quadro)? */
export function canUseNativeFeed(): boolean {
  return (
    typeof VideoDecoder !== 'undefined' &&
    typeof EncodedVideoChunk !== 'undefined' &&
    Boolean(g.MediaStreamTrackGenerator && g.MediaStreamTrackProcessor)
  );
}

/**
 * Bitrate do vídeo entre o oc-live e a interface: é recodificado na live, então vai com folga (1,5× o da live), sem
 * passar de 50 Mb/s (≈ 6 MB/s pelo IPC do Tauri).
 */
export function feedBitrate(liveBps: number): number {
  return Math.round(Math.min(50e6, Math.max(16e6, liveBps * 1.5)));
}

/** decodificações na fila acima disso: a placa não acompanha; pula até o próximo quadro-chave em vez de atrasar */
const MAX_QUEUE = 6;
/** quadros esperando o tamanho do vídeo (a resposta do start) */
const MAX_PENDING = 120;

export interface NativeFeed {
  track: MediaStreamTrack;
  stop(): void;
  /**
   * diagnóstico da live: quadros pulados antes de decodificar (esperando quadro-chave, placa atrasada), decodificados,
   * entregues e descartados depois (o compositor ainda ocupado)
   */
  stats(): {
    skipped: number;
    decoded: number;
    written: number;
    dropped: number;
    errors: number;
    lastError: string | null;
  };
}

/**
 * Começa a captura; `onEnded` = a fonte acabou sozinha (janela fechada, processo saiu). Erro `no-hw-encoder…` = a
 * placa não tem H.264 (quem chamou volta para o getDisplayMedia).
 */
export async function startNativeFeed(feed: Feed, args: NativeFeedArgs, onEnded: () => void): Promise<NativeFeed> {
  const Gen = g.MediaStreamTrackGenerator;
  if (!Gen || !canUseNativeFeed()) throw new Error('captura nativa indisponível neste WebView');
  const gen = new Gen({ kind: 'video' });
  const writer = gen.writable.getWriter();
  const counters = { skipped: 0, decoded: 0, written: 0, dropped: 0, errors: 0, lastError: null as string | null };
  let stopped = false;
  let inFlight = 0;
  let conv: AnnexBToAvc | null = null;
  let decoder: VideoDecoder | null = null;
  let configured = '';
  let needKey = true;
  const pending: NativeClipChunk[] = [];

  const output = (frame: VideoFrame) => {
    counters.decoded++;
    // o compositor lê um quadro por vez: com a entrega atrasada, este fica de fora
    if (stopped || inFlight > 1) {
      counters.dropped++;
      frame.close();
      return;
    }
    inFlight++;
    writer
      .write(frame)
      .then(() => counters.written++)
      .catch(() => counters.errors++)
      .finally(() => {
        // o gerador já libera o quadro; close() de novo não faz nada
        frame.close();
        inFlight--;
      });
  };
  const fresh = () =>
    new VideoDecoder({
      output,
      error: (e) => {
        // decodificador fechado pelo erro: recomeça no próximo quadro-chave
        counters.errors++;
        counters.lastError = e.message;
        decoder = null;
        configured = '';
        needKey = true;
      },
    });

  const handle = (c: NativeClipChunk) => {
    if (stopped || !conv) return;
    const f = conv.push(c.data, c.key);
    // antes do primeiro SPS/PPS nada é decodificável
    if (!f) {
      counters.skipped++;
      return;
    }
    if (c.key && f.config) {
      decoder ??= fresh();
      const desc = f.config.description as Uint8Array | undefined;
      const id = `${f.config.codec}:${desc ? Array.from(desc).join(',') : ''}`;
      // atrasado demais: joga fora a fila e recomeça deste quadro-chave
      if (decoder.decodeQueueSize > MAX_QUEUE && configured) {
        decoder.reset();
        configured = '';
      }
      if (id !== configured) {
        // sem exigir a placa: o Chromium já usa o decodificador de hardware quando há um ('prefer-hardware' recusa a
        // configuração inteira onde não há)
        decoder.configure({ ...f.config, optimizeForLatency: true });
        configured = id;
      }
      needKey = false;
    } else if (decoder && decoder.decodeQueueSize > MAX_QUEUE) {
      needKey = true;
    }
    if (needKey || !decoder || decoder.state !== 'configured') {
      counters.skipped++;
      return;
    }
    try {
      decoder.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: c.ts, data: f.data }));
    } catch (e) {
      counters.errors++;
      counters.lastError = e instanceof Error ? e.message : String(e);
      needKey = true;
    }
  };

  const off = feed.onEnded(() => {
    if (!stopped) onEnded();
  });
  let size: { width: number; height: number };
  try {
    size = await feed.start(args, (c) => {
      if (conv) handle(c);
      else if (pending.length < MAX_PENDING) pending.push(c);
    });
  } catch (e) {
    stopped = true;
    off();
    gen.stop();
    throw e instanceof Error ? e : new Error(String(e));
  }
  conv = new AnnexBToAvc(size.width, size.height);
  for (const c of pending.splice(0)) handle(c);

  return {
    track: gen,
    stats: () => ({ ...counters }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      off();
      void feed.stop().catch(() => undefined);
      try {
        if (decoder && decoder.state !== 'closed') decoder.close();
      } catch {
        /* já fechado */
      }
      decoder = null;
      void writer.close().catch(() => undefined);
      gen.stop();
    },
  };
}
