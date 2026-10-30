/** Recorte quadrado em pixels da imagem original (escolhido no ImageCropDialog). */
export interface CropRect {
  x: number;
  y: number;
  size: number;
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
  const r = crop ?? { x: (bmp.width - s) / 2, y: (bmp.height - s) / 2, size: s };
  ctx.drawImage(bmp, r.x, r.y, r.size, r.size, 0, 0, side, side);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')));
  if (!blob) throw new Error('não foi possível preparar a imagem');
  return new File([blob], `${name}.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type });
}
