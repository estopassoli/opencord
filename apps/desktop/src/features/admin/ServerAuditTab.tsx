import { type AuditEntry, type ServerDetail } from '@opencord/contracts';
import { Button, Select } from '@opencord/ui';
import { useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../../store/session';
import { toastError } from './serverSettingsKit';

// ---------------------------------------------------------------------------
// Registro de auditoria
// ---------------------------------------------------------------------------

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const ACTION_LABELS: Record<string, string> = {
  'server.create': 'Criou o servidor',
  'server.update': 'Atualizou o servidor',
  'category.create': 'Criou categoria',
  'category.delete': 'Excluiu categoria',
  'channel.create': 'Criou canal',
  'channel.update': 'Atualizou canal',
  'channel.reorder': 'Reordenou canais',
  'channel.delete': 'Excluiu canal',
  'member.kick': 'Expulsou membro',
  'member.ban': 'Baniu membro',
  'member.unban': 'Desbaniu membro',
  'member.timeout': 'Castigou membro',
  'ai.held': 'IA reteve envio para revisão',
  'ai.blocked': 'IA bloqueou envio',
  'ai.approved': 'Aprovou envio retido',
  'ai.rejected': 'Reprovou envio retido',
  'member.leave': 'Saiu do servidor',
  'member.roles': 'Alterou cargos de membro',
  'role.create': 'Criou cargo',
  'role.update': 'Atualizou cargo',
  'role.delete': 'Excluiu cargo',
  'member.join': 'Entrou no servidor',
  'invite.create': 'Criou convite',
  'invite.delete': 'Apagou convite',
  'bot.add': 'Adicionou bot',
  'bot.remove': 'Removeu bot',
  'message.bulk_delete': 'Apagou mensagens em massa',
  'sound.create': 'Enviou efeito sonoro',
  'sound.delete': 'Excluiu efeito sonoro',
  'recording.start': 'Começou gravação',
  'recording.ready': 'Gravação pronta',
  'recording.delete': 'Excluiu gravação',
  'server.import': 'Importou modelo',
  'server.transfer': 'Transferiu o servidor',
  'ai.autoblock': 'IA bloqueou automaticamente',
};

/** tipos para o filtro da auditoria (o prefixo da ação, ex.: `role` pega criar/atualizar/excluir cargo) */
const AUDIT_KINDS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas as ações' },
  { value: 'server', label: 'Servidor' },
  { value: 'channel', label: 'Canais' },
  { value: 'category', label: 'Categorias' },
  { value: 'role', label: 'Cargos' },
  { value: 'member', label: 'Membros' },
  { value: 'invite', label: 'Convites' },
  { value: 'message', label: 'Mensagens' },
  { value: 'bot', label: 'Bots' },
  { value: 'sound', label: 'Efeitos sonoros' },
  { value: 'recording', label: 'Gravações' },
  { value: 'ai', label: 'Moderação por IA' },
];
const AUDIT_PAGE = 100;

export function AuditTab({ detail }: { detail: ServerDetail }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actor, setActor] = useState('all');
  const [kind, setKind] = useState('all');
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPage = (before?: string) => {
    const q = new URLSearchParams({ limit: String(AUDIT_PAGE) });
    if (actor !== 'all') q.set('actorId', actor);
    if (kind !== 'all') q.set('action', kind);
    if (before) q.set('before', before);
    return api().request<AuditEntry[]>('GET', `/servers/${detail.id}/audit-log?${q.toString()}`);
  };

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    fetchPage()
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setMore(list.length === AUDIT_PAGE);
      })
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [detail.id, actor, kind]);

  const loadMore = async () => {
    const last = entries?.at(-1);
    if (!last) return;
    setLoading(true);
    try {
      const list = await fetchPage(last.createdAt);
      setEntries((cur) => [...(cur ?? []), ...list]);
      setMore(list.length === AUDIT_PAGE);
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  };

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of detail.members) m.set(x.user.id, x.nickname ?? x.user.displayName);
    for (const r of detail.roles) m.set(r.id, r.isEveryone ? '@everyone' : `@${r.name}`);
    for (const c of detail.channels) m.set(c.id, `#${c.name}`);
    for (const c of detail.categories) m.set(c.id, c.name);
    if (!m.has(detail.id)) m.set(detail.id, detail.name);
    return m;
  }, [detail]);

  const people = [...detail.members].sort((a, b) =>
    (a.nickname ?? a.user.displayName).localeCompare(b.nickname ?? b.user.displayName, 'pt-BR'),
  );
  const filters = (
    <div className="admin-filters">
      <Select<string>
        label="Autor"
        value={actor}
        onChange={setActor}
        options={[
          { value: 'all', label: 'Todas as pessoas' },
          ...people.map((m) => ({ value: m.user.id, label: m.nickname ?? m.user.displayName })),
        ]}
      />
      <Select<string> label="Tipo de ação" value={kind} onChange={setKind} options={AUDIT_KINDS} />
    </div>
  );

  if (error)
    return (
      <>
        {filters}
        <p className="form-error">{error}</p>
      </>
    );
  if (!entries)
    return (
      <>
        {filters}
        <p className="muted">Carregando…</p>
      </>
    );
  if (entries.length === 0)
    return (
      <>
        {filters}
        <p className="muted">
          {actor === 'all' && kind === 'all' ? 'Nenhuma ação registrada.' : 'Nenhuma ação com esses filtros.'}
        </p>
      </>
    );

  return (
    <>
      {filters}
      <div className="admin-table-wrap">
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
                  {e.targetId
                    ? (names.get(e.targetId) ?? <code className="small">{e.targetId.slice(0, 8)}</code>)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && (
        <div className="admin-pager">
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => void loadMore()}>
            {loading ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </>
  );
}
