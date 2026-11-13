/**
 * Codificador de GIF animado (GIF89a) para recortar GIFs no app sem perder a animação (foto e banner do perfil).
 *
 * - paleta global de até 255 cores por corte na mediana (median cut) sobre amostras dos quadros; o índice 255 fica
 *   reservado para "transparente";
 * - quadros opacos: só o retângulo que mudou é gravado, e o que não mudou dentro dele vira transparente (o quadro
 *   anterior aparece por baixo), o que deixa o arquivo bem menor; quadros iguais em sequência viram um só, somando a
 *   duração;
 * - GIF com transparência de verdade: quadro inteiro, apagado antes do próximo (disposal 2);
 * - LZW igual ao do omggif (MIT), que é o de referência para GIF.
 */

/** índice da paleta reservado para "transparente" */
export const TRANSPARENT = 255;
const MAX_COLORS = 255;

/** paleta em RGB (3 bytes por cor), sempre com 256 entradas no arquivo */
export interface GifPalette {
  rgb: Uint8Array;
  size: number;
  /** quadros com pixel transparente: sem o recorte por diferença */
  alpha: boolean;
}

/** pixel com alfa abaixo disso conta como transparente */
const ALPHA_CUTOFF = 128;

/**
 * Paleta pelo corte na mediana: histograma em 5 bits por canal, caixas divididas no canal mais largo até 255 cores;
 * cada cor é a média exata dos pixels da caixa (então imagem com poucas cores mantém as cores exatas).
 */
export function buildPalette(samples: readonly Uint8ClampedArray[], maxPixels = 200_000): GifPalette {
  const count = new Uint32Array(32768);
  const sr = new Float64Array(32768);
  const sg = new Float64Array(32768);
  const sb = new Float64Array(32768);
  let total = 0;
  let alpha = false;
  for (const s of samples) total += s.length / 4;
  const step = Math.max(1, Math.floor(total / maxPixels));
  for (const s of samples) {
    for (let p = 0; p < s.length; p += 4 * step) {
      if (s[p + 3]! < ALPHA_CUTOFF) {
        alpha = true;
        continue;
      }
      const r = s[p]!;
      const g = s[p + 1]!;
      const b = s[p + 2]!;
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      count[k]!++;
      sr[k]! += r;
      sg[k]! += g;
      sb[k]! += b;
    }
  }
  // o laço acima pula alfas sem olhar todos os pixels: confere a transparência em todos
  if (!alpha)
    outer: for (const s of samples)
      for (let p = 3; p < s.length; p += 4)
        if (s[p]! < ALPHA_CUTOFF) {
          alpha = true;
          break outer;
        }

  const bins: number[] = [];
  for (let k = 0; k < 32768; k++) if (count[k]) bins.push(k);
  const ch = (k: number, c: number) => (k >> (10 - 5 * c)) & 31;
  interface Box {
    bins: number[];
    n: number;
  }
  const boxOf = (list: number[]): Box => ({ bins: list, n: list.reduce((a, k) => a + count[k]!, 0) });
  const boxes: Box[] = bins.length ? [boxOf(bins)] : [];
  while (boxes.length < MAX_COLORS) {
    // divide a caixa com mais pixels que ainda tem mais de um tom
    let pick = -1;
    for (let i = 0; i < boxes.length; i++)
      if (boxes[i]!.bins.length > 1 && (pick < 0 || boxes[i]!.n > boxes[pick]!.n)) pick = i;
    if (pick < 0) break;
    const box = boxes[pick]!;
    let axis = 0;
    let widest = -1;
    for (let c = 0; c < 3; c++) {
      let lo = 31;
      let hi = 0;
      for (const k of box.bins) {
        const v = ch(k, c);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > widest) {
        widest = hi - lo;
        axis = c;
      }
    }
    box.bins.sort((a, b) => ch(a, axis) - ch(b, axis));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.bins.length - 1; i++) {
      acc += count[box.bins[i]!]!;
      cut = i + 1;
      if (acc * 2 >= box.n) break;
    }
    boxes.splice(pick, 1, boxOf(box.bins.slice(0, cut)), boxOf(box.bins.slice(cut)));
  }

  const rgb = new Uint8Array(256 * 3);
  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const k of box.bins) {
      r += sr[k]!;
      g += sg[k]!;
      b += sb[k]!;
    }
    rgb[i * 3] = Math.round(r / box.n);
    rgb[i * 3 + 1] = Math.round(g / box.n);
    rgb[i * 3 + 2] = Math.round(b / box.n);
  });
  return { rgb, size: Math.max(1, boxes.length), alpha };
}

/** Converte RGBA para índices da paleta (cor mais próxima, com cache em 6 bits por canal). */
export class PaletteMapper {
  private cache = new Int16Array(1 << 18).fill(-1);
  constructor(private palette: GifPalette) {}

