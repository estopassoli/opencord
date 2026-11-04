import { askConfirm, askText } from '../../components/AskDialog';
import {
  ANNOUNCEMENT_TONES,
  type AdminAuditEntry,
  type AdminAuditPage,
  type AdminInstanceConfig,
  type AdminServerEntry,
  type AdminStats,
  type AdminUser,
  type AdminUserPage,
  type InstanceAnnouncement,
  type ServerDetail,
} from '@opencord/contracts';
import { Avatar, Button, Icon, RadioGroup, Select, Switch, TextArea, TextField, type IconName } from '@opencord/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Dialog } from '../../components/Dialog';
import { ServerIcon } from '../../components/ServerIcon';
import { useData } from '../../store/data';
import { api, describeError, loadServer } from '../../store/session';
import { useUi } from '../../store/ui';
import { Section, TabbedLayout, type TabDef } from '../settings/SettingsModal';
import { AdminModerationTab } from './AdminModerationTab';
import { BadgesTab, UserBadgesDialog } from './AdminBadgesTab';
import { UserBadges } from '../../components/UserBadges';
import '../settings/settings.css';

/**
 * Painel do super admin (ADR-0020): números da instância, servidores, usuários, configuração e auditoria global.
 * Só aparece para quem é super admin; a API responde 404 para os demais.
 */
type AdminTab = 'overview' | 'servers' | 'users' | 'badges' | 'instance' | 'moderation' | 'audit';

