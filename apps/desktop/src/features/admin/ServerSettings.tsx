import {
  hasPermission,
  Permission,
  type AuditEntry,
  type Category,
  type Channel,
  type Member,
  type PermissionName,
  type Role,
  type ServerDetail,
  type ServerSummary,
} from '@opencord/contracts';
import { Button, Checkbox, ColorSwatches, Icon, TextField } from '@opencord/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { useData } from '../../store/data';
import { api, describeError, loadServer } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { Section, TabbedLayout, type TabDef } from '../settings/SettingsModal';
import '../settings/settings.css';
import { SoundsTab } from '../voice/Soundboard';
import { ServerIconPicker } from './ServerIconPicker';

type ServerTab = 'overview' | 'roles' | 'members' | 'channels' | 'sounds' | 'audit';

const PERMISSION_LABELS: Record<PermissionName, string> = {
  VIEW_CHANNEL: 'Ver canais',
  SEND_MESSAGES: 'Enviar mensagens',
  MANAGE_MESSAGES: 'Gerenciar mensagens',
  ATTACH_FILES: 'Anexar arquivos',
  ADD_REACTIONS: 'Adicionar reações',
  READ_HISTORY: 'Ler histórico',
  MENTION_EVERYONE: 'Mencionar @everyone',
  CONNECT: 'Conectar à voz',
  SPEAK: 'Falar',
  VIDEO: 'Vídeo',
  STREAM: 'Transmitir (Go Live)',
  MUTE_MEMBERS: 'Silenciar membros',
  MOVE_MEMBERS: 'Mover/desconectar membros',
  KICK_MEMBERS: 'Expulsar membros',
  MANAGE_CHANNELS: 'Gerenciar canais',
  MANAGE_ROLES: 'Gerenciar cargos',
  MANAGE_SERVER: 'Gerenciar servidor',
  VIEW_AUDIT_LOG: 'Ver registro de auditoria',
  ADMINISTRATOR: 'Administrador (todas as permissões)',
};

const PERMISSION_KEYS = Object.keys(Permission) as PermissionName[];

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

/** Sai da visualização do servidor removido (sair/excluir). */
async function leaveLocally(serverId: string, onClose: () => void) {
  const voice = useVoice.getState();
  if (voice.serverId === serverId) await voice.leave().catch(() => undefined);
  useData.getState().removeServer(serverId);
  useUi.getState().go({ kind: 'home', tab: 'friends' });
  onClose();
}

