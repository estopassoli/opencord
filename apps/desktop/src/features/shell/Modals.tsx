import type {
  AdminServerEntry,
  Category,
  Channel,
  ChannelKind,
  DiscordImportPreview,
  Invite,
  InvitePreview,
  ServerDetail,
  ServerDirectoryEntry,
} from '@opencord/contracts';
import { Button, Icon, RadioGroup, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { ServerIcon } from '../../components/ServerIcon';
import { AddToDmDialog, FullProfileDialog } from '../chat/DmExtras';
import { parseInviteCode } from '../../lib/invite';
import { loadServer, api, describeError } from '../../store/session';
import { useData } from '../../store/data';
import { useUi, type Modal } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { ServerSettings } from '../admin/ServerSettings';
import { SettingsModal } from '../settings/SettingsModal';
import { ScreenSourcePicker } from '../voice/ScreenSourcePicker';
import { WatchTogetherDialog } from '../voice/WatchTogether';
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
    case 'invite':
      return <InviteDialog serverId={modal.serverId} onClose={close} />;
    case 'profile':
      return <FullProfileDialog userId={modal.userId} onClose={close} />;
    case 'add-to-dm':
      return <AddToDmDialog peerId={modal.peerId} onClose={close} />;
    case 'join-invite':
      return (
        <Dialog title="Convite para servidor" onClose={close}>
          <InviteJoin
            initialCode={modal.code}
            onJoined={(id) => {
              useUi.getState().go({ kind: 'server', serverId: id, channelId: null });
              close();
            }}
          />
        </Dialog>
      );
    case 'create-channel':
      return <CreateChannel modal={modal} onClose={close} />;
    case 'watch-together':
      return <WatchTogetherDialog onClose={close} />;
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
/** Convidar pessoas: link do convite (abre no navegador, mesmo sem conta) ou, sem interface web, o código. */
function InviteDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const name = useData((s) => s.details[serverId]?.name ?? s.servers.find((x) => x.id === serverId)?.name ?? '');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api()
      .request<Invite>('POST', `/servers/${serverId}/invites`)
      .then(setInvite, (e: unknown) => setError(describeError(e)));
  }, [serverId]);
  const value = invite ? (invite.url ?? invite.code) : null;
  const copy = () => {
    if (!value) return;
    void navigator.clipboard.writeText(value).then(() => setCopied(true));
  };
  return (
    <Dialog title={`Convidar pessoas para ${name}`} onClose={onClose}>
      <p className="muted">
        {invite?.url ? (
          <>
            Envie este link. Quem abrir entra pelo navegador, mesmo sem conta (só escolhe um apelido). No app, também dá
            para colar o link em <strong>Explorar servidores → Tenho um convite</strong>.
          </>
        ) : (
          <>
            Envie este código. A pessoa entra em <strong>Explorar servidores → Tenho um convite</strong>.
          </>
        )}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="invite-code-row">
        <TextField
          label={invite?.url ? 'Link de convite' : 'Código de convite'}
          value={value ?? 'Gerando…'}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button icon={copied ? 'check' : 'copy'} disabled={!value} onClick={copy}>
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </Dialog>
  );
}