  map(rgba: Uint8ClampedArray, out = new Uint8Array(rgba.length / 4)): Uint8Array {
    const { rgb, size } = this.palette;
    for (let i = 0, p = 0; p < rgba.length; i++, p += 4) {
      if (rgba[p + 3]! < ALPHA_CUTOFF) {
        out[i] = TRANSPARENT;
        continue;
      }
      const r = rgba[p]!;
      const g = rgba[p + 1]!;
      const b = rgba[p + 2]!;
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let idx = this.cache[key]!;
      if (idx < 0) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < size; c++) {
          const dr = rgb[c * 3]! - r;
          const dg = rgb[c * 3 + 1]! - g;
          const db = rgb[c * 3 + 2]! - b;
          const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
          if (d < bestD) {
            bestD = d;
            best = c;
            if (d === 0) break;
          }
        }
        idx = best;
        this.cache[key] = idx;
      }
      out[i] = idx;
    }
    return out;
  }
}

class Bytes {
  buf: Uint8Array<ArrayBuffer> = new Uint8Array(64 * 1024);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  byte(b: number) {
    this.grow(1);
    this.buf[this.len++] = b;
  }
  u16(v: number) {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }
  bytes(a: ArrayLike<number>) {
    this.grow(a.length);
    this.buf.set(a, this.len);
    this.len += a.length;
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
}

/** LZW do GIF (como no omggif), já em sub-blocos de até 255 bytes; termina com o bloco vazio. */
export function writeLzw(out: Bytes, minCodeSize: number, index: Uint8Array) {
  out.byte(minCodeSize);
  const block = new Uint8Array(256);
  let blockLen = 0;
  let cur = 0;
  let shift = 0;
  const flushBlock = () => {
    if (!blockLen) return;
    out.byte(blockLen);
    out.bytes(block.subarray(0, blockLen));
    blockLen = 0;
  };
  const pushByte = (b: number) => {
    block[blockLen++] = b;
    if (blockLen === 255) flushBlock();
  };
  const clearCode = 1 << minCodeSize;
  const eoi = clearCode + 1;
  let next = eoi + 1;
  let size = minCodeSize + 1;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    cur |= code << shift;
    shift += size;
    while (shift >= 8) {
      pushByte(cur & 0xff);
      cur >>>= 8;
      shift -= 8;
    }
  };
  emit(clearCode);
  let prefix = index[0]!;
  for (let i = 1; i < index.length; i++) {
    const k = index[i]!;
    const key = (prefix << 8) | k;
    const code = table.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clearCode);
      next = eoi + 1;
      size = minCodeSize + 1;
      table = new Map();
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) pushByte(cur & 0xff);
  flushBlock();
  out.byte(0);
}

interface PendingFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  index: Uint8Array;
  delay: number;
  transparent: boolean;
  disposal: number;
}

/** Monta o GIF quadro a quadro (índices já na paleta). */
export class GifWriter {
  private out = new Bytes();
  private prev: Uint8Array | null = null;
  private pending: PendingFrame | null = null;
  private frames = 0;

  constructor(
    private width: number,
    private height: number,
    private palette: GifPalette,
  ) {
    const o = this.out;
    o.ascii('GIF89a');
    o.u16(width);
    o.u16(height);
    o.byte(0xf7); // tabela global de 256 cores, 8 bits por canal
    o.byte(0);
    o.byte(0);
    o.bytes(palette.rgb);
    // NETSCAPE2.0: repetir para sempre
    o.bytes([0x21, 0xff, 0x0b]);
    o.ascii('NETSCAPE2.0');
    o.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
  }

  /** `delay` em centésimos de segundo (como no GIF) */
  add(index: Uint8Array, delay: number) {
    const { width: W, height: H } = this;
    const prev = this.prev;
    if (prev && this.pending) {
      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0, i = 0; y < H; y++)
        for (let x = 0; x < W; x++, i++)
          if (index[i] !== prev[i]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      if (x1 < 0) {
        // igual ao anterior: só estica a duração
        this.pending.delay = Math.min(0xffff, this.pending.delay + delay);
        return;
      }
      if (!this.palette.alpha) {
        const w = x1 - x0 + 1;
        const h = y1 - y0 + 1;
        const sub = new Uint8Array(w * h);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y0 + y) * W + x0 + x;
            sub[y * w + x] = index[i] === prev[i] ? TRANSPARENT : index[i]!;
          }
        this.flush();
        this.pending = { x: x0, y: y0, w, h, index: sub, delay, transparent: true, disposal: 1 };
        this.prev = index;
        return;
      }
    }
    this.flush();
    const alpha = this.palette.alpha;
    this.pending = { x: 0, y: 0, w: W, h: H, index, delay, transparent: alpha, disposal: alpha ? 2 : 1 };
    this.prev = index;
  }

  private flush() {
    const f = this.pending;
    if (!f) return;
    this.pending = null;
    const o = this.out;
    o.bytes([0x21, 0xf9, 0x04, (f.disposal << 2) | (f.transparent ? 1 : 0)]);
    o.u16(f.delay);
    o.byte(f.transparent ? TRANSPARENT : 0);
    o.byte(0);
    o.byte(0x2c);
    o.u16(f.x);
    o.u16(f.y);
    o.u16(f.w);
    o.u16(f.h);
    o.byte(0);
    writeLzw(o, 8, f.index);
    this.frames++;
  }

  /** quantos quadros foram gravados (depois de juntar os repetidos) */
  get frameCount() {
    return this.frames + (this.pending ? 1 : 0);
  }

  finish(): Uint8Array<ArrayBuffer> {
    this.flush();
    this.out.byte(0x3b);
    return this.out.buf.slice(0, this.out.len);
  }
}

export { Bytes as GifBytes };
