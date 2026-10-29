import type { Channel, ServerDetail, ServerDirectoryEntry } from '@opencord/contracts';
import { Button, RadioGroup, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { loadServer, api, describeError } from '../../store/session';
import { useData } from '../../store/data';
import { useUi, type Modal } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { ServerSettings } from '../admin/ServerSettings';
import { SettingsModal } from '../settings/SettingsModal';
import { ScreenSourcePicker } from '../voice/ScreenSourcePicker';
import { QuickSwitcher } from './QuickSwitcher';

export function Modals() {
  const modal = useUi((s) => s.modal);
  if (!modal) return null;
  const close = () => useUi.getState().openModal(null);
  switch (modal.kind) {
    case 'create-server':
      return <CreateServer onClose={close} />;
    case 'explore-servers':
      return <ExploreServers onClose={close} />;
    case 'create-channel':
      return <CreateChannel modal={modal} onClose={close} />;
    case 'settings':
      return <SettingsModal onClose={close} />;
    case 'server-settings':
      return <ServerSettings serverId={modal.serverId} onClose={close} />;
    case 'quick-switcher':
      return <QuickSwitcher onClose={close} />;
    case 'screen-picker':
      return <ScreenSourcePicker onClose={() => useVoice.getState().cancelStreamPicker()} />;
    default:
      return null;
  }
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function CreateServer({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const d = await api().request<ServerDetail>('POST', '/servers', { name });
    useData.getState().setServerDetail(d);
    useUi.getState().go({ kind: 'server', serverId: d.id, channelId: null });
    onClose();
  });
  return (
    <Dialog title="Criar servidor" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <TextField
          label="Nome do servidor"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={100}
          autoFocus
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            Criar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Servidores são abertos a todos (ADR-0007): lista e entra com um clique, sem convite. */
function ExploreServers({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ServerDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api()
      .request<ServerDirectoryEntry[]>('GET', '/servers/directory')
      .then(setList, (e: unknown) => setError(describeError(e)));
  }, []);
  const join = async (id: string) => {
    setBusy(id);
    try {
      await api().request<ServerDetail>('POST', `/servers/${id}/join`);
      await loadServer(id);
      useUi.getState().go({ kind: 'server', serverId: id, channelId: null });
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog title="Explorar servidores" onClose={onClose}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <p className="muted">Carregando…</p>}
      {list?.length === 0 && <p className="muted">Nenhum servidor ainda. Crie o primeiro!</p>}
      <ul className="directory">
        {list?.map((s) => (
          <li key={s.id} className="directory-row">
            <span className="directory-icon" aria-hidden>
              {s.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="directory-names">
              <strong className="truncate">{s.name}</strong>
              <span className="muted small">{s.memberCount} membro(s)</span>
            </span>
            {s.joined ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  useUi.getState().go({ kind: 'server', serverId: s.id, channelId: null });
                  onClose();
                }}
              >
                Abrir
              </Button>
            ) : (
              <Button size="sm" disabled={busy === s.id} onClick={() => void join(s.id)}>
                Entrar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function CreateChannel({ modal, onClose }: { modal: Extract<Modal, { kind: 'create-channel' }>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'text' | 'voice'>(modal.channelKind);
  const { busy, error, submit } = useSubmit(async () => {
    const c = await api().request<Channel>('POST', `/servers/${modal.serverId}/channels`, {
      name,
      kind,
      categoryId: modal.categoryId,
    });
    useData.getState().upsertChannel(c);
    if (c.kind === 'text') useUi.getState().go({ kind: 'server', serverId: modal.serverId, channelId: c.id });
    onClose();
  });
  return (
    <Dialog title="Criar canal" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <RadioGroup<'text' | 'voice'>
          label="Tipo de canal"
          variant="cards"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'text', label: 'Texto', icon: 'hashtag', description: 'Mensagens, imagens e arquivos' },
            { value: 'voice', label: 'Voz', icon: 'speaker', description: 'Voz, vídeo e transmissão de tela' },
          ]}
        />
        <TextField
          label="Nome do canal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={64}
          autoFocus
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            Criar canal
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