const TABS: readonly TabDef<AdminTab>[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'servers', label: 'Servidores' },
  { id: 'users', label: 'Usuários' },
  { id: 'badges', label: 'Insígnias' },
  { id: 'instance', label: 'Instância' },
  { id: 'moderation', label: 'Moderação IA' },
  { id: 'audit', label: 'Auditoria' },
];

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const MB = 1024 * 1024;

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const isAdmin = useData((s) => Boolean(s.me?.isInstanceAdmin));
  const initial = useUi((s) => (s.modal?.kind === 'admin' ? s.modal.tab : undefined));
  const [tab, setTab] = useState<AdminTab>(TABS.some((t) => t.id === initial) ? (initial as AdminTab) : 'overview');
  if (!isAdmin) {
    return (
      <Dialog title="Painel admin" onClose={onClose}>
        <p className="muted">Só super admins acessam este painel.</p>
      </Dialog>
    );
  }
  return (
    <Dialog title="Painel admin" onClose={onClose} fullscreen>
      <TabbedLayout tabs={TABS} active={tab} onChange={setTab} label="Seções do painel admin">
        {tab === 'overview' && <OverviewTab onTab={setTab} />}
        {tab === 'servers' && <ServersTab onClose={onClose} />}
        {tab === 'users' && <UsersTab />}
        {tab === 'badges' && <BadgesTab />}
        {tab === 'instance' && <InstanceTab />}
        {tab === 'moderation' && <AdminModerationTab />}
        {tab === 'audit' && <AuditTab />}
      </TabbedLayout>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

function OverviewTab({ onTab }: { onTab: (t: AdminTab) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api()
      .request<AdminStats>('GET', '/admin/stats')
      .then(setStats, (e: unknown) => setError(describeError(e)));
  }, []);
  useEffect(load, [load]);
  if (error) return <p className="form-error">{error}</p>;
  if (!stats) return <p className="muted">Carregando…</p>;
  const cards: { label: string; value: number; icon: IconName; hint?: string; tab?: AdminTab }[] = [
    {
      label: 'Usuários',
      value: stats.users,
      icon: 'users',
      hint: `+${stats.newUsers7d} nos últimos 7 dias`,
      tab: 'users',
    },
    { label: 'Online agora', value: stats.onlineNow, icon: 'signal' },
    { label: 'Em chamada', value: stats.inVoice, icon: 'speaker' },
    { label: 'Servidores', value: stats.servers, icon: 'server', tab: 'servers' },
    { label: 'Mensagens em 24 h', value: stats.messages24h, icon: 'chat' },
    { label: 'Super admins', value: stats.admins, icon: 'shield', tab: 'users' },
    { label: 'Contas suspensas', value: stats.suspended, icon: 'block', tab: 'users' },
  ];
  return (
    <Section
      title="Visão geral"
      description={
        <>
          Números da instância agora.{' '}
          <button type="button" className="link-btn" onClick={load}>
            Atualizar
          </button>
        </>
      }
    >
      <ul className="admin-stats">
        {cards.map((c) => {
          const body = (
            <>
              <Icon name={c.icon} size={20} />
              <span className="admin-stat-value">{c.value.toLocaleString('pt-BR')}</span>
              <span className="admin-stat-label">{c.label}</span>
              {c.hint && <span className="muted small">{c.hint}</span>}
            </>
          );
          return (
            <li key={c.label}>
              {c.tab ? (
                <button type="button" className="admin-stat" onClick={() => onTab(c.tab as AdminTab)}>
                  {body}
                </button>
              ) : (
                <div className="admin-stat">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Servidores (ADR-0013): entrar como super admin (auditado) e selo de verificado
// ---------------------------------------------------------------------------

function ServersTab({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<AdminServerEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    void api().request<AdminServerEntry[]>('GET', '/admin/servers').then(setList, toastError);
  }, []);
  if (!list) return <p className="muted">Carregando…</p>;
  const term = q.trim().toLowerCase();
  const shown = list.filter(
    (s) => !term || s.name.toLowerCase().includes(term) || s.owner.displayName.toLowerCase().includes(term),
  );
  const go = (id: string) => {
    useUi.getState().go({ kind: 'server', serverId: id, channelId: null });
    onClose();
  };
  const join = async (s: AdminServerEntry, hidden: boolean) => {
    const q = hidden
      ? 'Você entra sem aparecer na lista de membros, na presença nem nas contagens. Fica registrado só na auditoria do painel. Em voz você não entra enquanto invisível.'
      : 'A entrada fica registrada e os membros veem você.';
    if (
      !(await askConfirm(q, {
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
      setList((l) => l?.map((x) => (x.id === s.id ? { ...x, hidden } : x)) ?? l);
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
      setList((l) => l?.map((x) => (x.id === s.id ? { ...x, verified: !s.verified } : x)) ?? l);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title={`Servidores · ${list.length}`}
      description="Entrar visível fica na auditoria do servidor; invisível, só na auditoria do painel. O selo não muda a privacidade."
    >
      <TextField
        aria-label="Buscar servidor"
        leadingIcon="search"
        placeholder="Buscar por nome ou dono"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {shown.length === 0 && <p className="muted">Nenhum servidor encontrado.</p>}
      <ul className="directory">
        {shown.map((s) => (
          <li key={s.id} className="directory-row">
            <span className="directory-icon" aria-hidden>
              <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
            </span>
            <span className="directory-names">
              <strong className="truncate">
                {s.name}
                {(s.verified || s.official) && <Icon name="verified" size={14} active label="Servidor verificado" />}
              </strong>
              <span className="muted small truncate">
                {s.official ? 'Oficial · ' : ''}de {s.owner.displayName} · {s.memberCount} membro(s)
              </span>
            </span>
            {!s.official && (
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
            )}
            {s.joined ? (
              <>
                {s.hidden && (
                  <span className="admin-pill" data-tone="brand">
                    invisível
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={s.hidden ? 'eye' : 'eye-off'}
                  disabled={busy === s.id}
                  onClick={() => void toggleHidden(s)}
                >
                  {s.hidden ? 'Ficar visível' : 'Ficar invisível'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => go(s.id)}>
                  Abrir
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="eye-off"
                  disabled={busy === s.id}
                  onClick={() => void join(s, true)}
                >
                  Entrar invisível
                </Button>
                <Button size="sm" icon="shield" disabled={busy === s.id} onClick={() => void join(s, false)}>
                  Entrar
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

type UserFilter = 'all' | 'admins' | 'suspended';
const FILTERS: { value: UserFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'admins', label: 'Super admins' },
  { value: 'suspended', label: 'Suspensos' },
];

function UsersTab() {
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

  return (
    <Section title="Usuários" description="Clique numa pessoa para ver as ações. Tudo fica na auditoria.">
      <div className="admin-toolbar">
        <TextField
          aria-label="Buscar usuário"
          leadingIcon="search"
          placeholder="Buscar por apelido, usuário ou e-mail"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          fieldClassName="admin-search"
        />
        <Select<UserFilter>
          aria-label="Filtro"
          value={filter}
          onChange={setFilter}
          options={FILTERS}
          className="admin-filter"
        />
      </div>
      {!page ? (
        <p className="muted">Carregando…</p>
      ) : page.users.length === 0 ? (
        <p className="muted">Ninguém encontrado.</p>
      ) : (
        <ul className="admin-users">
          {page.users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="admin-user"
                data-suspended={u.disabledAt ? 'true' : undefined}
                aria-label={`Ações para ${u.displayName}`}
                onClick={(e) => openContextMenu(e, menu(u), `Ações para ${u.displayName}`)}
                onContextMenu={(e) => openContextMenu(e, menu(u), `Ações para ${u.displayName}`)}
              >
                <Avatar id={u.id} name={u.displayName} size={36} status={u.online ? 'online' : 'offline'} />
                <span className="admin-user-names">
                  <strong className="truncate">
                    {u.displayName}
                    {(u.isCreator || u.verified) && (
                      <Icon
                        name="verified"
                        size={14}
                        active
                        label={u.isCreator ? 'Criador do OpenCord' : 'Verificado'}
                      />
                    )}
                    <UserBadges userId={u.id} fallback={u.badges} />
                  </strong>
                  <span className="muted small truncate">
                    @{u.username}
                    {u.email ? ` · ${u.email}` : u.hasAccount ? '' : ' · só apelido'}
                  </span>
                </span>
                <span className="admin-user-tags">
                  {u.isInstanceAdmin && (
                    <span className="admin-pill" data-tone="brand">
                      super admin
                    </span>
                  )}
                  {u.disabledAt && (
                    <span className="admin-pill" data-tone="danger">
                      suspenso
                    </span>
                  )}
                </span>
                <span className="admin-user-meta muted small">
                  <span>{u.serverCount} servidor(es)</span>
                  <span>{u.lastSeenAt ? `visto ${fmtDate(u.lastSeenAt)}` : 'nunca entrou'}</span>
                </span>
                <Icon name="more" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {page?.nextCursor && (
        <Button variant="ghost" size="sm" disabled={loadingMore} onClick={() => void more()}>
          Carregar mais
        </Button>
      )}
      {badgesFor && <UserBadgesDialog user={badgesFor} onClose={() => setBadgesFor(null)} onSaved={replace} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Instância: cadastro, aviso em faixa e limite de upload
// ---------------------------------------------------------------------------

const TONE_LABEL: Record<InstanceAnnouncement['tone'], string> = {
  info: 'Informação',
  warning: 'Atenção',
  success: 'Novidade boa',
};

function InstanceTab() {
  const [cfg, setCfg] = useState<AdminInstanceConfig | null>(null);
  const [text, setText] = useState('');
  const [tone, setTone] = useState<InstanceAnnouncement['tone']>('info');
  const [uploadMb, setUploadMb] = useState<number | null>(null);
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (c: AdminInstanceConfig) => {
    setCfg(c);
    setContact(c.privacyContact ?? '');
    setText(c.announcement?.text ?? '');
    setTone(c.announcement?.tone ?? 'info');
    setUploadMb(c.uploadOverrideBytes ? Math.round(c.uploadOverrideBytes / MB) : null);
  };
  useEffect(() => {
    void api().request<AdminInstanceConfig>('GET', '/admin/instance').then(apply, toastError);
  }, []);

  const save = async (patch: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      apply(await api().request<AdminInstanceConfig>('PATCH', '/admin/instance', patch));
      useUi.getState().toast('success', ok);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <p className="muted">Carregando…</p>;
  const envMb = Math.floor(cfg.uploadEnvMaxBytes / MB);
  const uploadOptions = [
    { value: '0', label: `Padrão do servidor (${envMb} MB)` },
    ...[5, 10, 25, 50, 100, 250, 500].filter((n) => n < envMb).map((n) => ({ value: String(n), label: `${n} MB` })),
  ];

  const publish = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void save({ announcement: { text: text.trim(), tone } }, 'Aviso publicado para todos.');
  };

  return (
    <>
      <Section title="Cadastro">
        <Switch
          label="Novos cadastros abertos"
          description="Desligado: ninguém novo entra (nem com conta, nem só com apelido). Quem já tem conta continua entrando."
          checked={cfg.registrationOpen}
          disabled={busy}
          onChange={(v) => void save({ registrationOpen: v }, v ? 'Cadastros abertos.' : 'Cadastros fechados.')}
        />
      </Section>

      <Section
        title="Aviso para todos"
        description="Aparece numa faixa no topo do app de todo mundo, na hora. Cada pessoa pode dispensar."
      >
        <form className="form" onSubmit={publish}>
          <TextArea
            label="Texto"
            rows={2}
            maxLength={280}
            placeholder="Ex.: Manutenção hoje às 23h, a voz pode cair por alguns minutos."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <RadioGroup<InstanceAnnouncement['tone']>
            label="Tipo"
            value={tone}
            onChange={setTone}
            options={ANNOUNCEMENT_TONES.map((t) => ({ value: t, label: TONE_LABEL[t] }))}
          />
          {text.trim() && (
            <div className="instance-banner instance-banner-preview" data-tone={tone} aria-label="Prévia do aviso">
              <Icon name={tone === 'warning' ? 'warning' : tone === 'success' ? 'check' : 'bell'} size={16} />
              <span>{text.trim()}</span>
            </div>
          )}
          <div className="form-actions">
            {cfg.announcement && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void save({ announcement: null }, 'Aviso removido.')}
              >
                Remover aviso
              </Button>
            )}
            <Button type="submit" disabled={busy || !text.trim()}>
              {cfg.announcement ? 'Atualizar aviso' : 'Publicar aviso'}
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title="Limite de upload"
        description={`Tamanho máximo de cada anexo. O servidor permite até ${envMb} MB; aqui dá para reduzir.`}
      >
        <Select<string>
          aria-label="Limite de upload"
          value={String(uploadMb ?? 0)}
          onChange={(raw) => {
            const v = Number(raw);
            void save({ uploadMaxBytes: v ? v * MB : null }, v ? `Limite de upload: ${v} MB.` : 'Limite padrão.');
          }}
          options={uploadOptions}
        />
      </Section>
      <Section
        title="Contato para privacidade"
        description="E-mail ou link que aparece nos Termos e na Política de privacidade para pedidos sobre dados pessoais (LGPD). Vazio: só o canal do projeto no GitHub."
      >
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ privacyContact: contact.trim() || null }, 'Contato salvo.');
          }}
        >
          <TextField
            label="Contato"
            placeholder="privacidade@exemplo.com"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={254}
          />
          <div className="form-actions">
            <Button type="submit" size="sm" disabled={busy || contact.trim() === (cfg.privacyContact ?? '')}>
              Salvar
            </Button>
          </div>
        </form>
      </Section>
      {cfg.updatedAt && <p className="muted small">Última alteração: {fmtDate(cfg.updatedAt)}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Auditoria global
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  'admin.user.suspend': 'Suspendeu conta',
  'admin.user.unsuspend': 'Reativou conta',
  'admin.user.logout': 'Encerrou sessões',
  'admin.user.promote': 'Tornou super admin',
  'admin.user.demote': 'Tirou super admin',
  'admin.instance.update': 'Mudou a instância',
  'server.verified': 'Selo de verificado',
  'member.join': 'Entrou no servidor',
  'member.kick': 'Expulsou membro',
  'member.leave': 'Saiu do servidor',
  'server.create': 'Criou servidor',
  'server.update': 'Atualizou servidor',
  'channel.create': 'Criou canal',
  'channel.update': 'Atualizou canal',
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

/** Detalhe curto da ação (motivo da suspensão, o que mudou na instância, selo, entrada como admin). */
function detailOf(e: AdminAuditEntry): string {
  const m = e.metadata;
  if (e.action === 'admin.user.suspend' && typeof m.reason === 'string') return `Motivo: ${m.reason}`;
  if (e.action === 'server.verified') return m.verified ? 'marcou' : 'tirou';
  if (e.action === 'member.join' && m.via === 'instance-admin') return 'como super admin';
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

function AuditTab() {
  const [scope, setScope] = useState<'admin' | 'all'>('admin');
  const [page, setPage] = useState<AdminAuditPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
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
  return (
    <Section title="Auditoria da instância">
      <div className="admin-toolbar">
        <Select<'admin' | 'all'>
          aria-label="Quais ações"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'admin', label: 'Ações de super admin' },
            { value: 'all', label: 'Tudo (todos os servidores)' },
          ]}
          className="admin-filter"
        />
      </div>
      {!page ? (
        <p className="muted">Carregando…</p>
      ) : page.entries.length === 0 ? (
        <p className="muted">Nenhuma ação registrada.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Quem</th>
              <th scope="col">Ação</th>
              <th scope="col">Alvo</th>
              <th scope="col">Onde</th>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((e) => {
              const detail = detailOf(e);
              return (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDate(e.createdAt)}</td>
                  <td>{e.actor.displayName}</td>
                  <td>
                    {ACTION_LABELS[e.action] ?? e.action}
                    {detail && <span className="muted small"> · {detail}</span>}
                  </td>
                  <td className="muted">{e.targetName ?? (e.targetId ? e.targetId.slice(0, 8) : '—')}</td>
                  <td className="muted">{e.server?.name ?? 'Instância'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {page?.nextBefore && (
        <Button variant="ghost" size="sm" disabled={loadingMore} onClick={() => void more()}>
          Carregar mais
        </Button>
      )}
    </Section>
  );
}
