import type { Me } from '@opencord/contracts';
import { Avatar, Button } from '@opencord/ui';
import { useRef, useState } from 'react';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

const SIDE = 256;

/** Recorta o centro em quadrado e reduz para 256×256 (WebP, com PNG de reserva): envio pequeno e rápido. */
async function squareAvatar(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, SIDE, SIDE);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png')));
  if (!blob) throw new Error('não foi possível preparar a imagem');
  return new File([blob], blob.type === 'image/webp' ? 'avatar.webp' : 'avatar.png', { type: blob.type });
}

/** Foto de perfil em Configurações → Minha conta. */
export function AvatarPicker({ me }: { me: Me }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (updated: Me) => useData.getState().patchUser(updated);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) return setError('Escolha uma imagem (PNG, JPEG, WebP ou GIF).');
    setBusy(true);
    try {
      apply(await api().upload<Me>('/me/avatar', await squareAvatar(file)));
      useUi.getState().toast('success', 'Foto de perfil atualizada.');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await api().request<Me>('DELETE', '/me/avatar'));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-picker">
      <Avatar id={me.id} name={me.displayName} size={80} />
      <div className="avatar-picker-actions">
        <div className="avatar-picker-buttons">
          <Button icon="upload" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Enviando…' : me.avatarKey ? 'Trocar foto' : 'Enviar foto'}
          </Button>
          {me.avatarKey && (
            <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remover
            </Button>
          )}
        </div>
        <span className="muted small">A foto é recortada em quadrado. Todos nos seus servidores a veem.</span>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        aria-label="Escolher foto de perfil"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}
