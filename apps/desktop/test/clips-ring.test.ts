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
  it('limpa e conta bytes', () => {
    const r = new ChunkRing(10 * S);
    r.pushVideo(v(1, true));
    r.pushAudio(a(1));
    expect(r.bytes).toBe(14);
    r.clear();
    expect(r.bytes).toBe(0);
  });
});
