import { describe, expect, it } from 'vitest';
import { buildPalette, GifWriter, PaletteMapper, TRANSPARENT, type GifPalette } from '../src/lib/gif-encode';
import { gifSizes } from '../src/lib/images';

/** Leitor de GIF mínimo (só o que o codificador grava) para conferir o resultado quadro a quadro. */
function decodeGif(bytes: Uint8Array) {
  let p = 0;
  const u8 = () => bytes[p++]!;
  const u16 = () => u8() | (u8() << 8);
  const ascii = (n: number) => String.fromCharCode(...bytes.subarray(p, (p += n)));
  expect(ascii(6)).toBe('GIF89a');
  const width = u16();
  const height = u16();
  const packed = u8();
  p += 2;
  const palette = packed & 0x80 ? bytes.slice(p, (p += 3 << ((packed & 7) + 1))) : null;
  let loop = false;
  let gce = { disposal: 0, transparent: -1, delay: 0 };
  // tela com os índices visíveis (-1 = nada)
  const screen = new Int16Array(width * height).fill(-1);
  const frames: { index: Int16Array; delay: number; disposal: number }[] = [];
  const subBlocks = () => {
    const parts: number[] = [];
    for (let n = u8(); n; n = u8()) for (let i = 0; i < n; i++) parts.push(u8());
    return parts;
  };
  for (;;) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8();
        const f = u8();
        const delay = u16();
        const ti = u8();
        u8();
        gce = { disposal: (f >> 2) & 7, transparent: f & 1 ? ti : -1, delay };
      } else if (label === 0xff) {
        const n = u8();
        const app = ascii(n);
        if (app === 'NETSCAPE2.0') loop = true;
        subBlocks();
      } else subBlocks();
      continue;
    }
    expect(b).toBe(0x2c);
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    expect(u8() & 0x80).toBe(0);
    const minCode = u8();
    const data = subBlocks();
    const idx = lzwDecode(data, minCode, w * h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const v = idx[yy * w + xx]!;
        if (v !== gce.transparent) screen[(y + yy) * width + x + xx] = v;
      }
    frames.push({ index: screen.slice(), delay: gce.delay, disposal: gce.disposal });
    if (gce.disposal === 2)
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) screen[(y + yy) * width + x + xx] = -1;
  }
  return { width, height, palette, loop, frames };
}

function lzwDecode(data: number[], minCode: number, pixels: number) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCode + 1;
  };
  reset();
  const out: number[] = [];
  let bit = 0;
  let prev: number[] | null = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, bit++) v |= ((data[bit >> 3]! >> (bit & 7)) & 1) << i;
    return v;
  };
  for (;;) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code]!;
    else if (prev && code === dict.length) entry = [...prev, prev[0]!];
    else throw new Error(`código LZW inválido ${code}`);
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0]!]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  expect(out.length).toBe(pixels);
  return out;
}

const rgba = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
  return d;
};

