/** Recorta o centro em quadrado e reduz para `side`×`side` (WebP, com PNG de reserva): envio pequeno e rápido. */
export async function squareImage(file: File, side = 256, name = 'imagem'): Promise<File> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, side, side);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')));
  if (!blob) throw new Error('não foi possível preparar a imagem');
  return new File([blob], `${name}.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type });
}
