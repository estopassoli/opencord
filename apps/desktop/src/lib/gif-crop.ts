/**
 * Recorte de GIF animado no app (foto e banner do perfil): os quadros saem do `ImageDecoder` (WebCodecs, já com
 * a composição de cada quadro resolvida), são recortados e reduzidos num canvas e voltam a ser GIF pelo
 * `gif-encode.ts`. Se o resultado passar do limite do servidor, tenta de novo em tamanhos menores.
 */
import { buildPalette, GifWriter, PaletteMapper } from './gif-encode';
import type { CropRect } from './images';

/** duração de quadro sem informação no arquivo (o navegador usa 100 ms) */
const DEFAULT_DELAY_CS = 10;
/** quadros usados para montar a paleta */
const PALETTE_SAMPLES = 12;

/** `ImageDecoder` existe (Chromium: Electron, WebView2, Chrome)? */
export const canDecodeGif = () => typeof ImageDecoder !== 'undefined';

interface Decoded {
  count: number;
  /** desenha o quadro `i` recortado no canvas e devolve a duração em centésimos */
  draw(
    i: number,
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    w: number,
    h: number,
  ): Promise<number>;
  close(): void;
}

async function open(file: Blob, crop: CropRect): Promise<Decoded> {
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
  await dec.tracks.ready;
  await dec.completed;
  const count = dec.tracks.selectedTrack?.frameCount ?? 1;
  return {
    count,
    async draw(i, ctx, w, h) {
      const { image } = await dec.decode({ frameIndex: i });
      try {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
        const us = image.duration;
        return us == null ? DEFAULT_DELAY_CS : Math.max(0, Math.round(us / 10_000));
      } finally {
        image.close();
      }
    },
    close: () => dec.close(),
  };
}

function canvas2d(w: number, h: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    return c.getContext('2d', { willReadFrequently: true })!;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

/** dá a vez à interface entre um quadro e outro */
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));

/** GIF tem mais de um quadro? (`false` também quando não dá para ler) */
export async function isAnimatedGif(file: File): Promise<boolean> {
  if (file.type !== 'image/gif' || !canDecodeGif()) return false;
  try {
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    await dec.completed;
    const n = dec.tracks.selectedTrack?.frameCount ?? 1;
    dec.close();
    return n > 1;
  } catch {
    return false;
  }
}

/**
 * Recorta um GIF animado. `sizes` são os tamanhos de saída a tentar, do maior para o menor: o primeiro que couber
 * em `maxBytes` vale (o progresso recomeça a cada tentativa). Erro se nenhum couber.
 */
export async function cropAnimatedGif(
  file: File,
  crop: CropRect,
  sizes: readonly { w: number; h: number }[],
  maxBytes: number,
  name: string,
  onProgress?: (fraction: number) => void,
): Promise<File> {
  const d = await open(file, crop);
  try {
    for (let a = 0; a < sizes.length; a++) {
      const { w, h } = sizes[a]!;
      const ctx = canvas2d(w, h);
      ctx.imageSmoothingQuality = 'high';
      const step = Math.max(1, Math.floor(d.count / PALETTE_SAMPLES));
      const samples: Uint8ClampedArray[] = [];
      for (let i = 0; i < d.count; i += step) {
        await d.draw(i, ctx, w, h);
        samples.push(ctx.getImageData(0, 0, w, h).data);
      }
      const palette = buildPalette(samples);
      const mapper = new PaletteMapper(palette);
      const gif = new GifWriter(w, h, palette);
      for (let i = 0; i < d.count; i++) {
        const delay = await d.draw(i, ctx, w, h);
        gif.add(mapper.map(ctx.getImageData(0, 0, w, h).data), delay);
        onProgress?.((i + 1) / d.count);
        if (i % 4 === 3) await yieldUi();
      }
      const bytes = gif.finish();
      if (bytes.length <= maxBytes) {
        onProgress?.(1);
        return new File([bytes], `${name}.gif`, { type: 'image/gif' });
      }
    }
  } finally {
    d.close();
  }
  throw new Error('O GIF ficou grande demais mesmo depois do recorte. Tente um GIF mais curto.');
}
