/** Live com cena no app em Tauri: a tela vem do oc-live em H.264 e vira trilha para o compositor (nativeFeed.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeClipChunk, NativeFeedArgs } from '../electron/shared/ipc';
import { feedBitrate, startNativeFeed } from '../src/voice/nativeFeed';

const SPS = new Uint8Array([0x67, 0x42, 0xc0, 0x28, 0xda, 0x01]);
const SPS2 = new Uint8Array([0x67, 0x42, 0xc0, 0x32, 0xda, 0x01]);
const PPS = new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
const IDR = new Uint8Array([0x65, 0x88, 0x84, 0x00, 0x33]);
const P = new Uint8Array([0x41, 0x9a, 0x02]);
const annexB = (...nals: Uint8Array[]) => new Uint8Array(nals.flatMap((n) => [0, 0, 0, 1, ...n]));
const key = (ts: number, sps = SPS): NativeClipChunk => ({ key: true, ts, data: annexB(sps, PPS, IDR) });
const delta = (ts: number): NativeClipChunk => ({ key: false, ts, data: annexB(P) });

/** decodificador falso: guarda as chamadas e devolve um "quadro" por pedaço */
class FakeDecoder {
  static all: FakeDecoder[] = [];
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  decodeQueueSize = 0;
  configs: { codec: string; optimizeForLatency?: boolean; hardwareAcceleration?: string }[] = [];
  chunks: { type: string; timestamp: number }[] = [];
  constructor(private readonly init: { output: (f: unknown) => void; error: (e: Error) => void }) {
    FakeDecoder.all.push(this);
  }
  configure(c: { codec: string }) {
    this.configs.push(c);
    this.state = 'configured';
  }
  decode(c: { type: string; timestamp: number }) {
    this.chunks.push(c);
    // como o de verdade: o quadro sai depois, fora da chamada
    setTimeout(() => this.init.output({ close: vi.fn(), timestamp: c.timestamp }), 0);
  }
  reset() {
    this.state = 'unconfigured';
  }
  close() {
    this.state = 'closed';
  }
  fail(msg: string) {
    this.state = 'closed';
    this.init.error(new Error(msg));
  }
}

const written: unknown[] = [];
class FakeGenerator {
  kind = 'video';
  stopped = false;
  writable = {
    getWriter: () => ({
      write: async (f: unknown) => void written.push(f),
      close: async () => undefined,
    }),
  };
  stop() {
    this.stopped = true;
  }
}

const g = globalThis as Record<string, unknown>;
const args: NativeFeedArgs = {
  sourceId: 'window:42',
  maxWidth: 1920,
  maxHeight: 1080,
  fps: 60,
  bitrate: 30e6,
  keyEverySec: 1,
  cursor: true,
};

/** o lado do Tauri, falso: `early` quadros chegam antes da resposta do start */
function fakeFeed(early: NativeClipChunk[] = []) {
  let push: ((c: NativeClipChunk) => void) | null = null;
  let ended: (() => void) | null = null;
  const api = {
    start: vi.fn(async (_a: NativeFeedArgs, onChunk: (c: NativeClipChunk) => void) => {
      push = onChunk;
      for (const c of early) onChunk(c);
      return { width: 1920, height: 1044 };
    }),
    stop: vi.fn(async () => undefined),
    onEnded: vi.fn((cb: () => void) => {
      ended = cb;
      return () => (ended = null);
    }),
  };
  return { api, push: (c: NativeClipChunk) => push?.(c), end: () => ended?.() };
}

