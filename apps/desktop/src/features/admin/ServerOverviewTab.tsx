import { askConfirm } from '../../components/AskDialog';
import { hasPermission, Permission, type ServerDetail, type ServerSummary } from '@opencord/contracts';
import { Button, ColorSwatches, Icon, TextField } from '@opencord/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useData } from '../../store/data';
import { api } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { ACCENTS, DEFAULT_ACCENT } from '../settings/AppearanceTab';
import { Section } from '../settings/Section';
import { wallpaperUrl } from '../../lib/server-theme';
import { ServerIconPicker } from './ServerIconPicker';
import { ServerProfileSection } from './ServerProfile';
import { toastError } from './serverSettingsKit';

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

/** Sai da visualização do servidor removido (sair/excluir). */
async function leaveLocally(serverId: string, onClose: () => void) {
  const voice = useVoice.getState();
  if (voice.serverId === serverId) await voice.leave().catch(() => undefined);
  useData.getState().removeServer(serverId);
  useUi.getState().go({ kind: 'home', tab: 'friends' });
  onClose();
}

/** Cor de destaque e papel de parede do servidor: valem para todo mundo enquanto o servidor está aberto. */
export function ServerThemeSection({ detail }: { detail: ServerDetail }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const apply = (s: ServerSummary) =>
    useData.setState((st) => ({
      servers: st.servers.map((x) => (x.id === s.id ? s : x)),
      details: st.details[s.id] ? { ...st.details, [s.id]: { ...st.details[s.id]!, ...s } } : st.details,
    }));
  const setAccent = async (accent: string | null) => {
    setBusy(true);
    try {
      apply(await api().request<ServerSummary>('PATCH', `/servers/${detail.id}`, { accent }));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const send = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/'))
      return useUi.getState().toast('error', 'Escolha uma imagem (PNG, JPEG ou WebP).');
    setBusy(true);
    try {
      apply(await api().upload<ServerSummary>(`/servers/${detail.id}/wallpaper`, await shrink(file)));
      useUi.getState().toast('success', 'Papel de parede atualizado.');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setBusy(true);
    try {
      apply(await api().request<ServerSummary>('DELETE', `/servers/${detail.id}/wallpaper`));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  const url = wallpaperUrl(detail.wallpaperKey);
  return (
    <Section
      title="Tema do servidor"
      description="A cor de destaque e o papel de parede valem para todo mundo enquanto este servidor está aberto; fora dele cada um volta para o seu tema."
    >
      <ColorSwatches
        label="Cor de destaque"
        colors={ACCENTS.slice(1)}
        defaultColor={DEFAULT_ACCENT}
        value={detail.accent}
        onChange={(v) => void setAccent(v)}
      />
      <p className="muted small">Sem cor escolhida, vale a cor de cada pessoa.</p>
      <div className="wallpaper-row">
        {url ? (
          <img className="wallpaper-preview" src={url} alt="Papel de parede atual" />
        ) : (
          <div className="wallpaper-preview wallpaper-empty">
            <Icon name="image" size={22} />
          </div>
        )}
        <div className="form-actions">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => void send(e.target.files?.[0])}
          />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            {url ? 'Trocar papel de parede' : 'Escolher papel de parede'}
          </Button>
          {url && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()}>
              Remover
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

/** Reduz a imagem para no máximo 1920 px de largura (JPEG) antes de enviar: a API aceita 4 MB e 2560 px. */
async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 1920 / bmp.width, 1920 / bmp.height);
  if (scale === 1 && file.size <= 3 * 1024 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return blob ? new File([blob], 'wallpaper.jpg', { type: 'image/jpeg' }) : file;
}

export function OverviewTab({
  detail,
  isOwner,
  onClose,
}: {
  detail: ServerDetail;
  isOwner: boolean;
  onClose: () => void;
}) {
  const canManage = hasPermission(detail.myPermissions, Permission.MANAGE_SERVER);
  const [name, setName] = useState(detail.name);
  const [busy, setBusy] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const s = await api().request<ServerSummary>('PATCH', `/servers/${detail.id}`, { name: n });
      useData.getState().setServerDetail({ ...detail, ...s });
      useUi.getState().toast('success', 'Servidor renomeado.');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (
      !(await askConfirm(`Você sai de “${detail.name}”.`, {
        title: 'Sair do servidor',
        confirmLabel: 'Sair',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api().request('POST', `/servers/${detail.id}/leave`);
      await leaveLocally(detail.id, onClose);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (confirmName !== detail.name) return;
    setBusy(true);
    try {
      await api().request('DELETE', `/servers/${detail.id}`);
      await leaveLocally(detail.id, onClose);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <>
      {canManage && (
        <Section title="Imagem do servidor">
          <ServerIconPicker detail={detail} />
        </Section>
      )}
      <Section title="Nome do servidor">
        {canManage ? (
          <form className="form inline-form" onSubmit={(e) => void rename(e)}>
            <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
            <Button type="submit" size="sm" disabled={busy || name.trim() === detail.name || !name.trim()}>
              Salvar
            </Button>
          </form>
        ) : (
          <p>{detail.name}</p>
        )}
      </Section>
      {canManage && <ServerProfileSection detail={detail} />}

      {!isOwner && !detail.official && (
        <Section title="Sair do servidor" description="Você precisará de um novo convite para voltar.">
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void leave()}>
            Sair do servidor
          </Button>
        </Section>
      )}

      {isOwner && (
        <Section
          title="Excluir servidor"
          description="Remove permanentemente o servidor, canais e mensagens. Esta ação não pode ser desfeita."
        >
          <form className="form" onSubmit={(e) => void remove(e)}>
            <TextField
              label="Digite o nome do servidor para confirmar"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={detail.name}
              autoComplete="off"
            />
            <div className="form-actions">
              <Button type="submit" variant="danger" size="sm" disabled={busy || confirmName !== detail.name}>
                Excluir servidor
              </Button>
            </div>
          </form>
        </Section>
      )}
    </>
  );
}
