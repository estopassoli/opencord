/**
 * Edição de clipes (ADR-0022): corta o trecho escolhido e exporta como vídeo (MP4) ou só o som (M4A), com a
 * mediabunny (MPL-2.0). Copia os dados codificados quando dá e recodifica só o necessário nas bordas.
 */
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from 'mediabunny';

export async function exportRange(
  file: Blob,
  range: { start: number; end: number },
  kind: 'video' | 'audio',
  onProgress?: (p: number) => void,
  /** só o vídeo, sem nenhuma trilha de som */
  noAudio = false,
): Promise<Uint8Array<ArrayBuffer>> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: range.start, end: range.end },
    ...(kind === 'audio' ? { video: { discard: true } } : {}),
    // clipes com várias trilhas: fica só a mistura (a primeira), que todo player toca
    audio: noAudio ? { discard: true } : (_t, n) => (n === 1 ? {} : { discard: true }),
    showWarnings: false,
  });
  if (!conversion.isValid) throw new Error('não foi possível converter este clipe');
  if (onProgress) conversion.onProgress = (p) => onProgress(p);
  await conversion.execute();
  const buf = output.target.buffer;
  if (!buf) throw new Error('nada foi gerado');
  return new Uint8Array(buf);
}

/** Fontes de som separadas de um clipe (sem a mistura, que é a primeira trilha). */
export interface ClipSources {
  names: string[];
  buffers: AudioBuffer[];
}

/** Lê as trilhas de som separadas (computador, voz, efeitos). null em clipes de uma trilha só. */
export async function loadSources(file: Blob): Promise<ClipSources | null> {
  const { AudioBufferSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const tracks = await input.getAudioTracks();
  if (tracks.length < 2) return null;
  const duration = await input.computeDuration();
  const rate = 48_000;
  const names: string[] = [];
  const buffers: AudioBuffer[] = [];
  for (const t of tracks.slice(1)) {
    const out = new AudioBuffer({ numberOfChannels: 2, length: Math.ceil(duration * rate) + 1, sampleRate: rate });
    for await (const { buffer, timestamp } of new AudioBufferSink(t).buffers()) {
      const at = Math.round(Math.max(0, timestamp) * rate);
      for (let ch = 0; ch < 2; ch++) {
        const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
        const room = Math.max(0, out.length - at);
        out.copyToChannel(src.subarray(0, Math.min(src.length, room)), ch, at);
      }
    }
    names.push(t.name ?? `Áudio ${names.length + 1}`);
    buffers.push(out);
  }
  return { names, buffers };
}

/** Mistura as fontes ligadas no trecho [start, end) (segundos). */
export async function mixSources(src: ClipSources, on: boolean[], start: number, end: number): Promise<AudioBuffer> {
  const rate = 48_000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round((end - start) * rate)), rate);
  src.buffers.forEach((b, i) => {
    if (!on[i]) return;
    const node = ctx.createBufferSource();
    node.buffer = b;
    node.connect(ctx.destination);
    node.start(0, start, end - start);
  });
  return ctx.startRendering();
}

/**
 * Exporta com só as fontes de som ligadas: o vídeo do trecho é copiado (cortado como em exportRange) e o som vira
 * uma trilha única com a mistura.
 */
export async function exportMixed(
  file: Blob,
  range: { start: number; end: number },
  kind: 'video' | 'audio',
  mixed: AudioBuffer,
): Promise<Uint8Array<ArrayBuffer>> {
  const { AudioBufferSource, EncodedPacketSink, EncodedVideoPacketSource, QUALITY_HIGH } = await import('mediabunny');
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  let copyVideo: (() => Promise<void>) | null = null;
  if (kind === 'video') {
    const videoOnly = await exportRange(file, range, 'video', undefined, true);
    const input = new Input({ source: new BlobSource(new Blob([videoOnly])), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track?.codec) throw new Error('clipe sem vídeo');
    const video = new EncodedVideoPacketSource(track.codec);
    output.addVideoTrack(video);
    const config = await track.getDecoderConfig();
    copyVideo = async () => {
      let first = true;
      for await (const p of new EncodedPacketSink(track).packets()) {
        await video.add(p, first && config ? { decoderConfig: config } : undefined);
        first = false;
      }
    };
  }
  const audio = new AudioBufferSource({ codec: 'aac', quality: QUALITY_HIGH });
  output.addAudioTrack(audio);
  await output.start();
  await copyVideo?.();
  await audio.add(mixed);
  await output.finalize();
  const buf = output.target.buffer;
  if (!buf) throw new Error('nada foi gerado');
  return new Uint8Array(buf);
}
