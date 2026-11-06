import { askConfirm } from '../../components/AskDialog';
import { hasPermission, Permission, type Member, type MemberJoin, type ServerDetail } from '@opencord/contracts';
import { Avatar, Button, Checkbox, Icon, Select, TextField } from '@opencord/ui';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useData } from '../../store/data';
import { api } from '../../store/session';
import { sortRoles, toastError } from './serverSettingsKit';

// ---------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR', { dateStyle: 'medium' });
};

type MemberSort = 'name' | 'newest' | 'oldest';
const MEMBERS_PAGE = 50;

/** Membros em tabela (ADR-0050): busca, filtro por cargo, ordem, desde quando é membro e por qual convite entrou. */
export function MembersTab({ detail, myId }: { detail: ServerDetail; myId: string }) {
  const canRoles = hasPermission(detail.myPermissions, Permission.MANAGE_ROLES);
  const canKick = hasPermission(detail.myPermissions, Permission.KICK_MEMBERS);
  const canManage = hasPermission(detail.myPermissions, Permission.MANAGE_SERVER);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sort, setSort] = useState<MemberSort>('name');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [joins, setJoins] = useState<Map<string, MemberJoin> | null>(null);
  const roles = useMemo(() => sortRoles(detail.roles).filter((r) => !r.isEveryone), [detail.roles]);
  const roleById = useMemo(() => new Map(detail.roles.map((r) => [r.id, r])), [detail.roles]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of detail.members) m.set(x.user.id, x.nickname ?? x.user.displayName);
    return m;
  }, [detail.members]);

  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    api()
      .request<MemberJoin[]>('GET', `/servers/${detail.id}/members/joins`)
      .then(
        (list) => alive && setJoins(new Map(list.map((j) => [j.userId, j]))),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [canManage, detail.id, detail.members.length]);

  const q = query.trim().toLowerCase();
  const members = useMemo(() => {
    const list = detail.members.filter(
      (m) =>
        (roleFilter === 'all' || m.roleIds.includes(roleFilter)) &&
        (!q ||
          m.user.displayName.toLowerCase().includes(q) ||
          m.user.username.toLowerCase().includes(q) ||
          (m.nickname ?? '').toLowerCase().includes(q)),
    );
    const name = (m: Member) => m.nickname ?? m.user.displayName;
    return list.sort((a, b) =>
      sort === 'name'
        ? name(a).localeCompare(name(b), 'pt-BR')
        : (sort === 'newest' ? -1 : 1) * (Date.parse(a.joinedAt) - Date.parse(b.joinedAt)),
    );
  }, [detail.members, roleFilter, q, sort]);
  const pages = Math.max(1, Math.ceil(members.length / MEMBERS_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = members.slice(current * MEMBERS_PAGE, (current + 1) * MEMBERS_PAGE);

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
    if (
      !(await askConfirm(`${m.nickname ?? m.user.displayName} sai do servidor (pode voltar com um convite).`, {
        title: 'Expulsar do servidor',
        confirmLabel: 'Expulsar',
        danger: true,
      }))
    )
      return;
    try {
      await api().request('DELETE', `/servers/${detail.id}/members/${m.user.id}`);
      useData.getState().removeMember(detail.id, m.user.id);
    } catch (err) {
      toastError(err);
    }
  };

  const cols = canManage ? 5 : 4;
  return (
    <>
      <div className="admin-filters">
        <TextField
          aria-label="Buscar membros"
          type="search"
          leadingIcon="search"
          value={query}
          fieldClassName="admin-filter-grow"
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder={`Buscar entre ${detail.members.length} membros`}
        />
        <Select<string>
          label="Cargo"
          value={roleFilter}
          onChange={(v) => {
            setRoleFilter(v);
            setPage(0);
          }}
          options={[{ value: 'all', label: 'Todos os cargos' }, ...roles.map((r) => ({ value: r.id, label: r.name }))]}
        />
        <Select<MemberSort>
          label="Ordem"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'Nome' },
            { value: 'newest', label: 'Entrou há menos tempo' },
            { value: 'oldest', label: 'Entrou há mais tempo' },
          ]}
        />
      </div>
      <p className="muted small" aria-live="polite">
        {members.length === detail.members.length
          ? `${members.length} ${members.length === 1 ? 'membro' : 'membros'}`
          : `${members.length} de ${detail.members.length} membros`}
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table members-table">
          <thead>
            <tr>
              <th scope="col">Nome</th>
              <th scope="col">Membro desde</th>
              {canManage && <th scope="col">Entrou por</th>}
              <th scope="col">Cargos</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const name = m.nickname ?? m.user.displayName;
              const isOwner = m.user.id === detail.ownerId;
              const isAdmin = Boolean(m.user.isInstanceAdmin);
              const editable = canRoles && (m.user.id === myId || (!isOwner && !isAdmin));
              const open = expanded === m.user.id && editable;
              const panelId = `member-roles-${m.user.id}`;
              const join = joins?.get(m.user.id);
              return (
                <Fragment key={m.user.id}>
                  <tr>
                    <td>
                      <span className="admin-cell-user">
                        <Avatar id={m.user.id} name={m.user.displayName} size={28} />
                        <span className="admin-cell-names">
                          <span className="truncate">
                            {name}
                            {isOwner && <span className="muted small"> · dono</span>}
                            {isAdmin && <span className="muted small"> · super admin</span>}
                          </span>
                          <span className="muted small truncate">@{m.user.username}</span>
                        </span>
                      </span>
                    </td>
                    <td className="nowrap">{fmtDay(m.joinedAt)}</td>
                    {canManage && (
                      <td className="nowrap">
                        {join?.inviteCode ? (
                          <span className="admin-cell-names">
                            <code className="small">{join.inviteCode}</code>
                            {join.inviterId && (
                              <span className="muted small">de {nameOf.get(join.inviterId) ?? 'ex-membro'}</span>
                            )}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                    <td>
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
                    </td>
                    <td className="cell-actions nowrap">
                      {editable && (
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
                      {canKick && !isOwner && !isAdmin && m.user.id !== myId && (
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
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={cols}>
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
                              onChange={(v) =>
                                void setRoles(m, v ? [...m.roleIds, r.id] : m.roleIds.filter((x) => x !== r.id))
                              }
                            />
                          ))}
                        </fieldset>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="muted">Ninguém encontrado.</p>}
      {pages > 1 && (
        <nav className="admin-pager" aria-label="Páginas de membros">
          <Button size="sm" variant="ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Anterior
          </Button>
          <span className="muted small">
            Página {current + 1} de {pages}
          </span>
          <Button size="sm" variant="ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Próxima
          </Button>
        </nav>
      )}
    </>
  );
}