export function ServerSettings({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const detail = useData((s) => s.details[serverId]);
  const me = useData((s) => s.me);
  const initialTab = useUi((s) => (s.modal?.kind === 'server-settings' ? s.modal.tab : undefined));
  const [tab, setTab] = useState<ServerTab>((initialTab as ServerTab | undefined) ?? 'overview');

  useEffect(() => {
    if (!detail) void loadServer(serverId).catch(toastError);
  }, [detail, serverId]);

  const tabs = useMemo<TabDef<ServerTab>[]>(() => {
    if (!detail) return [];
    const p = detail.myPermissions;
    const list: TabDef<ServerTab>[] = [{ id: 'overview', label: 'Visão geral' }];
    if (hasPermission(p, Permission.MANAGE_ROLES)) list.push({ id: 'roles', label: 'Cargos' });
    list.push({ id: 'members', label: 'Membros' });
    if (hasPermission(p, Permission.MANAGE_CHANNELS)) list.push({ id: 'channels', label: 'Canais' });
    // qualquer membro envia efeitos sonoros (ADR-0016)
    list.push({ id: 'sounds', label: 'Efeitos sonoros' });
    if (hasPermission(p, Permission.VIEW_AUDIT_LOG)) list.push({ id: 'audit', label: 'Registro de auditoria' });
    return list;
  }, [detail]);

  if (!detail || !me) {
    return (
      <Dialog title="Configurações do servidor" onClose={onClose} fullscreen>
        <p className="muted">Carregando…</p>
      </Dialog>
    );
  }

  const active: ServerTab = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const isOwner = detail.ownerId === me.id;

  return (
    <Dialog title={`Configurações — ${detail.name}`} onClose={onClose} fullscreen>
      <TabbedLayout tabs={tabs} active={active} onChange={setTab} label="Seções do servidor">
        {active === 'overview' && <OverviewTab detail={detail} isOwner={isOwner} onClose={onClose} />}
        {active === 'roles' && <RolesTab detail={detail} />}
        {active === 'members' && <MembersTab detail={detail} myId={me.id} />}
        {active === 'channels' && <ChannelsTab detail={detail} />}
        {active === 'sounds' && (
          <SoundsTab
            serverId={detail.id}
            myId={me.id}
            canManage={hasPermission(detail.myPermissions, Permission.MANAGE_SERVER)}
          />
        )}
        {active === 'audit' && <AuditTab detail={detail} />}
      </TabbedLayout>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

function OverviewTab({ detail, isOwner, onClose }: { detail: ServerDetail; isOwner: boolean; onClose: () => void }) {
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
    if (!window.confirm(`Sair do servidor “${detail.name}”?`)) return;
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

      {!isOwner && (
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

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

const sortRoles = (roles: Role[]) =>
  [...roles].sort((a, b) => (a.isEveryone !== b.isEveryone ? (a.isEveryone ? 1 : -1) : b.position - a.position));

function RolesTab({ detail }: { detail: ServerDetail }) {
  const roles = useMemo(() => sortRoles(detail.roles), [detail.roles]);
  const [selectedId, setSelectedId] = useState<string | null>(roles[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const selected = roles.find((r) => r.id === selectedId) ?? null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const n = newName.trim();
    if (!n) return;
    setCreating(true);
    try {
      const r = await api().request<Role>('POST', `/servers/${detail.id}/roles`, { name: n, permissions: 0 });
      useData.getState().upsertRole(r);
      setSelectedId(r.id);
      setNewName('');
    } catch (err) {
      toastError(err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="split">
      <div className="split-list">
        <form className="inline-form" onSubmit={(e) => void create(e)}>
          <TextField
            aria-label="Nome do novo cargo"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Novo cargo"
            maxLength={64}
          />
          <button className="icon-btn" aria-label="Criar cargo" disabled={creating || !newName.trim()}>
            <Icon name="plus" size={18} />
          </button>
        </form>
        <ul className="pick-list" aria-label="Cargos">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="pick-item"
                aria-pressed={r.id === selectedId}
                onClick={() => setSelectedId(r.id)}
              >
                <span className="role-dot" style={{ background: r.color ?? 'var(--text-muted)' }} aria-hidden="true" />
                <span className="truncate">{r.isEveryone ? '@everyone' : r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="split-detail">
        {selected ? (
          <RoleEditor key={selected.id} role={selected} onDeleted={() => setSelectedId(null)} />
        ) : (
          <p className="muted">Selecione um cargo para editar.</p>
        )}
      </div>
    </div>
  );
}

function RoleEditor({ role, onDeleted }: { role: Role; onDeleted: () => void }) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState<string | null>(role.color);
  const [perms, setPerms] = useState(role.permissions);
  const [busy, setBusy] = useState(false);
  const dirty = name !== role.name || color !== role.color || perms !== role.permissions;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = role.isEveryone ? { permissions: perms } : { name: name.trim(), color, permissions: perms };
      const r = await api().request<Role>('PATCH', `/roles/${role.id}`, body);
      useData.getState().upsertRole(r);
      useUi.getState().toast('success', 'Cargo salvo.');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Excluir o cargo “${role.name}”?`)) return;
    setBusy(true);
    try {
      await api().request('DELETE', `/roles/${role.id}`);
      useData.getState().removeRole(role.serverId, role.id);
      onDeleted();
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void save(e)}>
      {role.isEveryone ? (
        <p className="muted small">Permissões padrão aplicadas a todos os membros do servidor.</p>
      ) : (
        <div className="field-row">
          <TextField
            label="Nome do cargo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={64}
          />
          <ColorSwatches label="Cor" value={color} onChange={setColor} />
        </div>
      )}
      <fieldset className="perm-list">
        <legend>Permissões</legend>
        {PERMISSION_KEYS.map((k) => {
          const bit = Permission[k];
          return (
            <Checkbox
              key={k}
              label={PERMISSION_LABELS[k]}
              checked={hasPermission(perms, bit)}
              onChange={(v) => setPerms((p) => (v ? p | bit : p & ~bit))}
            />
          );
        })}
      </fieldset>
      <div className="form-actions">
        {!role.isEveryone && (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>
            Excluir cargo
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty || busy}
          onClick={() => {
            setName(role.name);
            setColor(role.color);
            setPerms(role.permissions);
          }}
        >
          Descartar
        </Button>
        <Button type="submit" size="sm" disabled={!dirty || busy || (!role.isEveryone && !name.trim())}>
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------

function MembersTab({ detail, myId }: { detail: ServerDetail; myId: string }) {
  const canRoles = hasPermission(detail.myPermissions, Permission.MANAGE_ROLES);
  const canKick = hasPermission(detail.myPermissions, Permission.KICK_MEMBERS);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const roles = useMemo(() => sortRoles(detail.roles).filter((r) => !r.isEveryone), [detail.roles]);
  const roleById = useMemo(() => new Map(detail.roles.map((r) => [r.id, r])), [detail.roles]);

  const q = query.trim().toLowerCase();
  const members = detail.members
    .filter(
      (m) =>
        !q ||
        m.user.displayName.toLowerCase().includes(q) ||
        m.user.username.toLowerCase().includes(q) ||
        (m.nickname ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => (a.nickname ?? a.user.displayName).localeCompare(b.nickname ?? b.user.displayName, 'pt-BR'));

  const setRoles = async (m: Member, roleIds: string[]) => {
    try {
      const updated = await api().request<Member>('PUT', `/servers/${detail.id}/members/${m.user.id}/roles`, {
        roleIds,
      });
      useData.getState().upsertMember(detail.id, updated);
    } catch (err) {
      toastError(err);
    }
  };

  const kick = async (m: Member) => {
    if (!window.confirm(`Expulsar ${m.nickname ?? m.user.displayName} do servidor?`)) return;
    try {
      await api().request('DELETE', `/servers/${detail.id}/members/${m.user.id}`);
      useData.getState().removeMember(detail.id, m.user.id);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <TextField
        aria-label="Buscar membros"
        type="search"
        leadingIcon="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Buscar entre ${detail.members.length} membros`}
      />
      <ul className="admin-list">
        {members.map((m) => {
          const name = m.nickname ?? m.user.displayName;
          const isOwner = m.user.id === detail.ownerId;
          const open = expanded === m.user.id;
          const panelId = `member-roles-${m.user.id}`;
          return (
            <li key={m.user.id} className="admin-row admin-row-col">
              <div className="admin-row-main">
                <div className="admin-row-text">
                  <span className="truncate">
                    {name}
                    {isOwner && <span className="muted small"> · dono</span>}
                  </span>
                  <span className="muted small truncate">@{m.user.username}</span>
                </div>
                <div className="chips">
                  {m.roleIds.map((id) => {
                    const r = roleById.get(id);
                    if (!r) return null;
                    return (
                      <span key={id} className="chip">
                        <span
                          className="role-dot"
                          style={{ background: r.color ?? 'var(--text-muted)' }}
                          aria-hidden="true"
                        />
                        {r.name}
                      </span>
                    );
                  })}
                </div>
                <div className="admin-row-actions">
                  {canRoles && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setExpanded(open ? null : m.user.id)}
                    >
                      Cargos
                    </Button>
                  )}
                  {canKick && !isOwner && m.user.id !== myId && (
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label={`Expulsar ${name}`}
                      data-tip="Expulsar"
                      onClick={() => void kick(m)}
                    >
                      <Icon name="user-minus" size={18} />
                    </button>
                  )}
                </div>
              </div>
              {canRoles && open && (
                <fieldset id={panelId} className="role-checks">
                  <legend className="sr-only">Cargos de {name}</legend>
                  {roles.length === 0 && <p className="muted small">Nenhum cargo criado.</p>}
                  {roles.map((r) => (
                    <Checkbox
                      key={r.id}
                      label={
                        <span className="role-check-label">
                          <span
                            className="role-dot"
                            style={{ background: r.color ?? 'var(--text-muted)' }}
                            aria-hidden="true"
                          />
                          {r.name}
                        </span>
                      }
                      checked={m.roleIds.includes(r.id)}
                      onChange={(v) => void setRoles(m, v ? [...m.roleIds, r.id] : m.roleIds.filter((x) => x !== r.id))}
                    />
                  ))}
                </fieldset>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

function ChannelsTab({ detail }: { detail: ServerDetail }) {
  const [catName, setCatName] = useState('');
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const cats = [...detail.categories].sort((a, b) => a.position - b.position);
    const byPos = (a: Channel, b: Channel) => a.position - b.position;
    const out: { id: string; name: string; channels: Channel[] }[] = [
      { id: 'none', name: 'Sem categoria', channels: detail.channels.filter((c) => !c.categoryId).sort(byPos) },
    ];
    for (const c of cats)
      out.push({
        id: c.id,
        name: c.name,
        channels: detail.channels.filter((ch) => ch.categoryId === c.id).sort(byPos),
      });
    return out.filter((g) => g.id !== 'none' || g.channels.length > 0);
  }, [detail.categories, detail.channels]);

  const createCategory = async (e: FormEvent) => {
    e.preventDefault();
    const n = catName.trim();
    if (!n) return;
    setBusy(true);
    try {
      const c = await api().request<Category>('POST', `/servers/${detail.id}/categories`, { name: n });
      useData.getState().upsertCategory(c);
      setCatName('');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Nova categoria">
        <form className="inline-form" onSubmit={(e) => void createCategory(e)}>
          <TextField
            aria-label="Nome da categoria"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="Nome da categoria"
            maxLength={64}
          />
          <Button type="submit" size="sm" disabled={busy || !catName.trim()}>
            Criar categoria
          </Button>
        </form>
      </Section>
      {groups.map((g) => (
        <Section key={g.id} title={g.name}>
          {g.channels.length === 0 ? (
            <p className="muted small">Nenhum canal.</p>
          ) : (
            <ul className="admin-list">
              {g.channels.map((c) => (
                <ChannelRow key={c.id} channel={c} />
              ))}
            </ul>
          )}
        </Section>
      ))}
    </>
  );
}

function ChannelRow({ channel }: { channel: Channel }) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== channel.name || (channel.kind === 'text' && topic !== (channel.topic ?? ''));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body = channel.kind === 'text' ? { name: name.trim(), topic: topic.trim() || null } : { name: name.trim() };
      const c = await api().request<Channel>('PATCH', `/channels/${channel.id}`, body);
      useData.getState().upsertChannel({ ...c, myPermissions: channel.myPermissions });
      setName(c.name);
      setTopic(c.topic ?? '');
      useUi.getState().toast('success', 'Canal atualizado.');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Excluir o canal “${channel.name}”? As mensagens serão perdidas.`)) return;
    setBusy(true);
    try {
      await api().request('DELETE', `/channels/${channel.id}`);
      useData.getState().removeChannel(channel.serverId, channel.id);
    } catch (err) {
      toastError(err);
      setBusy(false);
    }
  };

  return (
    <li className="admin-row">
      <form className="channel-form" onSubmit={(e) => void save(e)}>
        <Icon
          name={channel.kind === 'text' ? 'hashtag' : 'speaker'}
          size={18}
          label={channel.kind === 'text' ? 'Canal de texto' : 'Canal de voz'}
        />
        <TextField
          aria-label="Nome do canal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={64}
        />
        {channel.kind === 'text' && (
          <TextField
            aria-label={`Tópico de ${channel.name}`}
            fieldClassName="channel-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Tópico"
            maxLength={1024}
          />
        )}
        <Button type="submit" size="sm" disabled={busy || !dirty || !name.trim()}>
          Salvar
        </Button>
        <button
          type="button"
          className="icon-btn danger"
          aria-label={`Excluir canal ${channel.name}`}
          data-tip="Excluir"
          disabled={busy}
          onClick={() => void remove()}
        >
          <Icon name="trash" size={18} />
        </button>
      </form>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Registro de auditoria
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  'server.create': 'Criou o servidor',
  'server.update': 'Atualizou o servidor',
  'category.create': 'Criou categoria',
  'category.delete': 'Excluiu categoria',
  'channel.create': 'Criou canal',
  'channel.update': 'Atualizou canal',
  'channel.delete': 'Excluiu canal',
  'member.kick': 'Expulsou membro',
  'member.leave': 'Saiu do servidor',
  'member.roles': 'Alterou cargos de membro',
  'role.create': 'Criou cargo',
  'role.update': 'Atualizou cargo',
  'role.delete': 'Excluiu cargo',
};

function AuditTab({ detail }: { detail: ServerDetail }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api()
      .request<AuditEntry[]>('GET', `/servers/${detail.id}/audit-log`)
      .then((list) => !cancelled && setEntries(list))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of detail.members) m.set(x.user.id, x.nickname ?? x.user.displayName);
    for (const r of detail.roles) m.set(r.id, r.isEveryone ? '@everyone' : `@${r.name}`);
    for (const c of detail.channels) m.set(c.id, `#${c.name}`);
    for (const c of detail.categories) m.set(c.id, c.name);
    if (!m.has(detail.id)) m.set(detail.id, detail.name);
    return m;
  }, [detail]);

  if (error) return <p className="form-error">{error}</p>;
  if (!entries) return <p className="muted">Carregando…</p>;
  if (entries.length === 0) return <p className="muted">Nenhuma ação registrada.</p>;

  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th scope="col">Data</th>
          <th scope="col">Autor</th>
          <th scope="col">Ação</th>
          <th scope="col">Alvo</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td className="nowrap">{fmtDate(e.createdAt)}</td>
            <td>{names.get(e.actorId) ?? 'Usuário removido'}</td>
            <td>{ACTION_LABELS[e.action] ?? e.action}</td>
            <td className="muted">
              {e.targetId ? (names.get(e.targetId) ?? <code className="small">{e.targetId.slice(0, 8)}</code>) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
