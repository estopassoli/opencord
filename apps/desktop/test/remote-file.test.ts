import { describe, expect, it } from 'vitest';
import { chunkCount, decodeChunk, encodeChunk, FILE_CHUNK_BYTES, hex, safeFileName } from '../src/voice/remote-file';

describe('controle remoto: pedaços de arquivo', () => {
  it('codifica e decodifica com id, índice e dados', () => {
    const id = new Uint8Array(16).map((_, i) => i);
    const data = new Uint8Array([9, 8, 7]);
    const packet = encodeChunk(id, 42, data);
    const back = decodeChunk(packet);
    expect(back).toEqual({ id: hex(id), index: 42, data });
    expect(packet.byteLength).toBe(21 + 3);
  });
  it('rejeita o que não é pedaço (JSON das outras mensagens, pacote curto)', () => {
    expect(decodeChunk(new TextEncoder().encode('{"t":"m"}'))).toBeNull();
    expect(decodeChunk(new Uint8Array([0xf1, 1, 2]))).toBeNull();
    expect(() => encodeChunk(new Uint8Array(3), 0, new Uint8Array(0))).toThrow();
  });
  it('conta pedaços e limpa nomes de arquivo', () => {
    expect(chunkCount(0)).toBe(1);
    expect(chunkCount(FILE_CHUNK_BYTES)).toBe(1);
    expect(chunkCount(FILE_CHUNK_BYTES + 1)).toBe(2);
    expect(safeFileName('C:\\Users\\x\\..\\evil:name?.txt')).toBe('evil_name_.txt');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('')).toBe('arquivo');
  });
});
