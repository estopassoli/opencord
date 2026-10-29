import type { Me } from '@opencord/contracts';
import { Avatar, Button } from '@opencord/ui';
import { useRef, useState } from 'react';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { squareImage } from '../../lib/images';

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
      apply(await api().upload<Me>('/me/avatar', await squareImage(file, 256, 'avatar')));
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
