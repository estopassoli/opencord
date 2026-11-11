import {
  APP_VERSION_DAYS,
  type AdminAuditPage,
  type AdminInstanceConfig,
  type AdminServerEntry,
  type AdminStats,
  type AdminUserPage,
} from '@opencord/contracts';
import { Avatar, Button, Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { ServerIcon } from '../../components/ServerIcon';
import { api } from '../../store/session';
import { actionLabel, detailOf } from './AdminAuditTab';
import type { AdminTab } from './AdminPanel';
import {
  BarChart,
  Card,
  DAYS,
  Facts,
  Kpi,
  KpiGrid,
  Loading,
  MB,
  PieChart,
  Pill,
  RankList,
  ago,
  delta,
  nf,
  series14,
  sum,
} from './adminKit';
import { compareVersions, referenceVersion, useLatestRelease, versionSlices } from './versions';

/** Visão geral: números agora, séries de 14 dias, ranking, contas novas, estado da instância e atividade recente. */
export function AdminOverviewTab({ stats, onTab }: { stats: AdminStats | null; onTab: (t: AdminTab) => void }) {
  const [servers, setServers] = useState<AdminServerEntry[] | null>(null);
  const [users, setUsers] = useState<AdminUserPage | null>(null);
  const [audit, setAudit] = useState<AdminAuditPage | null>(null);
  const [cfg, setCfg] = useState<AdminInstanceConfig | null>(null);
  const release = useLatestRelease();

  useEffect(() => {
    // cada cartão carrega sozinho: um que falhe não derruba os outros
    const quiet = () => undefined;
    void api().request<AdminServerEntry[]>('GET', '/admin/servers').then(setServers, quiet);
    void api().request<AdminUserPage>('GET', '/admin/users?filter=all').then(setUsers, quiet);
    void api().request<AdminAuditPage>('GET', '/admin/audit?scope=admin').then(setAudit, quiet);
    void api().request<AdminInstanceConfig>('GET', '/admin/instance').then(setCfg, quiet);
  }, []);

  if (!stats) return <Loading rows={4} />;

  const msgs = series14(stats.messagesDaily);
  const signups = series14(stats.signupsDaily);
  const newServers = sum(series14(stats.serversDaily));
  const msgs7 = sum(msgs.slice(-7));
  const top = (servers ?? [])
    .map((s) => ({ s, n: sum(series14(s.messagesDaily).slice(-7)) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  const activeServers = (servers ?? []).filter((s) => sum(series14(s.messagesDaily).slice(-7)) > 0).length;
  const pending = stats.pendingModeration ?? 0;

  return (
    <div className="adm-stack">
      <KpiGrid label="Números da instância">
        <Kpi
          icon="users"
          label="Usuários"
          value={stats.users}
          trend={delta(sum(signups.slice(-7)), sum(signups.slice(0, 7)))}
          hint={`+${nf(stats.newUsers7d)} em 7 dias`}
          spark={signups}
          onClick={() => onTab('users')}
        />
        <Kpi icon="signal" label="Online agora" value={stats.onlineNow} live tone="success" hint="conectados ao app" />
        <Kpi icon="speaker" label="Em chamada" value={stats.inVoice} live tone="success" hint="em canais de voz" />
        <Kpi
          icon="server"
          label="Servidores"
          value={stats.servers}
          hint={
            servers
              ? `${nf(activeServers)} ativos em 7 dias · +${nf(newServers)} em ${DAYS} d`
              : `+${nf(newServers)} em ${DAYS} dias`
          }
          onClick={() => onTab('servers')}
        />
        <Kpi
          icon="chat"
          label="Mensagens em 24 h"
          value={stats.messages24h}
          trend={delta(msgs7, sum(msgs.slice(0, 7)))}
          hint={`${nf(msgs7)} em 7 dias`}
          spark={msgs}
        />
        <Kpi
          icon="warning"
          label="Moderação pendente"
          value={pending}
          tone={pending ? 'warning' : 'neutral'}
          hint={pending ? 'envios esperando decisão' : 'nada esperando'}
          onClick={() => onTab('moderation')}
        />
        <Kpi icon="shield" label="Super admins" value={stats.admins} tone="neutral" onClick={() => onTab('users')} />
        <Kpi
          icon="block"
          label="Contas suspensas"
          value={stats.suspended}
          tone={stats.suspended ? 'danger' : 'neutral'}
          hint={stats.deviceBans ? `${nf(stats.deviceBans)} aparelho(s) bloqueado(s)` : undefined}
          onClick={() => onTab('users')}
        />
      </KpiGrid>

      <div className="adm-grid">
        <Card
          className="adm-span-8"
          title="Mensagens por dia"
          sub={`Últimos ${DAYS} dias, todos os servidores · ${nf(sum(msgs))} no total`}
        >
          <BarChart data={msgs} unit={['mensagem', 'mensagens']} label={`Mensagens por dia, últimos ${DAYS} dias`} />
        </Card>
        <Card className="adm-span-4" title="Novas contas" sub={`${nf(sum(signups))} em ${DAYS} dias`}>
          <BarChart
            data={signups}
            unit={['cadastro', 'cadastros']}
            label={`Cadastros por dia, últimos ${DAYS} dias`}
            height={150}
          />
        </Card>

        <Card
          className="adm-span-4"
          title="Servidores mais ativos"
          sub="mensagens em 7 dias"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onTab('servers')}>
              Ver todos
            </Button>
          }
        >
          {!servers ? (
            <Loading />
          ) : (
            <RankList
              empty="Nenhuma mensagem nos últimos 7 dias."
              items={top.map(({ s, n }) => ({
                id: s.id,
                icon: <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />,
                label: s.name,
                value: n,
              }))}
            />
          )}
        </Card>

        <Card
          className="adm-span-4"
          title="Chegaram agora"
          sub="contas mais recentes"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onTab('users')}>
              Ver todos
            </Button>
          }
        >
          {!users ? (
            <Loading />
          ) : (
            <ul className="adm-people">
              {users.users.slice(0, 6).map((u) => (
                <li key={u.id}>
                  <Avatar id={u.id} name={u.displayName} size={28} status={u.online ? 'online' : 'offline'} />
                  <span className="adm-people-names">
                    <strong className="truncate">{u.displayName}</strong>
                    <span className="muted small truncate">
                      @{u.username}
                      {u.hasAccount ? '' : ' · só apelido'}
                    </span>
                  </span>
                  <span className="muted small adm-nowrap">{ago(u.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          className="adm-span-4"
          title="Estado da instância"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onTab('instance')}>
              Ajustar
            </Button>
          }
        >
          {!cfg ? (
            <Loading />
          ) : (
            <Facts
              items={[
                {
                  label: 'Cadastros',
                  value: cfg.registrationOpen ? 'Abertos' : 'Fechados',
                  tone: cfg.registrationOpen ? 'success' : 'warning',
                },
                {
                  label: 'Aviso para todos',
                  value: cfg.announcement ? 'No ar' : 'Nenhum',
                  tone: cfg.announcement ? 'brand' : undefined,
                },
                {
                  label: 'Moderação IA',
                  value: !cfg.aiModerationAvailable ? 'Sem chave' : cfg.aiModerationEnabled ? 'Ligada' : 'Desligada',
                  tone: cfg.aiModerationEnabled ? 'success' : 'warning',
                },
                {
                  label: 'Limite de upload',
                  value: `${Math.round((cfg.uploadOverrideBytes ?? cfg.uploadEnvMaxBytes) / MB)} MB`,
                },
                { label: 'Aparelhos bloqueados', value: nf(stats.deviceBans ?? 0) },
              ]}
            />
          )}
        </Card>

        <VersionsCard stats={stats} latest={referenceVersion(release, stats.appVersions)} onTab={onTab} />

        <Card
          className="adm-span-8"
          title="Atividade recente"
          sub="ações de super admin"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onTab('audit')}>
              Abrir auditoria
            </Button>
          }
        >
          {!audit ? (
            <Loading />
          ) : audit.entries.length === 0 ? (
            <p className="muted small adm-empty">Nenhuma ação registrada ainda.</p>
          ) : (
            <ol className="adm-timeline">
              {audit.entries.slice(0, 8).map((e) => {
                const d = detailOf(e);
                return (
                  <li key={e.id}>
                    <span className="adm-timeline-dot" aria-hidden>
                      <Icon name="clock" size={14} />
                    </span>
                    <span className="adm-timeline-body">
                      <span>
                        <strong>{e.actor.displayName}</strong> {actionLabel(e.action).toLowerCase()}
                        {e.targetName && <strong> {e.targetName}</strong>}
                        {d && <span className="muted"> · {d}</span>}
                      </span>
                      <span className="muted small">{e.server ? <Pill>{e.server.name}</Pill> : 'Instância'}</span>
                    </span>
                    <time className="muted small adm-nowrap" dateTime={e.createdAt}>
                      {ago(e.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Pizza com a versão do app de quem entrou nos últimos 30 dias (pela sessão mais recente de cada pessoa). */
function VersionsCard({
  stats,
  latest,
  onTab,
}: {
  stats: AdminStats;
  latest: string | null;
  onTab: (t: AdminTab) => void;
}) {
  const slices = versionSlices(stats.appVersions ?? [], latest);
  const people = sum(slices.map((s) => s.value));
  return (
    <Card
      className="adm-span-4 adm-versions"
      title="Versões do app"
      sub={`Quem entrou nos últimos ${APP_VERSION_DAYS} dias · ${nf(people)} ${people === 1 ? 'pessoa' : 'pessoas'}`}
      actions={
        <Button variant="ghost" size="sm" onClick={() => onTab('users')}>
          Ver pessoas
        </Button>
      }
    >
      {!stats.appVersions ? (
        <p className="muted small adm-empty">O servidor ainda não informa as versões.</p>
      ) : slices.length === 0 ? (
        <p className="muted small adm-empty">Ninguém entrou nos últimos {APP_VERSION_DAYS} dias.</p>
      ) : (
        <PieChart
          label="Pessoas por versão do app"
          unit={['pessoa', 'pessoas']}
          slices={slices.map((s) => ({
            id: s.id,
            label: s.label,
            value: s.value,
            color: s.color,
            tag: s.latest ? <Pill tone="success">mais recente</Pill> : undefined,
            note: s.folded
              ? `${s.folded.slice(0, 6).join(', ')}${s.folded.length > 6 ? '…' : ''}`
              : s.id === 'web'
                ? 'sem o app instalado'
                : s.latest
                  ? 'versão mais recente'
                  : latest && compareVersions(s.label, latest) < 0
                    ? `desatualizada (a mais recente é ${latest})`
                    : undefined,
          }))}
        />
      )}
    </Card>
  );
}
