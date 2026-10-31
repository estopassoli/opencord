import { WIN_AUDIO_EXCEPT_SELF } from '../../electron/shared/ipc';
import { bridge } from '../lib/bridge';
// arquivo próprio: o CSP (script-src 'self') não aceita o worklet embutido como data:
import workletUrl from '../clips/pcm-worklet.js?url&no-inline';

/**
 * Áudio do sistema do Go Live sem o som do próprio OpenCord (ADR-0025). O `restrictOwnAudio` do Chromium deixava passar
 * as vozes da chamada para quem assistia (relato real); o oc-audio.exe pede ao Windows o som de todos os programas
 * menos a árvore de processos do OpenCord, e o PCM vira uma trilha aqui. Sem o Windows 10 build 20348+ (ou fora do
 * Windows), `start` devolve null e a live usa a captura do Chromium.
 */
export class SystemAudio {
  private constructor(
    private readonly ctx: AudioContext,
    readonly track: MediaStreamTrack,
    private readonly off: () => void,
  ) {}

  static async start(): Promise<SystemAudio | null> {
    if (!bridge?.winAudio) return null;
    const ctx = new AudioContext({ sampleRate: 48_000 });
    let off = () => undefined as void;
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'oc-pcm-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      const dest = ctx.createMediaStreamDestination();
      node.connect(dest);
      off = bridge.on('win-audio', ({ id, pcm }) => {
        if (id !== WIN_AUDIO_EXCEPT_SELF) return;
        const whole = pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength;
        const buf = (whole ? pcm.buffer : pcm.slice().buffer) as ArrayBuffer;
        node.port.postMessage(buf, [buf]);
      });
      if (!(await bridge.winAudio.start(WIN_AUDIO_EXCEPT_SELF))) throw new Error('process loopback indisponível');
      await ctx.resume().catch(() => undefined);
      const [track] = dest.stream.getAudioTracks();
      if (!track) throw new Error('sem trilha');
      return new SystemAudio(ctx, track, off);
    } catch {
      off();
      void bridge.winAudio.stop(WIN_AUDIO_EXCEPT_SELF).catch(() => undefined);
      await ctx.close().catch(() => undefined);
      return null;
    }
  }

  stop() {
    this.off();
    void bridge?.winAudio.stop(WIN_AUDIO_EXCEPT_SELF).catch(() => undefined);
    this.track.stop();
    void this.ctx.close().catch(() => undefined);
  }
}
