import type { AdminServerEntry, ServerDetail } from '@opencord/contracts';
import { Button, Icon, Select, TextField } from '@opencord/ui';
import { useEffect, useMemo, useState } from 'react';
import { askConfirm } from '../../components/AskDialog';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { ServerIcon } from '../../components/ServerIcon';
import { api, loadServer } from '../../store/session';
import { useUi } from '../../store/ui';
import {
  BarChart,
  Card,
  Chips,
  DAYS,
  DAY_MS,
  Empty,
  Facts,
  Kpi,
  KpiGrid,
  Loading,
  MoreButton,
  Pill,
  RankList,
  Sparkline,
  Trend,
  ago,
  delta,
  fmtDate,
  nf,
  series14,
  sum,
  toastError,
  ts,
} from './adminKit';

/**
 * Painel do super admin → Servidores (ADR-0013/0020): números somados, atividade de 14 dias, ranking e tabela densa
 * com filtros e ordenação. Entrar (visível/invisível) e o selo de verificado continuam auditados como antes.
 */

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

const series = (s: AdminServerEntry) => series14(s.messagesDaily);
const last7 = (s: AdminServerEntry) => sum(series(s).slice(-7));
const prev7 = (s: AdminServerEntry) => sum(series(s).slice(0, 7));

export function AdminServersTab({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<AdminServerEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('activity');

  useEffect(() => {
    void api().request<AdminServerEntry[]>('GET', '/admin/servers').then(setList, toastError);
  }, []);

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
      never: l.filter((s) => !s.lastMessageAt).length,
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

  if (!list) return <Loading rows={5} />;

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

  const menu = (e: React.MouseEvent, s: AdminServerEntry) => {
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

  return (
    <div className="adm-stack">
      <KpiGrid label="Números dos servidores">
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
          tone="success"
          live
        />
        <Kpi
          icon="speaker"
          label="Em voz agora"
          value={totals.voice}
          hint={`em ${nf(totals.voiceServers)} servidor(es)`}
          tone="success"
          live
        />
        <Kpi
          icon="chat"
          label="Mensagens em 7 dias"
          value={totals.msgs7d}
          trend={delta(totals.msgs7d, totals.msgsPrev7d)}
          hint="vs. 7 dias antes"
          spark={totals.daily}
        />
        <Kpi
          icon="activities"
          label="Ativos em 7 dias"
          value={totals.active}
          suffix={`/ ${nf(totals.servers)}`}
          hint={`${nf(totals.dormant)} parado(s) há 30+ dias`}
          onClick={() => setFilter('active')}
        />
      </KpiGrid>

      <div className="adm-grid">
        <Card className="adm-span-6" title="Mensagens por dia" sub={`últimos ${DAYS} dias · todos os servidores`}>
          <BarChart
            data={totals.daily}
            unit={['mensagem', 'mensagens']}
            label={`Mensagens por dia em todos os servidores, últimos ${DAYS} dias`}
          />
        </Card>
        <Card className="adm-span-3" title="Mais ativos" sub="mensagens em 7 dias">
          <RankList
            empty="Nenhuma mensagem nos últimos 7 dias."
            items={top.map(({ s, n }) => ({
              id: s.id,
              icon: <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />,
              label: s.name,
              value: n,
            }))}
          />
        </Card>
        <Card className="adm-span-3" title="Sua presença" sub="como super admin">
          <Facts
            items={[
              {
                label: 'Participa de',
                value: (
                  <>
                    {nf(totals.joined)} <span className="muted">/ {nf(totals.servers)}</span>
                  </>
                ),
              },
              { label: 'Invisível em', value: nf(totals.hidden), tone: totals.hidden ? 'brand' : undefined },
              { label: 'Verificados', value: nf(totals.verified) },
              { label: 'Sem nenhuma mensagem', value: nf(totals.never) },
            ]}
          />
        </Card>
      </div>

      <div className="adm-toolbar">
        <TextField
          fieldClassName="adm-search"
          aria-label="Buscar servidor"
          leadingIcon="search"
          placeholder="Buscar por nome ou dono"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="adm-sort" aria-label="Ordenar servidores" value={sort} onChange={setSort} options={SORTS} />
        <Chips<Filter>
          label="Filtrar servidores"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'Todos', n: totals.servers },
            { id: 'active', label: 'Ativos', n: totals.active },
            { id: 'idle', label: 'Parados', n: totals.servers - totals.active },
            { id: 'verified', label: 'Verificados', n: totals.verified },
            { id: 'joined', label: 'Onde estou', n: totals.joined },
            { id: 'hidden', label: 'Invisível', n: totals.hidden },
          ]}
        />
      </div>

      <Card
        flush
        title="Todos os servidores"
        sub={`${nf(shown.length)} de ${nf(list.length)} · botão direito numa linha para mais ações · contagens sem membros invisíveis`}
      >
        {shown.length === 0 ? (
          <Empty icon="server">Nenhum servidor encontrado.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Servidor</th>
                  <th scope="col" className="adm-num-col">
                    Membros
                  </th>
                  <th scope="col" className="adm-hide-sm">
                    Agora
                  </th>
                  <th scope="col" className="adm-hide-md">
                    Canais
                  </th>
                  <th scope="col" className="adm-hide-sm">
                    Mensagens · 14 d
                  </th>
                  <th scope="col" className="adm-hide-md">
                    Última msg.
                  </th>
                  <th scope="col" className="adm-hide-lg">
                    Criado em
                  </th>
                  <th scope="col">
                    <span className="oc-visually-hidden">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const w7 = last7(s);
                  return (
                    <tr key={s.id} onContextMenu={(e) => menu(e, s)} data-dim={w7 === 0 || undefined}>
                      <th scope="row">
                        <span className="adm-person">
                          <span className="adm-srv-icon" aria-hidden>
                            <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
                          </span>
                          <span className="adm-person-names">
                            <span className="adm-person-name">
                              <strong className="truncate">{s.name}</strong>
                              {(s.verified || s.official) && (
                                <Icon name="verified" size={14} active label="Servidor verificado" />
                              )}
                              {s.official && <Pill>oficial</Pill>}
                              {s.hidden && <Pill tone="brand">invisível</Pill>}
                            </span>
                            <span className="muted small truncate">de {s.owner.displayName}</span>
                          </span>
                        </span>
                      </th>
                      <td className="adm-num-col">
                        <span className="adm-num">{nf(s.memberCount)}</span>
                        {(s.newMembers7d ?? 0) > 0 && <span className="adm-up small">+{nf(s.newMembers7d ?? 0)}</span>}
                      </td>
                      <td className="adm-hide-sm">
                        <span className="adm-inline">
                          <span className="adm-inline-item" data-on={(s.onlineCount ?? 0) > 0 || undefined}>
                            <span className="adm-dot" data-on={(s.onlineCount ?? 0) > 0 || undefined} aria-hidden />
                            <span className="adm-num">{nf(s.onlineCount ?? 0)}</span>
                            <span className="oc-visually-hidden"> conectados</span>
                          </span>
                          <span className="adm-inline-item" data-on={(s.voiceCount ?? 0) > 0 || undefined}>
                            <Icon name="speaker" size={14} />
                            <span className="adm-num">{nf(s.voiceCount ?? 0)}</span>
                            <span className="oc-visually-hidden"> em voz</span>
                          </span>
                        </span>
                      </td>
                      <td className="adm-hide-md">
                        <span className="adm-inline">
                          <span className="adm-inline-item">
                            <Icon name="hashtag" size={14} />
                            <span className="adm-num">{nf(s.textChannels ?? 0)}</span>
                            <span className="oc-visually-hidden"> de texto</span>
                          </span>
                          <span className="adm-inline-item">
                            <Icon name="speaker" size={14} />
                            <span className="adm-num">{nf(s.voiceChannels ?? 0)}</span>
                            <span className="oc-visually-hidden"> de voz</span>
                          </span>
                        </span>
                      </td>
                      <td className="adm-hide-sm">
                        <span className="adm-inline">
                          <Sparkline data={series(s)} name={s.name} />
                          <span className="adm-stacked">
                            <span className="adm-num">{nf(w7)}</span>
                            <Trend value={delta(w7, prev7(s))} />
                          </span>
                        </span>
                      </td>
                      <td className="adm-hide-md adm-nowrap">{ago(s.lastMessageAt)}</td>
                      <td className="adm-hide-lg adm-nowrap muted">{fmtDate(s.createdAt)}</td>
                      <td className="adm-row-actions">
                        {s.joined ? (
                          <Button variant="secondary" size="sm" onClick={() => go(s.id)}>
                            Abrir
                          </Button>
                        ) : (
                          <Button size="sm" icon="shield" disabled={busy === s.id} onClick={() => void join(s, false)}>
                            Entrar
                          </Button>
                        )}
                        <MoreButton
                          label={`Mais ações de ${s.name}`}
                          disabled={busy === s.id}
                          onClick={(e) => menu(e, s)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
