/**
 * Recorte de som antes do envio: lê o áudio, desenha a forma de onda e grava só o trecho escolhido
 * como WAV mono (16 bits, até 48 kHz). 10 s nesse formato cabem em 960 KB, abaixo do limite de 1 MB.
 */

/** Menor trecho aceito (ms). */
export const TRIM_MIN_MS = 200;
const MAX_RATE = 48_000;

type PcmSource = Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'getChannelData'>;

/** Picos (0..1) de `bars` fatias iguais do áudio, misturando os canais. */
export function peaks(buf: PcmSource, bars: number): number[] {
  const out = new Array<number>(bars).fill(0);
  const step = buf.length / bars;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let b = 0; b < bars; b++) {
      const from = Math.floor(b * step);
      const to = Math.min(buf.length, Math.floor((b + 1) * step));
      let max = out[b] ?? 0;
      for (let i = from; i < to; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
      out[b] = Math.min(1, max);
    }
  }
  return out;
}

/** WAV PCM 16 bits mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytes = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  samples.forEach((v, i) => {
    const s = Math.max(-1, Math.min(1, v));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  });
  return view.buffer;
}

/** Decodifica o arquivo; null se não for um áudio que o navegador entende. */
export async function decodeAudio(file: Blob): Promise<AudioBuffer | null> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}

/** Grava o trecho [startMs, endMs) como WAV mono (o OfflineAudioContext mistura os canais e reamostra). */
export async function trimToWav(buf: AudioBuffer, startMs: number, endMs: number): Promise<Blob> {
  const rate = Math.min(buf.sampleRate, MAX_RATE);
  const seconds = (endMs - startMs) / 1000;
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.round(seconds * rate)), rate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0, startMs / 1000, seconds);
  const out = await ctx.startRendering();
  return new Blob([encodeWav(out.getChannelData(0), rate)], { type: 'audio/wav' });
}

export interface TrimRange {
  start: number;
  end: number;
}

/**
 * Move uma alça para `ms` dentro de [0, total]. O trecho fica entre TRIM_MIN_MS e `max`:
 * se passar do máximo, a outra alça acompanha.
 */
export function moveHandle(r: TrimRange, which: 'start' | 'end', ms: number, total: number, max: number): TrimRange {
  const at = Math.round(Math.max(0, Math.min(total, ms)));
  if (which === 'start') {
    const start = Math.min(at, r.end - TRIM_MIN_MS);
    return { start: Math.max(0, start), end: Math.min(r.end, start + max) };
  }
  const end = Math.max(at, r.start + TRIM_MIN_MS);
  return { start: Math.max(r.start, end - max), end: Math.min(total, end) };
}
