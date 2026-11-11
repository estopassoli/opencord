import { describe, expect, it } from 'vitest';
import { AnnexBToAvc, avcC, parseNativeChunk, splitNals } from '../src/clips/annexb';

const SPS = new Uint8Array([0x67, 0x42, 0xc0, 0x28, 0xda, 0x01]);
const PPS = new Uint8Array([0x68, 0xce, 0x3c, 0x80]);
const IDR = new Uint8Array([0x65, 0x88, 0x84, 0x00, 0x33]);
const P = new Uint8Array([0x41, 0x9a, 0x02]);
const AUD = new Uint8Array([0x09, 0xf0]);
const annexB = (...nals: Uint8Array[]) => {
  const parts: number[] = [];
  nals.forEach((n, i) => parts.push(...(i % 2 ? [0, 0, 1] : [0, 0, 0, 1]), ...n));
  return new Uint8Array(parts);
};

describe('clipes nativos: H.264 Annex B → MP4 (avc)', () => {
  it('separa as unidades NAL com códigos de início de 3 e 4 bytes', () => {
    const nals = splitNals(annexB(AUD, SPS, PPS, IDR));
    expect(nals.map((n) => n[0]! & 0x1f)).toEqual([9, 7, 8, 5]);
    expect([...nals[3]!]).toEqual([...IDR]);
  });

  it('avcC com perfil, compatibilidade e nível do SPS', () => {
    const r = avcC(SPS, PPS);
    expect([...r.subarray(0, 8)]).toEqual([1, 0x42, 0xc0, 0x28, 0xff, 0xe1, 0, SPS.length]);
    expect(r.length).toBe(11 + SPS.length + PPS.length);
  });

  it('quadro-chave leva a configuração; o resto vai com tamanho na frente, sem SPS/PPS/AUD', () => {
    const c = new AnnexBToAvc(1920, 1080);
    expect(c.push(annexB(P), false)).toBeNull();
    const k = c.push(annexB(AUD, SPS, PPS, IDR), true)!;
    expect(k.config?.codec).toBe('avc1.42c028');
    expect(k.config?.codedWidth).toBe(1920);
    expect([...k.data]).toEqual([0, 0, 0, IDR.length, ...IDR]);
    const d = c.push(annexB(AUD, P), false)!;
    expect(d.config).toBeUndefined();
    expect([...d.data]).toEqual([0, 0, 0, P.length, ...P]);
    // quadro-chave sem SPS/PPS (o encoder só manda no primeiro): usa a configuração anterior
    expect(c.push(annexB(IDR), true)!.config?.codec).toBe('avc1.42c028');
  });

  it('lê o cabeçalho de cada quadro do oc-live', () => {
    const buf = new ArrayBuffer(13 + 3);
    const v = new DataView(buf);
    v.setUint32(0, 3, true);
    v.setUint8(4, 1);
    v.setBigInt64(5, 1_234_567n, true);
    new Uint8Array(buf, 13).set([7, 8, 9]);
    const c = parseNativeChunk(buf)!;
    expect(c.key).toBe(true);
    expect(c.ts).toBe(1_234_567);
    expect([...c.data]).toEqual([7, 8, 9]);
    expect(parseNativeChunk(new ArrayBuffer(5))).toBeNull();
  });
});
