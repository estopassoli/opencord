import type { Category, Channel, DiscordImportPreview, ServerDetail, ServerDirectoryEntry } from '@opencord/contracts';
import { Button, Icon, RadioGroup, TextField } from '@opencord/ui';
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
    case 'create-category':
      return <CreateCategory serverId={modal.serverId} onClose={close} />;
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
  const [mode, setMode] = useState<'new' | 'discord'>('new');
  const [name, setName] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const d = await api().request<ServerDetail>('POST', '/servers', { name });
    useData.getState().setServerDetail(d);
    useUi.getState().go({ kind: 'server', serverId: d.id, channelId: null });
    onClose();
  });
  return (
    <Dialog title="Criar servidor" onClose={onClose}>
      <div className="seg-tabs" role="tablist" aria-label="Como criar">
        <button role="tab" className="seg-tab" aria-selected={mode === 'new'} onClick={() => setMode('new')}>
          <Icon name="plus" size={16} /> Do zero
        </button>
        <button role="tab" className="seg-tab" aria-selected={mode === 'discord'} onClick={() => setMode('discord')}>
          <Icon name="upload" size={16} /> Importar do Discord
        </button>
      </div>
      {mode === 'discord' ? (
        <ImportDiscord onClose={onClose} />
      ) : (
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
      )}
    </Dialog>
  );
}

/**
 * Importa a estrutura de um servidor do Discord pelo link de modelo oficial (discord.new/…): categorias, canais,
 * cargos e permissões. Mensagens, membros e emojis não fazem parte do modelo (ver docs/DECISIONS.md).
 */
function ImportDiscord({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<DiscordImportPreview | null>(null);
  const load = useSubmit(async () => {
    setPreview(await api().request<DiscordImportPreview>('POST', '/servers/import/discord/preview', { link }));
  });
  const run = useSubmit(async () => {
    const d = await api().request<ServerDetail>('POST', '/servers/import/discord', { link });
    useData.getState().setServerDetail(d);
    useUi.getState().go({ kind: 'server', serverId: d.id, channelId: null });
    useUi.getState().toast('success', `Servidor "${d.name}" importado.`);
    onClose();
  });

  if (!preview) {
    return (
      <form onSubmit={load.submit} className="form">
        <TextField
          label="Link do modelo do servidor"
          placeholder="https://discord.new/…"
          hint="No Discord: Configurações do servidor → Modelo de servidor → gerar e copiar o link."
          value={link}
          onChange={(e) => setLink(e.target.value)}
          required
          maxLength={200}
          autoFocus
        />
        <p className="muted small import-note">
          Vêm categorias, canais de texto e voz, cargos (com cores) e permissões. Mensagens, membros, emojis e arquivos
          não fazem parte do modelo e não são importados.
        </p>
        {load.error && (
          <p className="form-error" role="alert">
            {load.error}
          </p>
        )}
        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={load.busy}>
            {load.busy ? 'Buscando…' : 'Ver prévia'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={run.submit} className="form">
      <div className="import-head">
        <strong>{preview.name}</strong>
        <span className="muted small">
          {preview.categories.filter((c) => c.name).length} categorias · {preview.textChannels} canais de texto ·{' '}
          {preview.voiceChannels} de voz · {preview.roles.length} cargos
        </span>
      </div>
      <div className="import-preview" aria-label="Prévia da estrutura">
        {preview.categories.map((c, i) => (
          <section key={`${c.name ?? '-'}-${i}`}>
            {c.name && <h4>{c.name}</h4>}
            <ul>
              {c.channels.map((ch, j) => (
                <li key={`${ch.name}-${j}`}>
                  <Icon name={ch.kind === 'voice' ? 'speaker' : 'hashtag'} size={16} />
                  <span className="truncate">{ch.name}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {preview.roles.length > 0 && (
          <section>
            <h4>Cargos</h4>
            <ul className="import-roles">
              {preview.roles.map((r, i) => (
                <li key={`${r.name}-${i}`} className="role-chip" style={{ borderColor: r.color ?? undefined }}>
                  {r.name}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {preview.skipped > 0 && (
        <p className="muted small">
          {preview.skipped} item(ns) sem equivalente no OpenCord ficam de fora (permissões por pessoa, tipos de canal
          que não existem aqui ou excesso sobre os limites).
        </p>
      )}
      {run.error && (
        <p className="form-error" role="alert">
          {run.error}
        </p>
      )}
      <div className="form-actions">
        <Button variant="ghost" onClick={() => setPreview(null)}>
          Voltar
        </Button>
        <Button type="submit" disabled={run.busy}>
          {run.busy ? 'Importando…' : 'Importar servidor'}
        </Button>
      </div>
    </form>
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

function CreateCategory({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    const c = await api().request<Category>('POST', `/servers/${serverId}/categories`, { name });
    useData.getState().upsertCategory(c);
    onClose();
  });
  return (
    <Dialog title="Criar categoria" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <TextField
          label="Nome da categoria"
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
            Criar categoria
          </Button>
        </div>
      </form>
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
