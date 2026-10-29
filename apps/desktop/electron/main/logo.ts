/**
 * Encoder PNG mínimo (RGBA, zlib) e o badge de "não lidas" da barra de tarefas.
 * O logotipo do OpenCord é resources/opencord-logo.png (ícones gerados por scripts/make-icons.mjs).
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

type RGB = [number, number, number];
const RED: RGB = [0xe5, 0x48, 0x4d];

/** Cobertura 0..1 de um pixel por supersampling 4x4. */
function coverage(px: number, py: number, inside: (x: number, y: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(px + (i + 0.5) / 4, py + (j + 0.5) / 4)) n++;
  return n / 16;
}

/** Badge de "não lidas" (círculo vermelho) para a sobreposição da barra de tarefas. */
export function renderBadge(size: number): Buffer {
  const out = new Uint8Array(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = coverage(x, y, (px, py) => Math.hypot(px - c, py - c) <= size * 0.46);
      out.set([...RED, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  return encodePng(size, size, out);
}
