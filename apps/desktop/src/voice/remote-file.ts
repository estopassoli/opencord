/**
 * Transferência de arquivo e área de transferência no controle remoto (ADR-0026, complemento). Os pacotes de dados do
 * LiveKit são pequenos (até ~15 KiB), então o arquivo vai em pedaços binários com um cabeçalho fixo, fora do JSON das
 * outras mensagens: byte 0 = tipo, 16 bytes de id, 4 bytes do índice, resto = dados. Puro, para teste.
 */
export const FILE_CHUNK_BYTES = 14_000;
export const FILE_MAX_BYTES = 25 * 1024 * 1024;
/** texto colado de uma vez (um pacote) */
export const CLIP_MAX_CHARS = 12_000;

const MAGIC = 0xf1;
const HEADER = 1 + 16 + 4;

export function encodeChunk(id: Uint8Array, index: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (id.byteLength !== 16) throw new Error('id de 16 bytes');
  const out = new Uint8Array(HEADER + data.byteLength);
  out[0] = MAGIC;
  out.set(id, 1);
  new DataView(out.buffer).setUint32(17, index);
  out.set(data, HEADER);
  return out;
}

export function decodeChunk(payload: Uint8Array): { id: string; index: number; data: Uint8Array } | null {
  if (payload.byteLength < HEADER || payload[0] !== MAGIC) return null;
  const id = hex(payload.subarray(1, 17));
  const index = new DataView(payload.buffer, payload.byteOffset).getUint32(17);
  return { id, index, data: payload.subarray(HEADER) };
}

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const chunkCount = (size: number) => Math.max(1, Math.ceil(size / FILE_CHUNK_BYTES));

/** nome seguro para gravar em disco: sem caminhos, sem caracteres reservados do Windows, até 120 chars */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  const clean = base
    .replace(/[<>:"|?*]|\p{Cc}/gu, '_')
    .replace(/^\.+/, '')
    .trim();
  return (clean || 'arquivo').slice(0, 120);
}
