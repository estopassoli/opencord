/**
 * Supressão de ruído com RNNoise (xiph/rnnoise via WASM, roda localmente; nada sai do dispositivo).
 * O `noiseSuppression` do navegador só tira chiado leve; o RNNoise remove ruído de fundo (TV, ventilador,
 * conversa ao fundo) antes de publicar. Processador do livekit-client: entra o microfone cru, sai a trilha limpa.
 */
import { loadRnnoise, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';

let wasm: Promise<ArrayBuffer> | null = null;
const loadWasm = () => {
  wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((e: unknown) => {
    wasm = null; // permite nova tentativa
    throw e;
  });
  return wasm;
};

export const RNNOISE = 'rnnoise';

export class RnnoiseProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = RNNOISE;
  processedTrack?: MediaStreamTrack;
  private ctx: AudioContext | null = null;
  private node: RnnoiseWorkletNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;

  async init({ track }: AudioProcessorOptions) {
    const binary = await loadWasm();
    // o RNNoise assume 48 kHz
    const ctx = new AudioContext({ sampleRate: 48_000 });
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const node = new RnnoiseWorkletNode(ctx, { wasmBinary: binary, maxChannels: 1 });
      const dest = ctx.createMediaStreamDestination();
      src.connect(node).connect(dest);
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
      this.ctx = ctx;
      this.src = src;
      this.node = node;
      this.processedTrack = dest.stream.getAudioTracks()[0];
    } catch (e) {
      await ctx.close().catch(() => undefined);
      throw e;
    }
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    this.src?.disconnect();
    this.node?.disconnect();
    this.node?.destroy();
    this.processedTrack?.stop();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = this.src = this.node = null;
    this.processedTrack = undefined;
  }
}
