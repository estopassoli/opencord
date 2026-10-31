import { describe, expect, it } from 'vitest';
import { encodeWav, moveHandle, peaks, TRIM_MIN_MS } from '../src/features/voice/soundTrim';

describe('recorte de som', () => {
  it('WAV mono 16 bits com cabeçalho e amostras certas', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 0.5]), 48_000);
    const v = new DataView(buf);
    const str = (at: number) => String.fromCharCode(...new Uint8Array(buf, at, 4));
    expect(buf.byteLength).toBe(44 + 8);
    expect([str(0), str(8), str(12), str(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(48_000);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383]);
  });
  it('10 s no formato do recorte cabem em 1 MB', () => {
    expect(encodeWav(new Float32Array(48_000 * 10), 48_000).byteLength).toBeLessThan(1024 * 1024);
  });
  it('picos por fatia, misturando canais', () => {
    const l = new Float32Array([0.1, 0.2, 0, 0]);
    const r = new Float32Array([0, 0, -0.9, 0.3]);
    const src = { numberOfChannels: 2, length: 4, getChannelData: (c: number) => (c ? r : l) };
    const [a, b] = peaks(src, 2);
    expect(a).toBeCloseTo(0.2);
    expect(b).toBeCloseTo(0.9);
  });
  it('bordas respeitam o mínimo, o máximo e o tamanho do áudio', () => {
    const r = { start: 0, end: 10_000 };
    expect(moveHandle(r, 'end', 30_000, 25_000, 10_000)).toEqual({ start: 15_000, end: 25_000 });
    expect(moveHandle(r, 'start', 9_950, 25_000, 10_000)).toEqual({ start: 10_000 - TRIM_MIN_MS, end: 10_000 });
    expect(moveHandle({ start: 12_000, end: 20_000 }, 'start', 5_000, 25_000, 10_000)).toEqual({
      start: 5_000,
      end: 15_000,
    });
    expect(moveHandle(r, 'start', -50, 25_000, 10_000)).toEqual({ start: 0, end: 10_000 });
  });
});
