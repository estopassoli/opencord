import { askConfirm } from '../../components/AskDialog';
import { hasPermission, Permission, type PermissionName, type Role, type ServerDetail } from '@opencord/contracts';
import { Button, Checkbox, ColorSwatches, Icon, TextField } from '@opencord/ui';
import { useMemo, useState, type FormEvent } from 'react';
import { useData } from '../../store/data';
import { api } from '../../store/session';
import { useUi } from '../../store/ui';
import { sortRoles, toastError } from './serverSettingsKit';

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

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
  BAN_MEMBERS: 'Banir membros',
  MODERATE_MEMBERS: 'Castigar membros',
  ADMINISTRATOR: 'Administrador (todas as permissões)',
};

const PERMISSION_KEYS = Object.keys(Permission) as PermissionName[];

export function RolesTab({ detail }: { detail: ServerDetail }) {
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
    if (
      !(await askConfirm(`O cargo “${role.name}” será excluído.`, {
        title: 'Excluir cargo',
        confirmLabel: 'Excluir',
        danger: true,
      }))
    )
      return;
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
