import type { AdminAuditEntry, AdminAuditPage } from '@opencord/contracts';
import { Avatar, Button, TextField } from '@opencord/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Chips, Empty, Loading, MB, Pill, ago, fmtDateTime, nf, toastError } from './adminKit';
import { api } from '../../store/session';
import { Tooltip } from '../../components/Tooltip';

const ACTION_LABELS: Record<string, string> = {
  'admin.user.suspend': 'Suspendeu conta',
  'admin.user.unsuspend': 'Reativou conta',
  'admin.user.logout': 'Encerrou sessões',
  'admin.user.promote': 'Tornou super admin',
  'admin.user.demote': 'Tirou super admin',
  'admin.instance.update': 'Mudou a instância',
  'admin.changelog.hide': 'Apagou uma novidade',
  'server.verified': 'Selo de verificado',
  'member.join': 'Entrou no servidor',
  'member.kick': 'Expulsou membro',
  'member.leave': 'Saiu do servidor',
  'server.create': 'Criou servidor',
  'server.update': 'Atualizou servidor',
  'channel.create': 'Criou canal',
  'channel.update': 'Atualizou canal',
  'channel.reorder': 'Reordenou canais',
  'channel.delete': 'Excluiu canal',
  'role.create': 'Criou cargo',
  'role.update': 'Atualizou cargo',
  'role.delete': 'Excluiu cargo',
  'member.roles': 'Alterou cargos',
  'ai.held': 'IA reteve envio',
  'ai.blocked': 'IA bloqueou envio',
  'ai.approved': 'Aprovou envio retido',
  'ai.rejected': 'Reprovou envio retido',
};
export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

/** Detalhe curto da ação (motivo da suspensão, o que mudou na instância, selo, entrada como admin). */
export function detailOf(e: AdminAuditEntry): string {
  const m = e.metadata;
  if (e.action === 'admin.user.suspend' && typeof m.reason === 'string') return `Motivo: ${m.reason}`;
  if (e.action === 'server.verified') return m.verified ? 'marcou' : 'tirou';
  if (e.action === 'member.join' && m.via === 'instance-admin') return 'como super admin';
  if (e.action === 'admin.changelog.hide' && typeof m.key === 'string') return m.key;
  if (e.action === 'admin.instance.update') {
    const parts: string[] = [];
    if ('registrationOpen' in m) parts.push(m.registrationOpen ? 'abriu cadastros' : 'fechou cadastros');
    if ('announcement' in m) parts.push(m.announcement ? 'publicou aviso' : 'removeu aviso');
    if ('uploadMaxBytes' in m)
      parts.push(
        typeof m.uploadMaxBytes === 'number' ? `upload ${Math.round(m.uploadMaxBytes / MB)} MB` : 'upload padrão',
      );
    return parts.join(', ');
  }
  return '';
}

/** tom da etiqueta da ação: vermelho para punições, amarelo para IA, marca para admin */
const toneOf = (action: string) =>
  /suspend|kick|blocked|delete|rejected|demote/.test(action)
    ? ('danger' as const)
    : action.startsWith('ai.')
      ? ('warning' as const)
      : action.startsWith('admin.')
        ? ('brand' as const)
        : ('neutral' as const);

type Scope = 'admin' | 'all';

export function AdminAuditTab() {
  const [scope, setScope] = useState<Scope>('admin');
  const [page, setPage] = useState<AdminAuditPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const fetchPage = useCallback(
    (before?: string) =>
      api().request<AdminAuditPage>(
        'GET',
        `/admin/audit?${new URLSearchParams({ scope, ...(before ? { before } : {}) }).toString()}`,
      ),
    [scope],
  );
  useEffect(() => {
    setPage(null);
    void fetchPage().then(setPage, toastError);
  }, [fetchPage]);
  const more = async () => {
    if (!page?.nextBefore) return;
    setLoadingMore(true);
    try {
      const r = await fetchPage(page.nextBefore);
      setPage((p) => (p ? { entries: [...p.entries, ...r.entries], nextBefore: r.nextBefore } : r));
    } catch (e) {
      toastError(e);
    } finally {
      setLoadingMore(false);
    }
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = page?.entries ?? [];
    if (!term) return all;
    return all.filter((e) =>
      [e.actor.displayName, actionLabel(e.action), e.targetName ?? '', e.server?.name ?? '', detailOf(e)]
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }, [page, q]);

  return (
    <div className="adm-stack">
      <div className="adm-toolbar">
        <Chips<Scope>
          label="Quais ações"
          value={scope}
          onChange={setScope}
          options={[
            { id: 'admin', label: 'Super admins' },
            { id: 'all', label: 'Tudo (todos os servidores)' },
          ]}
        />
        <TextField
          fieldClassName="adm-search"
          aria-label="Filtrar ações carregadas"
          leadingIcon="search"
          placeholder="Filtrar por pessoa, ação, alvo ou servidor"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Card
        flush
        title="Registro"
        sub={page ? `${nf(shown.length)} de ${nf(page.entries.length)} carregadas` : undefined}
      >
        {!page ? (
          <div className="adm-pad">
            <Loading rows={6} />
          </div>
        ) : shown.length === 0 ? (
          <Empty icon="clock">{q ? 'Nada com esse filtro.' : 'Nenhuma ação registrada.'}</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Quem</th>
                  <th scope="col">Ação</th>
                  <th scope="col" className="adm-hide-md">
                    Alvo
                  </th>
                  <th scope="col" className="adm-hide-sm">
                    Onde
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const detail = detailOf(e);
                  return (
                    <tr key={e.id}>
                      <td className="adm-nowrap">
                        <Tooltip label={fmtDateTime(e.createdAt)}>
                          <time dateTime={e.createdAt} tabIndex={0}>
                            {ago(e.createdAt)}
                          </time>
                        </Tooltip>
                      </td>
                      <td>
                        <span className="adm-who">
                          <Avatar id={e.actor.id} name={e.actor.displayName} size={24} />
                          <span className="truncate">{e.actor.displayName}</span>
                        </span>
                      </td>
                      <td className="adm-wrap">
                        <Pill tone={toneOf(e.action)}>{actionLabel(e.action)}</Pill>
                        {detail && <span className="muted small"> {detail}</span>}
                      </td>
                      <td className="adm-hide-md muted">
                        {e.targetName ?? (e.targetId ? e.targetId.slice(0, 8) : '—')}
                      </td>
                      <td className="adm-hide-sm muted">{e.server?.name ?? 'Instância'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {page?.nextBefore && (
        <div className="adm-more-row">
          <Button variant="secondary" size="sm" disabled={loadingMore} onClick={() => void more()}>
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}