describe('tela da live com cena vinda do oc-live', () => {
  beforeEach(() => {
    FakeDecoder.all = [];
    written.length = 0;
    g.VideoDecoder = FakeDecoder;
    g.EncodedVideoChunk = class {
      type: string;
      timestamp: number;
      constructor(i: { type: string; timestamp: number }) {
        this.type = i.type;
        this.timestamp = i.timestamp;
      }
    };
    g.MediaStreamTrackGenerator = FakeGenerator;
    g.MediaStreamTrackProcessor = class {};
  });
  afterEach(() => {
    for (const k of ['VideoDecoder', 'EncodedVideoChunk', 'MediaStreamTrackGenerator', 'MediaStreamTrackProcessor'])
      delete g[k];
  });

  it('decodifica a partir do primeiro quadro-chave, inclusive os que chegaram antes da resposta', async () => {
    // um quadro solto antes do quadro-chave não é decodificável: fica de fora
    const f = fakeFeed([delta(1), key(2), delta(3)]);
    const feed = await startNativeFeed(f.api, args, vi.fn());
    f.push(delta(4));
    const d = FakeDecoder.all[0]!;
    expect(f.api.start).toHaveBeenCalledWith(args, expect.any(Function));
    expect(d.configs).toHaveLength(1);
    expect(d.configs[0]!.codec).toBe('avc1.42c028');
    // sem exigir decodificador de hardware ('prefer-hardware' recusa a configuração onde não há)
    expect(d.configs[0]!.hardwareAcceleration).toBeUndefined();
    expect(d.chunks.map((c) => [c.type, c.timestamp])).toEqual([
      ['key', 2],
      ['delta', 3],
      ['delta', 4],
    ]);
    await new Promise((r) => setTimeout(r, 5));
    expect(written).toHaveLength(3);
    expect(feed.stats()).toMatchObject({ skipped: 1, decoded: 3, written: 3, dropped: 0, errors: 0 });
  });

  it('só reconfigura quando o SPS muda; com a fila cheia pula até o próximo quadro-chave', async () => {
    const f = fakeFeed();
    const feed = await startNativeFeed(f.api, args, vi.fn());
    f.push(key(1));
    f.push(key(2));
    const d = FakeDecoder.all[0]!;
    expect(d.configs).toHaveLength(1);
    f.push(key(3, SPS2));
    expect(d.configs).toHaveLength(2);
    // a placa não acompanha: os quadros seguintes ficam de fora até o próximo quadro-chave, que recomeça a fila
    d.decodeQueueSize = 20;
    f.push(delta(4));
    f.push(delta(5));
    expect(d.chunks.map((c) => c.timestamp)).toEqual([1, 2, 3]);
    f.push(key(6, SPS2));
    expect(d.configs).toHaveLength(3);
    expect(d.chunks.map((c) => c.timestamp)).toEqual([1, 2, 3, 6]);
    expect(feed.stats().skipped).toBe(2);
  });

  it('erro no decodificador: recomeça com um novo no próximo quadro-chave', async () => {
    const f = fakeFeed();
    const feed = await startNativeFeed(f.api, args, vi.fn());
    f.push(key(1));
    FakeDecoder.all[0]!.fail('quebrou');
    f.push(delta(2));
    f.push(key(3));
    expect(FakeDecoder.all).toHaveLength(2);
    expect(FakeDecoder.all[1]!.chunks.map((c) => c.timestamp)).toEqual([3]);
    expect(feed.stats()).toMatchObject({ errors: 1, lastError: 'quebrou' });
  });

  it('fonte encerrada avisa; parar de propósito não avisa e solta tudo', async () => {
    const onEnded = vi.fn();
    const f = fakeFeed();
    const feed = await startNativeFeed(f.api, args, onEnded);
    f.end();
    expect(onEnded).toHaveBeenCalledTimes(1);

    const f2 = fakeFeed();
    const onEnded2 = vi.fn();
    const feed2 = await startNativeFeed(f2.api, args, onEnded2);
    f2.push(key(1));
    feed2.stop();
    feed2.stop();
    f2.end();
    expect(onEnded2).not.toHaveBeenCalled();
    expect(f2.api.stop).toHaveBeenCalledTimes(1);
    expect(FakeDecoder.all.at(-1)!.state).toBe('closed');
    expect((feed2.track as unknown as FakeGenerator).stopped).toBe(true);
    // depois de parar, nada mais é decodificado
    f2.push(key(2));
    expect(FakeDecoder.all.at(-1)!.chunks).toHaveLength(1);
    feed.stop();
  });

  it('erro ao começar (placa sem H.264) sobe para quem chamou voltar ao getDisplayMedia', async () => {
    const f = fakeFeed();
    f.api.start.mockRejectedValueOnce('no-hw-encoder sem MFT');
    await expect(startNativeFeed(f.api, args, vi.fn())).rejects.toThrow(/^no-hw-encoder/);
  });

  it('bitrate entre o oc-live e a interface: 1,5× o da live, entre 16 e 50 Mb/s', () => {
    expect(feedBitrate(30e6)).toBe(45e6);
    expect(feedBitrate(6e6)).toBe(16e6);
    expect(feedBitrate(60e6)).toBe(50e6);
  });
});
