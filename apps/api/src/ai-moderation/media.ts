/**
 * Mídia para a moderação por IA (ADR-0036): imagens vão como estão (ou reduzidas) e vídeos viram alguns quadros.
 * Tudo via ffmpeg/ffprobe do sistema (presentes na imagem da API); sem eles, só o nome e o tipo do arquivo entram.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export interface ImageInput {
  mime: ImageMime;
  base64: string;
}

/** Acima disto a imagem é reduzida (a API aceita até 5 MB por imagem; menor = mais barato e mais rápido). */
const MAX_INLINE_BYTES = 1_200_000;
const MAX_EDGE = 1280;
/** quadros por vídeo: 1 a cada 10 s, no mínimo 4 e no máximo 10 (cenas curtas num vídeo longo não escapam) */
const VIDEO_FRAMES_MIN = 4;
const VIDEO_FRAMES_MAX = 10;
const VIDEO_SECONDS_PER_FRAME = 10;
export function framesFor(durationSeconds: number | null): number {
  if (!durationSeconds) return VIDEO_FRAMES_MIN;
  return Math.max(VIDEO_FRAMES_MIN, Math.min(VIDEO_FRAMES_MAX, Math.ceil(durationSeconds / VIDEO_SECONDS_PER_FRAME)));
}
const FFMPEG_TIMEOUT_MS = 20_000;

const isImageMime = (m: string): m is ImageMime =>
  m === 'image/png' || m === 'image/jpeg' || m === 'image/gif' || m === 'image/webp';

async function withTemp<T>(data: Buffer, ext: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'oc-mod-'));
  const path = join(dir, `in.${ext}`);
  try {
    await writeFile(path, data);
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Um quadro JPEG do arquivo em `at` segundos (ou o primeiro quadro de uma imagem), reduzido a MAX_EDGE. */
async function frameAt(path: string, at: number | null): Promise<Buffer> {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (at !== null) args.push('-ss', at.toFixed(2));
  args.push(
    '-i',
    path,
    '-frames:v',
    '1',
    '-vf',
    `scale='min(${MAX_EDGE},iw)':'min(${MAX_EDGE},ih)':force_original_aspect_ratio=decrease`,
    '-f',
    'image2',
    '-vcodec',
    'mjpeg',
    '-q:v',
    '5',
    'pipe:1',
  );
  const { stdout } = await run('ffmpeg', args, {
    encoding: 'buffer',
    maxBuffer: 8 * 1024 * 1024,
    timeout: FFMPEG_TIMEOUT_MS,
  });
  return stdout;
}

async function durationOf(path: string): Promise<number | null> {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
      { timeout: FFMPEG_TIMEOUT_MS },
    );
    const d = Number.parseFloat(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** Imagem pronta para a API: pequena vai como está; grande (ou GIF animado) vira um JPEG reduzido. */
export async function imageForModel(data: Buffer, mime: string): Promise<ImageInput | null> {
  if (!isImageMime(mime)) return null;
  if (data.length <= MAX_INLINE_BYTES && mime !== 'image/gif') return { mime, base64: data.toString('base64') };
  try {
    const jpeg = await withTemp(data, 'img', (p) => frameAt(p, null));
    return { mime: 'image/jpeg', base64: jpeg.toString('base64') };
  } catch {
    // sem ffmpeg: manda o original se couber no limite da API
    return data.length <= 5_000_000 ? { mime, base64: data.toString('base64') } : null;
  }
}

/** Quadros espalhados pelo vídeo (ver framesFor). Sem ffmpeg/ffprobe devolve []. */
export async function videoFrames(data: Buffer, ext = 'mp4'): Promise<ImageInput[]> {
  try {
    return await withTemp(data, ext, async (p) => {
      const d = await durationOf(p);
      const n = framesFor(d);
      const times = d ? Array.from({ length: n }, (_, i) => d * ((i + 0.5) / n)) : [0.5, 2, 5, 10];
      const out: ImageInput[] = [];
      for (const t of times) {
        try {
          const jpeg = await frameAt(p, t);
          if (jpeg.length) out.push({ mime: 'image/jpeg', base64: jpeg.toString('base64') });
        } catch {
          /* quadro fora da duração ou vídeo quebrado: segue com os que deu */
        }
      }
      return out;
    });
  } catch {
    return [];
  }
}
