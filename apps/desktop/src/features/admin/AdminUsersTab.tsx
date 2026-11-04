import type { AdminStats, AdminUser, AdminUserPage } from '@opencord/contracts';
import { Avatar, Button, Icon, TextField } from '@opencord/ui';
import { useCallback, useEffect, useState } from 'react';
import { askConfirm, askText } from '../../components/AskDialog';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { UserBadges } from '../../components/UserBadges';
import { useData } from '../../store/data';
import { api } from '../../store/session';
import { useUi } from '../../store/ui';
import { UserBadgesDialog } from './AdminBadgesTab';
import {
  Card,
  Chips,
  Empty,
  Kpi,
  KpiGrid,
  Loading,
  MoreButton,
  Pill,
  ago,
  fmtDate,
  fmtDateTime,
  nf,
  toastError,
} from './adminKit';

/** Usuários do painel admin: KPIs, busca, filtros e tabela com ações (menu na linha, botão direito ou "⋯"). */
type UserFilter = 'all' | 'admins' | 'suspended';

export function AdminUsersTab({ stats }: { stats: AdminStats | null }) {
  const meId = useData((s) => s.me?.id);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [page, setPage] = useState<AdminUserPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [badgesFor, setBadgesFor] = useState<AdminUser | null>(null);

  const fetchPage = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ filter });
      if (q.trim()) p.set('q', q.trim());
      if (cursor) p.set('cursor', cursor);
      return api().request<AdminUserPage>('GET', `/admin/users?${p.toString()}`);
    },
    [q, filter],
  );

  // busca com um pequeno atraso enquanto digita
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      fetchPage().then((r) => !cancelled && setPage(r), toastError);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fetchPage]);

  const more = async () => {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await fetchPage(page.nextCursor);
      setPage((p) => (p ? { users: [...p.users, ...r.users], nextCursor: r.nextCursor } : r));
    } catch (e) {
      toastError(e);
    } finally {
      setLoadingMore(false);
    }
  };

  const replace = (u: AdminUser) =>
    setPage((p) => (p ? { ...p, users: p.users.map((x) => (x.id === u.id ? u : x)) } : p));

  const act = async (u: AdminUser, path: string, method: 'POST' | 'PUT', body: unknown, ok: string) => {
    try {
      replace(await api().request<AdminUser>(method, `/admin/users/${u.id}/${path}`, body));
      useUi.getState().toast('success', ok);
    } catch (e) {
      toastError(e);
    }
  };

  const menu = (u: AdminUser): MenuEntry[] => {
    const locked = u.id === meId || u.isCreator;
    const items: MenuEntry[] = [
      {
        label: 'Ver perfil',
        icon: 'user',
        onSelect: () => useUi.getState().openModal({ kind: 'profile', userId: u.id }),
      },
      {
        label: 'Copiar ID',
        icon: 'copy',
        onSelect: () => void navigator.clipboard.writeText(u.id),
      },
      {
        label: 'Insígnias…',
        icon: 'star',
        hint: u.badges?.length ? String(u.badges.length) : undefined,
        onSelect: () => setBadgesFor(u),
      },
    ];
    if (locked) return items;
    items.push(
      'separator',
      {
        label: 'Encerrar todas as sessões',
        icon: 'logout',
        hint: u.activeSessions ? `${u.activeSessions} ativa(s)` : undefined,
        onSelect: async () => {
          if (
            !(await askConfirm('O app da pessoa volta para o login.', {
              title: `Encerrar as sessões de ${u.displayName}`,
              confirmLabel: 'Encerrar',
              danger: true,
            }))
          )
            return;
          void act(u, 'logout', 'POST', undefined, 'Sessões encerradas.');
        },
      },
      {
        label: u.verified ? 'Tirar selo de verificado' : 'Dar selo de verificado',
        icon: 'verified',
        onSelect: () =>
          void act(
            u,
            'verified',
            'PUT',
            { verified: !u.verified },
            u.verified ? 'Selo retirado.' : 'Perfil verificado.',
          ),
      },
      {
        label: u.isInstanceAdmin ? 'Tirar super admin' : 'Tornar super admin',
        icon: 'shield',
        disabled: !u.isInstanceAdmin && Boolean(u.disabledAt),
        onSelect: async () => {
          const q = u.isInstanceAdmin
            ? `Tirar o super admin de ${u.displayName}?`
            : `Tornar ${u.displayName} super admin? A pessoa poderá entrar em qualquer servidor, suspender contas e mudar a configuração da instância.`;
          if (
            !(await askConfirm(q, {
              title: 'Super admin',
              confirmLabel: u.isInstanceAdmin ? 'Tirar' : 'Tornar super admin',
              danger: true,
            }))
          )
            return;
          void act(
            u,
            'admin',
            'PUT',
            { admin: !u.isInstanceAdmin },
            u.isInstanceAdmin ? 'Super admin removido.' : 'Agora é super admin.',
          );
        },
      },
    );
    if (u.disabledAt)
      items.push({
        label: 'Reativar conta',
        icon: 'check',
        onSelect: () => void act(u, 'unsuspend', 'POST', undefined, 'Conta reativada.'),
      });
    else
      items.push({
        label: 'Suspender conta',
        icon: 'block',
        danger: true,
        disabled: u.isInstanceAdmin,
        hint: u.isInstanceAdmin ? 'Tire o admin antes' : undefined,
        onSelect: async () => {
          const reason = await askText(
            'A pessoa sai de todas as sessões e chamadas e não entra mais até ser reativada.',
            {
              title: `Suspender ${u.displayName}`,
              label: 'Motivo (opcional, fica na auditoria)',
              confirmLabel: 'Suspender',
              danger: true,
            },
          );
          if (reason === null) return;
          void act(u, 'suspend', 'POST', { reason: reason.trim() || undefined }, 'Conta suspensa.');
        },
      });
    return items;
  };

  const openMenu = (e: React.MouseEvent, u: AdminUser) => openContextMenu(e, menu(u), `Ações para ${u.displayName}`);

  return (
    <div className="adm-stack">
      {stats && (
        <KpiGrid label="Números de usuários">
          <Kpi icon="users" label="Contas" value={stats.users} hint={`+${nf(stats.newUsers7d)} em 7 dias`} />
          <Kpi icon="signal" label="Online agora" value={stats.onlineNow} live tone="success" />
          <Kpi
            icon="shield"
            label="Super admins"
            value={stats.admins}
            tone="neutral"
            onClick={() => setFilter('admins')}
          />
          <Kpi
            icon="block"
            label="Suspensas"
            value={stats.suspended}
            tone={stats.suspended ? 'danger' : 'neutral'}
            onClick={() => setFilter('suspended')}
          />
        </KpiGrid>
      )}
      <div className="adm-toolbar">
        <TextField
          aria-label="Buscar usuário"
          leadingIcon="search"
          placeholder="Buscar por apelido, usuário ou e-mail"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          fieldClassName="adm-search"
        />
        <Chips<UserFilter>
          label="Filtrar usuários"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'Todos', n: stats?.users },
            { id: 'admins', label: 'Super admins', n: stats?.admins },
            { id: 'suspended', label: 'Suspensos', n: stats?.suspended },
          ]}
        />
      </div>
      <Card
        flush
        title="Pessoas"
        sub={page ? `${nf(page.users.length)} carregada(s)${page.nextCursor ? ' · há mais' : ''}` : undefined}
      >
        {!page ? (
          <div className="adm-pad">
            <Loading rows={6} />
          </div>
        ) : page.users.length === 0 ? (
          <Empty icon="users">Ninguém encontrado.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Pessoa</th>
                  <th scope="col" className="adm-hide-md">
                    Contato
                  </th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="adm-num-col adm-hide-sm">
                    Servidores
                  </th>
                  <th scope="col" className="adm-num-col adm-hide-md">
                    Sessões
                  </th>
                  <th scope="col" className="adm-hide-sm">
                    Visto
                  </th>
                  <th scope="col" className="adm-hide-lg">
                    Cadastro
                  </th>
                  <th scope="col">
                    <span className="oc-visually-hidden">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.users.map((u) => (
                  <tr key={u.id} data-dim={u.disabledAt ? true : undefined} onContextMenu={(e) => openMenu(e, u)}>
                    <th scope="row">
                      <span className="adm-person">
                        <Avatar id={u.id} name={u.displayName} size={32} status={u.online ? 'online' : 'offline'} />
                        <span className="adm-person-names">
                          <span className="adm-person-name">
                            <strong className="truncate">{u.displayName}</strong>
                            {(u.isCreator || u.verified) && (
                              <Icon
                                name="verified"
                                size={14}
                                active
                                label={u.isCreator ? 'Criador do OpenCord' : 'Verificado'}
                              />
                            )}
                            <UserBadges userId={u.id} fallback={u.badges} />
                          </span>
                          <span className="muted small truncate">@{u.username}</span>
                        </span>
                      </span>
                    </th>
                    <td className="adm-hide-md muted adm-ellipsis">{u.email ?? (u.hasAccount ? '—' : 'só apelido')}</td>
                    <td>
                      <span className="adm-pills">
                        {u.isCreator && <Pill tone="brand">criador</Pill>}
                        {u.isInstanceAdmin && !u.isCreator && <Pill tone="brand">super admin</Pill>}
                        {u.disabledAt ? (
                          <Pill tone="danger">suspenso</Pill>
                        ) : u.online ? (
                          <Pill tone="success">online</Pill>
                        ) : (
                          <Pill>offline</Pill>
                        )}
                      </span>
                    </td>
                    <td className="adm-num-col adm-hide-sm">
                      <span className="adm-num">{nf(u.serverCount)}</span>
                    </td>
                    <td className="adm-num-col adm-hide-md">
                      <span className="adm-num">{nf(u.activeSessions)}</span>
                    </td>
                    <td className="adm-hide-sm adm-nowrap">
                      {u.lastSeenAt ? (
                        <Tooltip label={fmtDateTime(u.lastSeenAt)}>
                          <time dateTime={u.lastSeenAt} tabIndex={0}>
                            {ago(u.lastSeenAt)}
                          </time>
                        </Tooltip>
                      ) : (
                        <span className="muted">nunca</span>
                      )}
                    </td>
                    <td className="adm-hide-lg muted adm-nowrap">{fmtDate(u.createdAt)}</td>
                    <td className="adm-row-actions">
                      <MoreButton label={`Ações para ${u.displayName}`} onClick={(e) => openMenu(e, u)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {page?.nextCursor && (
        <div className="adm-more-row">
          <Button variant="secondary" size="sm" disabled={loadingMore} onClick={() => void more()}>
            Carregar mais
          </Button>
        </div>
      )}
      {badgesFor && <UserBadgesDialog user={badgesFor} onClose={() => setBadgesFor(null)} onSaved={replace} />}
    </div>
  );
}
