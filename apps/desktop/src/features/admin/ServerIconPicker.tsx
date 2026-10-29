import type { ServerDetail, ServerSummary } from '@opencord/contracts';
import { Button } from '@opencord/ui';
import { useRef, useState } from 'react';
import { ServerIcon } from '../../components/ServerIcon';
import { squareImage } from '../../lib/images';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

/** Imagem do servidor em Configurações do servidor → Visão geral (quem pode gerenciar o servidor). */
export function ServerIconPicker({ detail }: { detail: ServerDetail }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = (s: ServerSummary) =>
    useData.setState((st) => ({
      servers: st.servers.map((x) => (x.id === s.id ? s : x)),
      details: st.details[s.id] ? { ...st.details, [s.id]: { ...st.details[s.id]!, ...s } } : st.details,
    }));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) return setError('Escolha uma imagem (PNG, JPEG, WebP ou GIF).');
    setBusy(true);
    try {
      apply(await api().upload<ServerSummary>(`/servers/${detail.id}/icon`, await squareImage(file, 256, 'servidor')));
      useUi.getState().toast('success', 'Imagem do servidor atualizada.');
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
      apply(await api().request<ServerSummary>('DELETE', `/servers/${detail.id}/icon`));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-picker">
      <span className="server-icon-preview">
        <ServerIcon name={detail.name} iconKey={detail.iconKey} />
      </span>
      <div className="avatar-picker-actions">
        <div className="avatar-picker-buttons">
          <Button icon="upload" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Enviando…' : detail.iconKey ? 'Trocar imagem' : 'Enviar imagem'}
          </Button>
          {detail.iconKey && (
            <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remover
            </Button>
          )}
        </div>
        <span className="muted small">Aparece na barra de servidores de todos. A imagem é recortada em quadrado.</span>
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
        aria-label="Escolher imagem do servidor"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}
