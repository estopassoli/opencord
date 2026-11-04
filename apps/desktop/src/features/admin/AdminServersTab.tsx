import type { AdminServerEntry, ServerDetail } from '@opencord/contracts';
import { Button, Icon, Select, TextField, type IconName } from '@opencord/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { ServerIcon } from '../../components/ServerIcon';
import { Tooltip } from '../../components/Tooltip';
import { api, describeError, loadServer } from '../../store/session';
import { useUi } from '../../store/ui';

/**
 * Painel do super admin → Servidores (ADR-0013/0020) em formato de dashboard: números da instância somados,
 * atividade dos últimos 14 dias, ranking e tabela densa com filtros e ordenação. Entrar (visível/invisível)
 * e o selo de verificado continuam auditados como antes.
 */

const DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));
const nf = (n: number) => n.toLocaleString('pt-BR');

type Filter = 'all' | 'active' | 'idle' | 'verified' | 'joined' | 'hidden';
type Sort = 'activity' | 'members' | 'online' | 'recent' | 'created' | 'name';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'activity', label: 'Mais mensagens' },
  { value: 'members', label: 'Mais membros' },
  { value: 'online', label: 'Mais gente agora' },
  { value: 'recent', label: 'Atividade mais recente' },
  { value: 'created', label: 'Criados por último' },
  { value: 'name', label: 'Nome (A–Z)' },
];

/** série de 14 dias sempre com 14 posições (API antiga não manda) */
const series = (s: AdminServerEntry) => {
  const d = s.messagesDaily ?? [];
  return d.length === DAYS ? d : [...new Array<number>(Math.max(0, DAYS - d.length)).fill(0), ...d].slice(-DAYS);
};
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const last7 = (s: AdminServerEntry) => sum(series(s).slice(-7));
const prev7 = (s: AdminServerEntry) => sum(series(s).slice(0, 7));
const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0);