const colorAt = (pal: GifPalette | Uint8Array, i: number) => {
  const rgb = pal instanceof Uint8Array ? pal : pal.rgb;
  return [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
};

describe('codificador de GIF (recorte de GIF animado no perfil)', () => {
  it('paleta mantém as cores exatas quando são poucas', () => {
    const frame = rgba(4, 4, (x) => (x < 2 ? [255, 0, 0, 255] : [12, 200, 99, 255]));
    const pal = buildPalette([frame]);
    expect(pal.size).toBe(2);
    expect(pal.alpha).toBe(false);
    const idx = new PaletteMapper(pal).map(frame);
    expect(colorAt(pal, idx[0]!)).toEqual([255, 0, 0]);
    expect(colorAt(pal, idx[3]!)).toEqual([12, 200, 99]);
  });

  it('quadros: só o retângulo que mudou é gravado, repetidos viram um só e a animação volta igual', () => {
    const W = 8;
    const H = 6;
    const f1 = rgba(W, H, () => [0, 0, 255, 255]);
    const f3 = rgba(W, H, (x, y) => (x >= 2 && x < 4 && y >= 1 && y < 3 ? [255, 255, 0, 255] : [0, 0, 255, 255]));
    const pal = buildPalette([f1, f3]);
    const map = new PaletteMapper(pal);
    const gif = new GifWriter(W, H, pal);
    gif.add(map.map(f1), 5);
    gif.add(map.map(f1), 7); // igual: soma na duração
    gif.add(map.map(f3), 4);
    const out = decodeGif(gif.finish());
    expect(out.loop).toBe(true);
    expect([out.width, out.height]).toEqual([W, H]);
    expect(out.frames.map((f) => f.delay)).toEqual([12, 4]);
    const expected = [map.map(f1), map.map(f3)];
    out.frames.forEach((f, i) => expect(Array.from(f.index)).toEqual(Array.from(expected[i]!)));
  });

  it('imagem grande e cheia de cores: LZW com troca de tamanho de código e tabela reiniciada', () => {
    const W = 180;
    const H = 120;
    const f1 = rgba(W, H, (x, y) => [(x * 7) & 255, (y * 5) & 255, (x * y) & 255, 255]);
    const f2 = rgba(W, H, (x, y) => [(x * 3 + y) & 255, (y * 11) & 255, (x ^ y) & 255, 255]);
    const pal = buildPalette([f1, f2]);
    expect(pal.size).toBe(255);
    const map = new PaletteMapper(pal);
    const gif = new GifWriter(W, H, pal);
    const i1 = map.map(f1);
    const i2 = map.map(f2);
    gif.add(i1, 3);
    gif.add(i2, 3);
    const out = decodeGif(gif.finish());
    expect(Array.from(out.frames[0]!.index)).toEqual(Array.from(i1));
    expect(Array.from(out.frames[1]!.index)).toEqual(Array.from(i2));
    // a cor escolhida fica perto da original
    const [r, g, b] = colorAt(out.palette!, i1[W * 60 + 90]!) as [number, number, number];
    const src = f1.subarray((W * 60 + 90) * 4);
    expect(Math.abs(r - src[0]!) + Math.abs(g - src[1]!) + Math.abs(b - src[2]!)).toBeLessThan(60);
  });

  it('GIF com transparência: quadro inteiro, apagado antes do próximo', () => {
    const W = 6;
    const H = 4;
    const f1 = rgba(W, H, (x) => (x < 3 ? [0, 0, 0, 0] : [200, 10, 10, 255]));
    const f2 = rgba(W, H, (x) => (x >= 3 ? [0, 0, 0, 0] : [200, 10, 10, 255]));
    const pal = buildPalette([f1, f2]);
    expect(pal.alpha).toBe(true);
    const map = new PaletteMapper(pal);
    const gif = new GifWriter(W, H, pal);
    gif.add(map.map(f1), 10);
    gif.add(map.map(f2), 10);
    const out = decodeGif(gif.finish());
    expect(out.frames.map((f) => f.disposal)).toEqual([2, 2]);
    // pixel transparente não mostra o quadro anterior
    expect(out.frames[1]!.index[5]).toBe(-1);
    expect(out.frames[1]!.index[0]).not.toBe(-1);
    expect(map.map(f1)[0]).toBe(TRANSPARENT);
  });

  it('tamanhos a tentar: sem ampliar o recorte, na proporção pedida', () => {
    expect(gifSizes({ x: 0, y: 0, w: 1000, h: 1000 }, 256, 1)[0]).toEqual({ w: 256, h: 256 });
    expect(gifSizes({ x: 0, y: 0, w: 120, h: 120 }, 256, 1)[0]).toEqual({ w: 120, h: 120 });
    const banner = gifSizes({ x: 0, y: 0, w: 900, h: 312 }, 600, 300 / 104);
    expect(banner[0]).toEqual({ w: 600, h: 208 });
    expect(banner.at(-1)!.w).toBe(300);
  });
});
