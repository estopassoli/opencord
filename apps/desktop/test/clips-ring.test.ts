import { describe, expect, it } from 'vitest';
import { ChunkRing, type StoredChunk } from '../src/clips/ring';

const S = 1_000_000;
const v = (sec: number, key = false): StoredChunk => ({ ts: sec * S, dur: S / 60, key, data: new Uint8Array(10) });
const a = (sec: number): StoredChunk => ({ ts: sec * S, dur: S / 50, key: true, data: new Uint8Array(4) });

describe('memória dos clipes', () => {
  it('começa num quadro-chave e guarda só a janela', () => {
    const r = new ChunkRing(60 * S);
    r.pushVideo(v(0)); // sem quadro-chave antes: ignorado
    expect(r.snapshot()).toBeNull();
    for (let s = 1; s <= 130; s++) {
      r.pushVideo(v(s, s % 2 === 1)); // quadro-chave a cada 2 s
      r.pushAudio(a(s));
    }
    const snap = r.snapshot()!;
    expect(snap.video[0]!.key).toBe(true);
    // último quadro em 130 s: o clipe começa no quadro-chave de 69 s, o último antes do início da janela (70 s)
    expect(snap.base).toBe(69 * S);
    expect(snap.video.at(-1)!.ts).toBe(130 * S);
    expect(snap.audio[0]!.ts).toBeGreaterThanOrEqual(snap.base);
    expect(snap.audio.at(-1)!.ts).toBe(130 * S);
  });
  it('trilhas de áudio fora de ordem não deixam buraco (a 2 antes da 1 derrubava o trim)', () => {
    const r = new ChunkRing(10 * S);
    r.pushVideo(v(1, true));
    expect(() => r.pushAudio(a(1), 2)).not.toThrow();
    expect(() => r.pushAudio(a(1), 1)).not.toThrow();
    r.pushAudio(a(1), 0);
    for (let s = 2; s <= 30; s++) r.pushAudio(a(s), 2);
    expect(r.bytes).toBeGreaterThan(0);
    const snap = r.snapshot()!;
    expect(snap.extra).toHaveLength(2);
  });
  it('limpa e conta bytes', () => {
    const r = new ChunkRing(10 * S);
    r.pushVideo(v(1, true));
    r.pushAudio(a(1));
    expect(r.bytes).toBe(14);
    r.clear();
    expect(r.bytes).toBe(0);
  });
});

describe('memória dos clipes: teto', () => {
  const S = 1_000_000;
  const big = (sec: number, key: boolean): StoredChunk => ({
    ts: sec * S,
    dur: S / 60,
    key,
    data: new Uint8Array(1000),
  });
  it('sem quadro-chave novo, o grupo não cresce além do teto', () => {
    const r = new ChunkRing(60 * S, 5000);
    r.pushVideo(big(0, true));
    for (let i = 1; i < 20; i++) r.pushVideo(big(i, false));
    expect(r.bytes).toBeLessThanOrEqual(5000);
  });
  it('com grupos, descarta os mais antigos até caber e a contagem bate', () => {
    const r = new ChunkRing(60 * S, 4500);
    for (let i = 0; i < 10; i++) r.pushVideo(big(i, true));
    expect(r.bytes).toBe(4000);
    expect(r.snapshot()?.video).toHaveLength(4);
  });
  it('codificador recriado: o clipe começa no primeiro quadro-chave novo (resolução antiga fora do arquivo)', () => {
    const r = new ChunkRing(60 * S);
    for (let s = 1; s <= 10; s++) {
      r.pushVideo(v(s, s % 2 === 1));
      r.pushAudio(a(s));
    }
    r.resetVideo();
    expect(r.snapshot()).toBeNull();
    // o codificador novo só entrega a partir de um quadro-chave
    r.pushVideo(v(11));
    expect(r.snapshot()).toBeNull();
    r.pushVideo(v(12, true));
    r.pushAudio(a(12));
    r.pushVideo(v(13));
    const snap = r.snapshot()!;
    expect(snap.base).toBe(12 * S);
    expect(snap.video).toHaveLength(2);
    expect(snap.audio.every((c) => c.ts >= 12 * S)).toBe(true);
  });
});