/** Colar um convite: mostra o servidor (prévia) e entra. */
function InviteJoin({ onJoined, initialCode }: { onJoined: (serverId: string) => void; initialCode?: string }) {
  const [text, setText] = useState(initialCode ?? '');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  // vindo de um link: já mostra o servidor
  useEffect(() => {
    if (!initialCode) return;
    api()
      .request<InvitePreview>('GET', `/invites/${initialCode}`)
      .then(setPreview, (e: unknown) => setAutoError(describeError(e)));
  }, [initialCode]);
  const look = useSubmit(async () => {
    setPreview(null);
    const code = parseInviteCode(text);
    if (!code) throw new Error('Cole o código de convite (10 letras e números) ou o link.');
    setPreview(await api().request<InvitePreview>('GET', `/invites/${code}`));
  });
  const join = useSubmit(async () => {
    if (!preview) return;
    await api().request<ServerDetail>('POST', `/invites/${preview.code}`);
    await loadServer(preview.server.id);
    onJoined(preview.server.id);
  });
  return (
    <section className="invite-join" aria-label="Tenho um convite">
      <h3 className="section-label">Tenho um convite</h3>
      <form className="invite-code-row" onSubmit={(e) => void look.submit(e)}>
        <TextField
          label="Código ou link do convite"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          placeholder="ex.: hK3mP9xQ2a"
        />
        <Button type="submit" variant="secondary" disabled={look.busy || !text.trim()}>
          Ver convite
        </Button>
      </form>
      {(look.error ?? join.error ?? autoError) && (
        <p className="form-error" role="alert">
          {look.error ?? join.error ?? autoError}
        </p>
      )}
      {preview && (
        <form className="directory-row invite-preview" onSubmit={(e) => void join.submit(e)}>
          <span className="directory-icon" aria-hidden>
            <ServerIcon
              name={preview.server.name}
              iconKey={preview.server.iconKey}
              official={preview.server.official}
            />
          </span>
          <span className="directory-names">
            <strong className="truncate">{preview.server.name}</strong>
            <span className="muted small">{preview.memberCount} membro(s)</span>
          </span>
          {preview.joined ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => onJoined(preview.server.id)}>
              Abrir
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={join.busy}>
              Entrar
            </Button>
          )}
        </form>
      )}
    </section>
  );
}

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
      <InviteJoin
        onJoined={(id) => {
          useUi.getState().go({ kind: 'server', serverId: id, channelId: null });
          onClose();
        }}
      />
      <h3 className="section-label">Servidores abertos</h3>
      {!list && !error && <p className="muted">Carregando…</p>}
      {list?.length === 0 && <p className="muted">Nenhum servidor aberto.</p>}
      <ul className="directory">
        {list?.map((s) => (
          <li key={s.id} className="directory-row">
            <span className="directory-icon" aria-hidden>
              <ServerIcon name={s.name} iconKey={s.iconKey} official />
            </span>
            <span className="directory-names">
              <strong className="truncate">
                {s.name} <Icon name="verified" size={14} active label="Servidor oficial verificado" />
              </strong>
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
      <AdminServers onClose={onClose} />
    </Dialog>
  );
}

/** Super admin (ADR-0013): todos os servidores da instância; entrar fica na auditoria e todos veem. */
function AdminServers({ onClose }: { onClose: () => void }) {
  const isAdmin = useData((s) => Boolean(s.me?.isInstanceAdmin));
  const [list, setList] = useState<AdminServerEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (isAdmin)
      void api()
        .request<AdminServerEntry[]>('GET', '/admin/servers')
        .then(setList, () => undefined);
  }, [isAdmin]);
  if (!isAdmin || !list) return null;
  const others = list.filter((s) => !s.official);
  const go = (id: string) => {
    useUi.getState().go({ kind: 'server', serverId: id, channelId: null });
    onClose();
  };
  const join = async (s: AdminServerEntry) => {
    if (!confirm(`Entrar em "${s.name}" como super admin? A entrada fica registrada e os membros veem você.`)) return;
    setBusy(s.id);
    try {
      await api().request<ServerDetail>('POST', `/admin/servers/${s.id}/join`);
      await loadServer(s.id);
      go(s.id);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setBusy(null);
    }
  };
  /** Só o selo de verificado: o servidor continua privado (ADR-0013). */
  const toggleVerified = async (s: AdminServerEntry) => {
    setBusy(s.id);
    try {
      await api().request('PUT', `/admin/servers/${s.id}/verified`, { verified: !s.verified });
      setList((l) => l?.map((x) => (x.id === s.id ? { ...x, verified: !s.verified } : x)) ?? l);
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-label="Todos os servidores (super admin)">
      <h3 className="section-label">Todos os servidores · super admin</h3>
      {others.length === 0 && <p className="muted">Nenhum servidor criado por usuários ainda.</p>}
      <ul className="directory">
        {others.map((s) => (
          <li key={s.id} className="directory-row">
            <span className="directory-icon" aria-hidden>
              <ServerIcon name={s.name} iconKey={s.iconKey} />
            </span>
            <span className="directory-names">
              <strong className="truncate">
                {s.name}
                {s.verified && <Icon name="verified" size={14} active label="Servidor verificado" />}
              </strong>
              <span className="muted small truncate">
                de {s.owner.displayName} · {s.memberCount} membro(s)
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon="verified"
              aria-pressed={s.verified}
              disabled={busy === s.id}
              onClick={() => void toggleVerified(s)}
            >
              {s.verified ? 'Tirar selo' : 'Verificar'}
            </Button>
            {s.joined ? (
              <Button variant="secondary" size="sm" onClick={() => go(s.id)}>
                Abrir
              </Button>
            ) : (
              <Button size="sm" icon="shield" disabled={busy === s.id} onClick={() => void join(s)}>
                Entrar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
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
  const [kind, setKind] = useState<ChannelKind>(modal.channelKind);
  const { busy, error, submit } = useSubmit(async () => {
    const c = await api().request<Channel>('POST', `/servers/${modal.serverId}/channels`, {
      name,
      kind,
      categoryId: modal.categoryId,
    });
    useData.getState().upsertChannel(c);
    if (c.kind !== 'voice') useUi.getState().go({ kind: 'server', serverId: modal.serverId, channelId: c.id });
    onClose();
  });
  return (
    <Dialog title="Criar canal" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <RadioGroup<ChannelKind>
          label="Tipo de canal"
          variant="cards"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'text', label: 'Texto', icon: 'hashtag', description: 'Mensagens, imagens e arquivos' },
            { value: 'voice', label: 'Voz', icon: 'speaker', description: 'Voz, vídeo e transmissão de tela' },
            { value: 'board', label: 'Quadro', icon: 'kanban', description: 'Kanban com colunas e cards' },
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
