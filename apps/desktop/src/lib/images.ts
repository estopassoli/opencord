import { cropAnimatedGif, isAnimatedGif } from './gif-crop';

/** Recorte em pixels da imagem original (escolhido no ImageCropDialog). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Banner do perfil: 300 × 104 px no cartão (`.pc-banner`); o recorte usa essa proporção. */
export const BANNER_ASPECT = 300 / 104;
/** limites do servidor (apps/api/src/users/avatar.service.ts) */
const AVATAR_MAX_BYTES = 1024 * 1024;
const AVATAR_MAX_SIDE = 1024;
const BANNER_MAX_BYTES = 4 * 1024 * 1024;
const BANNER_MAX_SIDE = 2560;

/** o recorte pega a imagem inteira (sem mexer)? */
const wholeImage = (c: CropRect, w: number, h: number) => c.x <= 1 && c.y <= 1 && c.w >= w - 1 && c.h >= h - 1;

async function dimensions(file: File) {
  const bmp = await createImageBitmap(file);
  const d = { w: bmp.width, h: bmp.height };
  bmp.close();
  return d;
}

/** tamanhos de saída a tentar para o GIF: do maior (sem ampliar o recorte) para o menor */
export function gifSizes(crop: CropRect, maxW: number, aspect: number, factors = [1, 0.8, 0.64, 0.5]) {
  const w0 = Math.max(16, Math.min(maxW, Math.round(crop.w)));
  return factors.map((f) => {
    const w = Math.max(16, Math.round(w0 * f));
    return { w, h: Math.max(16, Math.round(w / aspect)) };
  });
}

/**
 * Foto de perfil recortada: GIF animado continua animado (vai como está se o recorte pegar ele inteiro e couber no
 * limite); o resto vira WebP 256×256.
 */
export async function avatarImage(file: File, crop: CropRect, onProgress?: (f: number) => void): Promise<File> {
  if (await isAnimatedGif(file)) {
    const { w, h } = await dimensions(file);
    if (wholeImage(crop, w, h) && w === h && file.size <= AVATAR_MAX_BYTES && w <= AVATAR_MAX_SIDE) return file;
    return cropAnimatedGif(file, crop, gifSizes(crop, 256, 1), AVATAR_MAX_BYTES, 'avatar', onProgress);
  }
  return squareImage(file, 256, 'avatar', crop);
}

/**
 * Banner do perfil recortado na proporção do cartão: GIF animado continua animado (até 600 px de largura); imagem
 * parada vira WebP de até 960 px de largura.
 */
export async function profileBannerImage(file: File, crop: CropRect, onProgress?: (f: number) => void): Promise<File> {
  if (await isAnimatedGif(file)) {
    const { w, h } = await dimensions(file);
    if (wholeImage(crop, w, h) && file.size <= BANNER_MAX_BYTES && Math.max(w, h) <= BANNER_MAX_SIDE) return file;
    return cropAnimatedGif(file, crop, gifSizes(crop, 600, BANNER_ASPECT), BANNER_MAX_BYTES, 'banner', onProgress);
  }
  const bmp = await createImageBitmap(file);
  const outW = Math.max(16, Math.min(960, Math.round(crop.w)));
  const outH = Math.max(16, Math.round(outW / BANNER_ASPECT));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.88))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88)));
  if (!blob) throw new Error('não foi possível preparar a imagem');
  return new File([blob], `banner.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
}

/** GIF que pode ir como está (animado): sem recorte. */
export async function keepsAnimation(file: File): Promise<boolean> {
  if (file.type !== 'image/gif' || file.size > 1024 * 1024) return false;
  const bmp = await createImageBitmap(file);
  const ok = Math.max(bmp.width, bmp.height) <= 1024 && Math.min(bmp.width, bmp.height) >= 16;
  bmp.close();
  return ok;
}

/**
 * Recorta (o quadrado escolhido, ou o centro) e reduz para `side`×`side` (WebP, com PNG de reserva): envio pequeno e rápido.
 * GIF de até 1 MB e 1024 px segue original (animado).
 */
export async function squareImage(file: File, side = 256, name = 'imagem', crop?: CropRect): Promise<File> {
  const bmp = await createImageBitmap(file);
  // GIF pequeno vai como está para manter a animação (o avatar recorta no centro na exibição)
  if (
    !crop &&
    file.type === 'image/gif' &&
    file.size <= 1024 * 1024 &&
    Math.max(bmp.width, bmp.height) <= 1024 &&
    Math.min(bmp.width, bmp.height) >= 16
  ) {
    bmp.close();
    return file;
  }
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const r = crop ?? { x: (bmp.width - s) / 2, y: (bmp.height - s) / 2, w: s, h: s };
  ctx.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, side, side);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')));
  if (!blob) throw new Error('não foi possível preparar a imagem');
  return new File([blob], `${name}.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type });
}

/**
 * Banner do perfil (ADR-0048): GIF animado de até 4 MB e 2560 px vai como está (mantém a animação); o resto é
 * reduzido para no máximo 1500 px de largura em WebP (JPEG de reserva).
 */
export async function bannerImage(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  if (file.type === 'image/gif' && file.size <= 4 * 1024 * 1024 && Math.max(bmp.width, bmp.height) <= 2560) {
    bmp.close();
    return file;
  }
  const scale = Math.min(1, 1500 / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(16, Math.round(bmp.width * scale));
  canvas.height = Math.max(16, Math.round(bmp.height * scale));
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.88))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88)));
  if (!blob) throw new Error('não foi possível preparar a imagem');
  return new File([blob], `banner.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
}

/**
 * Emoji personalizado (ADR-0050): GIF de até 512 KB e 512 px vai como está (animado); imagem parada é reduzida para
 * caber em 128 px (WebP, PNG de reserva), mantendo a proporção.
 */
export async function emojiImage(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  if (file.type === 'image/gif') {
    const ok = file.size <= 512 * 1024 && Math.max(bmp.width, bmp.height) <= 512;
    bmp.close();
    if (!ok) throw new Error('GIF animado precisa ter até 512 KB e 512 px de lado.');
    return file;
  }
  const scale = Math.min(1, 128 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(16, Math.round(bmp.width * scale));
  canvas.height = Math.max(16, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.92))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')));
  if (!blob) throw new Error('não foi possível preparar a imagem');
  return new File([blob], `emoji.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type });
}

/** nome sugerido a partir do arquivo: só letras, números e _ (2 a 24) */
export function emojiNameFrom(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return base.length >= 2 ? base : `emoji_${base}`.slice(0, 24);
}