function ago(iso: string | null | undefined): string {
  const t = ts(iso);
  if (!t) return 'nunca';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} d`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `há ${mo} mês${mo > 1 ? 'es' : ''}` : `há ${Math.round(mo / 12)} ano(s)`;
}

const fmtDay = (offsetFromToday: number) =>
  new Date(Date.now() - offsetFromToday * DAY_MS).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtDate = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** variação em % entre duas janelas; null quando não há base de comparação */
const delta = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export function AdminServersTab({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<AdminServerEntry[] | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('activity');

  const load = useCallback(() => {
    setLoading(true);
    api()
      .request<AdminServerEntry[]>('GET', '/admin/servers')
      .then((l) => {
        setList(l);
        setLoadedAt(new Date());
      }, toastError)
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const totals = useMemo(() => {
    const l = list ?? [];
    const daily = new Array<number>(DAYS).fill(0);
    for (const s of l) series(s).forEach((n, i) => (daily[i] = (daily[i] ?? 0) + n));
    const monthAgo = Date.now() - 30 * DAY_MS;
    return {
      servers: l.length,
      created30d: l.filter((s) => ts(s.createdAt) >= monthAgo).length,
      members: sum(l.map((s) => s.memberCount)),
      newMembers7d: sum(l.map((s) => s.newMembers7d ?? 0)),
      online: sum(l.map((s) => s.onlineCount ?? 0)),
      onlineServers: l.filter((s) => (s.onlineCount ?? 0) > 0).length,
      voice: sum(l.map((s) => s.voiceCount ?? 0)),
      voiceServers: l.filter((s) => (s.voiceCount ?? 0) > 0).length,
      daily,
      msgs7d: sum(daily.slice(-7)),
      msgsPrev7d: sum(daily.slice(0, 7)),
      active: l.filter((s) => last7(s) > 0).length,
      dormant: l.filter((s) => ts(s.lastMessageAt) < monthAgo).length,
      joined: l.filter((s) => s.joined).length,
      hidden: l.filter((s) => s.hidden).length,
      verified: l.filter((s) => s.verified || s.official).length,
    };
  }, [list]);

  const top = useMemo(
    () =>
      [...(list ?? [])]
        .map((s) => ({ s, n: last7(s) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 5),
    [list],
  );

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (s: AdminServerEntry) => {
      if (term && !s.name.toLowerCase().includes(term) && !s.owner.displayName.toLowerCase().includes(term))
        return false;
      switch (filter) {
        case 'active':
          return last7(s) > 0;
        case 'idle':
          return last7(s) === 0;
        case 'verified':
          return s.verified || s.official;
        case 'joined':
          return s.joined;
        case 'hidden':
          return Boolean(s.hidden);
        default:
          return true;
      }
    };
    const by: Record<Sort, (a: AdminServerEntry, b: AdminServerEntry) => number> = {
      activity: (a, b) => last7(b) - last7(a) || ts(b.lastMessageAt) - ts(a.lastMessageAt),
      members: (a, b) => b.memberCount - a.memberCount,
      online: (a, b) => (b.voiceCount ?? 0) + (b.onlineCount ?? 0) - ((a.voiceCount ?? 0) + (a.onlineCount ?? 0)),
      recent: (a, b) => ts(b.lastMessageAt) - ts(a.lastMessageAt),
      created: (a, b) => ts(b.createdAt) - ts(a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
    };
    return (list ?? []).filter(match).sort(by[sort]);
  }, [list, q, filter, sort]);

  if (!list) return <p className="muted">Carregando…</p>;

  const go = (id: string) => {
    useUi.getState().go({ kind: 'server', serverId: id, channelId: null });
    onClose();
  };
  const patch = (id: string, p: Partial<AdminServerEntry>) =>
    setList((l) => l?.map((x) => (x.id === id ? { ...x, ...p } : x)) ?? l);

  const join = async (s: AdminServerEntry, hidden: boolean) => {
    const text = hidden
      ? 'Você entra sem aparecer na lista de membros, na presença nem nas contagens. Fica registrado só na auditoria do painel. Em voz você não entra enquanto invisível.'
      : 'A entrada fica registrada e os membros veem você.';
    if (
      !(await askConfirm(text, {
        title: `Entrar em "${s.name}" ${hidden ? 'invisível' : 'como super admin'}`,
        confirmLabel: hidden ? 'Entrar invisível' : 'Entrar',
      }))
    )
      return;
    setBusy(s.id);
    try {
      await api().request<ServerDetail>('POST', `/admin/servers/${s.id}/join`, { hidden });
      await loadServer(s.id);
      go(s.id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  /** Visível ↔ invisível no servidor em que já participa (adendo da ADR-0013). */
  const toggleHidden = async (s: AdminServerEntry) => {
    const hidden = !s.hidden;
    setBusy(s.id);
    try {
      await api().request('PUT', `/admin/servers/${s.id}/hidden`, { hidden });
      patch(s.id, { hidden });
      await loadServer(s.id);
      useUi.getState().toast('success', hidden ? 'Agora você está invisível.' : 'Agora os membros veem você.');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  /** Só o selo de verificado: o servidor continua privado (ADR-0013). */
  const toggleVerified = async (s: AdminServerEntry) => {
    setBusy(s.id);
    try {
      await api().request('PUT', `/admin/servers/${s.id}/verified`, { verified: !s.verified });
      patch(s.id, { verified: !s.verified });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const menu = (e: React.MouseEvent | React.KeyboardEvent, s: AdminServerEntry) => {
    const items: MenuEntry[] = [];
    if (s.joined) {
      items.push({ label: 'Abrir', icon: 'popout', onSelect: () => go(s.id) });
      items.push({
        label: s.hidden ? 'Ficar visível' : 'Ficar invisível',
        icon: s.hidden ? 'eye' : 'eye-off',
        disabled: busy === s.id,
        onSelect: () => void toggleHidden(s),
      });
    } else {
      items.push({ label: 'Entrar', icon: 'shield', onSelect: () => void join(s, false) });
      items.push({
        label: 'Entrar invisível',
        icon: 'eye-off',
        hint: 'Só a auditoria do painel registra',
        onSelect: () => void join(s, true),
      });
    }
    if (!s.official)
      items.push('separator', {
        label: s.verified ? 'Tirar selo de verificado' : 'Dar selo de verificado',
        icon: 'verified',
        disabled: busy === s.id,
        onSelect: () => void toggleVerified(s),
      });
    items.push('separator', {
      label: 'Copiar ID',
      icon: 'copy',
      onSelect: () => void navigator.clipboard.writeText(s.id),
    });
    openContextMenu(e, items, `Ações de ${s.name}`);
  };

  const msgDelta = delta(totals.msgs7d, totals.msgsPrev7d);
  const filters: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'Todos', n: totals.servers },
    { id: 'active', label: 'Ativos', n: totals.active },
    { id: 'idle', label: 'Parados', n: totals.servers - totals.active },
    { id: 'verified', label: 'Verificados', n: totals.verified },
    { id: 'joined', label: 'Onde estou', n: totals.joined },
    { id: 'hidden', label: 'Invisível', n: totals.hidden },
  ];
  const maxTop = top[0]?.n ?? 1;

  return (
    <section className="admin-dash" aria-labelledby="admin-dash-title">
      <header className="admin-dash-head">
        <div>
          <h3 id="admin-dash-title" className="settings-section-title">
            Servidores
          </h3>
          <p className="muted small">
            Entrar visível fica na auditoria do servidor; invisível, só na auditoria do painel. O selo não muda a
            privacidade.
          </p>
        </div>
        <div className="admin-dash-refresh">
          {loadedAt && (
            <span className="muted small">
              Atualizado às {loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button variant="secondary" size="sm" icon="refresh" disabled={loading} onClick={load}>
            Atualizar
          </Button>
        </div>
      </header>

      <ul className="admin-kpis" aria-label="Números dos servidores">
        <Kpi icon="server" label="Servidores" value={totals.servers} hint={`+${nf(totals.created30d)} em 30 dias`} />
        <Kpi
          icon="users"
          label="Membros (soma)"
          value={totals.members}
          hint={`+${nf(totals.newMembers7d)} entradas em 7 dias`}
        />
        <Kpi
          icon="signal"
          label="Conectados agora"
          value={totals.online}
          hint={`em ${nf(totals.onlineServers)} servidor(es)`}
          live
        />
        <Kpi
          icon="speaker"
          label="Em voz agora"
          value={totals.voice}
          hint={`em ${nf(totals.voiceServers)} servidor(es)`}
          live
        />
        <Kpi icon="chat" label="Mensagens em 7 dias" value={totals.msgs7d} trend={msgDelta} hint="vs. 7 dias antes" />
        <Kpi
          icon="activities"
          label="Ativos em 7 dias"
          value={totals.active}
          suffix={`/ ${nf(totals.servers)}`}
          hint={`${nf(totals.dormant)} parado(s) há 30+ dias`}
        />
      </ul>

      <div className="admin-panels">
        <div className="admin-card admin-card-chart">
          <div className="admin-card-head">
            <strong>Mensagens por dia</strong>
            <span className="muted small">últimos {DAYS} dias · todos os servidores</span>
          </div>
          <BarChart data={totals.daily} />
        </div>
        <div className="admin-card">
          <div className="admin-card-head">
            <strong>Mais ativos</strong>
            <span className="muted small">mensagens em 7 dias</span>
          </div>
          {top.length === 0 ? (
            <p className="muted small admin-empty">Nenhuma mensagem nos últimos 7 dias.</p>
          ) : (
            <ol className="admin-rank">
              {top.map(({ s, n }) => (
                <li key={s.id}>
                  <span className="admin-rank-icon" aria-hidden>
                    <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
                  </span>
                  <span className="admin-rank-body">
                    <span className="admin-rank-line">
                      <span className="truncate">{s.name}</span>
                      <span className="admin-num">{nf(n)}</span>
                    </span>
                    <span className="admin-rank-bar" aria-hidden>
                      <span style={{ width: `${Math.max(4, (n / maxTop) * 100)}%` }} />
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="admin-card">
          <div className="admin-card-head">
            <strong>Sua presença</strong>
            <span className="muted small">como super admin</span>
          </div>
          <dl className="admin-facts">
            <div>
              <dt>Participa de</dt>
              <dd>
                {nf(totals.joined)} <span className="muted">/ {nf(totals.servers)}</span>
              </dd>
            </div>
            <div>
              <dt>Invisível em</dt>
              <dd>{nf(totals.hidden)}</dd>
            </div>
            <div>
              <dt>Verificados</dt>
              <dd>{nf(totals.verified)}</dd>
            </div>
            <div>
              <dt>Sem nenhuma mensagem</dt>
              <dd>{nf(list.filter((s) => !s.lastMessageAt).length)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="admin-dash-toolbar">
        <TextField
          fieldClassName="admin-search"
          aria-label="Buscar servidor"
          leadingIcon="search"
          placeholder="Buscar por nome ou dono"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          className="admin-sort"
          aria-label="Ordenar servidores"
          value={sort}
          onChange={setSort}
          options={SORTS}
        />
        <div className="admin-chips" role="group" aria-label="Filtrar servidores">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className="admin-chip"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="admin-chip-n">{nf(f.n)}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="muted admin-empty">Nenhum servidor encontrado.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">
              {shown.length} de {list.length} servidores
            </caption>
            <thead>
              <tr>
                <th scope="col">Servidor</th>
                <th scope="col" className="num">
                  Membros
                </th>
                <th scope="col" className="col-now">
                  Agora
                </th>
                <th scope="col" className="col-channels">
                  Canais
                </th>
                <th scope="col" className="col-activity">
                  Mensagens · 14 d
                </th>
                <th scope="col" className="col-last">
                  Última msg.
                </th>
                <th scope="col" className="col-created">
                  Criado em
                </th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const d = series(s);
                const w7 = last7(s);
                const dd = delta(w7, prev7(s));
                return (
                  <tr key={s.id} onContextMenu={(e) => menu(e, s)} data-idle={w7 === 0 || undefined}>
                    <th scope="row">
                      <span className="admin-srv">
                        <span className="admin-srv-icon" aria-hidden>
                          <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
                        </span>
                        <span className="admin-srv-names">
                          <span className="admin-srv-name">
                            <strong className="truncate">{s.name}</strong>
                            {(s.verified || s.official) && (
                              <Icon name="verified" size={14} active label="Servidor verificado" />
                            )}
                            {s.official && <span className="admin-pill">oficial</span>}
                            {s.hidden && (
                              <span className="admin-pill" data-tone="brand">
                                invisível
                              </span>
                            )}
                          </span>
                          <span className="muted small truncate">de {s.owner.displayName}</span>
                        </span>
                      </span>
                    </th>
                    <td className="num">
                      <span className="admin-num">{nf(s.memberCount)}</span>
                      {(s.newMembers7d ?? 0) > 0 && <span className="admin-up small">+{nf(s.newMembers7d ?? 0)}</span>}
                    </td>
                    <td className="col-now">
                      <span className="admin-now">
                        <span className="admin-now-item" data-on={(s.onlineCount ?? 0) > 0 || undefined}>
                          <span className="admin-dot" aria-hidden />
                          <span className="admin-num">{nf(s.onlineCount ?? 0)}</span>
                          <span className="sr-only"> conectados</span>
                        </span>
                        <span className="admin-now-item" data-on={(s.voiceCount ?? 0) > 0 || undefined}>
                          <Icon name="speaker" size={14} />
                          <span className="admin-num">{nf(s.voiceCount ?? 0)}</span>
                          <span className="sr-only"> em voz</span>
                        </span>
                      </span>
                    </td>
                    <td className="col-channels">
                      <span className="admin-now">
                        <span className="admin-now-item">
                          <Icon name="hashtag" size={14} />
                          <span className="admin-num">{nf(s.textChannels ?? 0)}</span>
                          <span className="sr-only"> de texto</span>
                        </span>
                        <span className="admin-now-item">
                          <Icon name="speaker" size={14} />
                          <span className="admin-num">{nf(s.voiceChannels ?? 0)}</span>
                          <span className="sr-only"> de voz</span>
                        </span>
                      </span>
                    </td>
                    <td className="col-activity">
                      <span className="admin-activity">
                        <Sparkline data={d} name={s.name} />
                        <span className="admin-activity-n">
                          <span className="admin-num">{nf(w7)}</span>
                          <Trend value={dd} />
                        </span>
                      </span>
                    </td>
                    <td className="col-last">
                      <span className="small">{ago(s.lastMessageAt)}</span>
                    </td>
                    <td className="col-created">
                      <span className="small muted">{fmtDate(s.createdAt)}</span>
                    </td>
                    <td className="admin-actions">
                      {s.joined ? (
                        <Button variant="secondary" size="sm" onClick={() => go(s.id)}>
                          Abrir
                        </Button>
                      ) : (
                        <Button size="sm" icon="shield" disabled={busy === s.id} onClick={() => void join(s, false)}>
                          Entrar
                        </Button>
                      )}
                      <Tooltip label="Mais ações">
                        <button
                          type="button"
                          className="admin-more"
                          aria-label={`Mais ações de ${s.name}`}
                          aria-haspopup="menu"
                          disabled={busy === s.id}
                          onClick={(e) => menu(e, s)}
                        >
                          <Icon name="more" size={18} />
                        </button>
                      </Tooltip>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && (
        <p className="muted small admin-foot">
          Mostrando {nf(shown.length)} de {nf(list.length)} · clique com o botão direito numa linha para mais ações.
          Contagens não incluem membros invisíveis.
        </p>
      )}
    </section>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  suffix,
  trend,
  live,
}: {
  icon: IconName;
  label: string;
  value: number;
  hint?: string;
  suffix?: string;
  trend?: number | null;
  live?: boolean;
}) {
  return (
    <li className="admin-kpi">
      <span className="admin-kpi-label">
        <Icon name={icon} size={16} />
        {label}
        {live && (
          <span className="admin-live">
            <span className="admin-dot" aria-hidden />
            <span className="sr-only">(ao vivo)</span>
          </span>
        )}
      </span>
      <span className="admin-kpi-value">
        {nf(value)}
        {suffix && <span className="admin-kpi-suffix">{suffix}</span>}
        {trend !== undefined && <Trend value={trend} />}
      </span>
      {hint && <span className="muted small">{hint}</span>}
    </li>
  );
}

/** ↑/↓ em relação à semana anterior */
function Trend({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const tone = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span className="admin-trend" data-tone={tone}>
      {value > 0 ? '↑' : value < 0 ? '↓' : '→'} {Math.abs(value)}%
      <span className="sr-only"> em relação aos 7 dias anteriores</span>
    </span>
  );
}

/** Mini gráfico de barras (14 dias) por servidor; a última semana em destaque. */
function Sparkline({ data, name }: { data: readonly number[]; name: string }) {
  const max = Math.max(1, ...data);
  const total = sum(data);
  const peak = data.indexOf(Math.max(...data));
  const label =
    total === 0
      ? `${name}: nenhuma mensagem em ${DAYS} dias`
      : `${name}: ${nf(total)} mensagens em ${DAYS} dias; pico de ${nf(data[peak] ?? 0)} em ${fmtDay(DAYS - 1 - peak)}`;
  const w = 4;
  const gap = 2;
  return (
    <Tooltip label={label}>
      <span className="admin-spark" tabIndex={0} role="img" aria-label={label}>
        <svg width={DAYS * (w + gap) - gap} height={22} viewBox={`0 0 ${DAYS * (w + gap) - gap} 22`} aria-hidden>
          {data.map((n, i) => {
            const h = n === 0 ? 2 : Math.max(3, Math.round((n / max) * 22));
            return (
              <rect
                key={i}
                x={i * (w + gap)}
                y={22 - h}
                width={w}
                height={h}
                rx={1}
                data-zero={n === 0 || undefined}
                data-recent={i >= DAYS - 7 || undefined}
              />
            );
          })}
        </svg>
      </span>
    </Tooltip>
  );
}

/** Gráfico de barras maior com o total diário da instância, com eixo de datas e valor no hover/foco. */
function BarChart({ data }: { data: readonly number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="admin-bars" role="list" aria-label={`Mensagens por dia, últimos ${DAYS} dias`}>
      {data.map((n, i) => {
        const day = fmtDay(DAYS - 1 - i);
        const today = i === DAYS - 1;
        return (
          <Tooltip key={i} label={`${today ? 'Hoje' : day}: ${nf(n)} mensage${n === 1 ? 'm' : 'ns'}`}>
            <span className="admin-bar" role="listitem" tabIndex={0} aria-label={`${day}: ${nf(n)} mensagens`}>
              <span
                className="admin-bar-fill"
                data-today={today || undefined}
                data-zero={n === 0 || undefined}
                style={{ height: `${n === 0 ? 2 : Math.max(4, (n / max) * 100)}%` }}
              />
              <span className="admin-bar-day" aria-hidden>
                {i % 2 === (DAYS - 1) % 2 ? (today ? 'hoje' : day) : ''}
              </span>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}
