import type { AdminStats } from '@opencord/contracts';
import { Avatar, Button, Icon, type IconName } from '@opencord/ui';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { Tooltip } from '../../components/Tooltip';
import { useData } from '../../store/data';
import { api } from '../../store/session';
import { useUi } from '../../store/ui';
import { AdminAuditTab } from './AdminAuditTab';
import { BadgesTab } from './AdminBadgesTab';
import { AdminInstanceTab } from './AdminInstanceTab';
import { AdminModerationTab } from './AdminModerationTab';
import { AdminOverviewTab } from './AdminOverviewTab';
import { AdminServersTab } from './AdminServersTab';
import { SystemMessagesTab } from './AdminSystemMessagesTab';
import { AdminUsersTab } from './AdminUsersTab';
import { nf, toastError } from './adminKit';
import '../settings/settings.css';
import './admin.css';

/**
 * Painel do super admin (ADR-0020) como dashboard: barra lateral própria com seções agrupadas e contadores, topo com
 * título, "Atualizar" e fechar, e cada seção em cartões. Só aparece para quem é super admin; a API responde 404 para
 * os demais.
 */
export type AdminTab = 'overview' | 'servers' | 'users' | 'badges' | 'notices' | 'instance' | 'moderation' | 'audit';

interface NavItem {
  id: AdminTab;
  label: string;
  icon: IconName;
  description: string;
}

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      {
        id: 'overview',
        label: 'Visão geral',
        icon: 'grid',
        description: 'Como a instância está agora e nos últimos 14 dias.',
      },
    ],
  },
  {
    label: 'Comunidade',
    items: [
      {
        id: 'servers',
        label: 'Servidores',
        icon: 'server',
        description:
          'Todos os servidores da instância. Entrar visível fica na auditoria do servidor; invisível, só na do painel.',
      },
      {
        id: 'users',
        label: 'Usuários',
        icon: 'users',
        description: 'Contas, sessões, selos e permissões. Tudo o que você faz aqui fica na auditoria.',
      },
      {
        id: 'badges',
        label: 'Insígnias',
        icon: 'star',
        description: 'Insígnias aparecem ao lado do nome (até 3) e no perfil. Dê para as pessoas em Usuários.',
      },
    ],
  },
  {
    label: 'Segurança',
    items: [
      {
        id: 'moderation',
        label: 'Moderação IA',
        icon: 'shield',
        description: 'Mensagens e anexos passam pelo Claude antes de aparecer; em dúvida, ficam retidos.',
      },
      {
        id: 'audit',
        label: 'Auditoria',
        icon: 'clock',
        description: 'Tudo o que super admins fizeram — e, se quiser, o que aconteceu em todos os servidores.',
      },
    ],
  },
  {
    label: 'Sistema',
    items: [
      {
        id: 'notices',
        label: 'Avisos enviados',
        icon: 'mail',
        description: 'Mensagens que a conta OpenCord mandou nas DMs. Quem recebe não pode responder.',
      },
      {
        id: 'instance',
        label: 'Instância',
        icon: 'settings',
        description: 'Cadastro, aviso para todos, limite de upload e contato de privacidade.',
      },
    ],
  },
];
const ITEMS = GROUPS.flatMap((g) => g.items);

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const isAdmin = useData((s) => Boolean(s.me?.isInstanceAdmin));
  if (!isAdmin) {
    return (
      <Dialog title="Painel admin" onClose={onClose}>
        <p className="muted">Só super admins acessam este painel.</p>
      </Dialog>
    );
  }
  return (
    <Dialog title="Painel admin" onClose={onClose} fullscreen hideClose className="adm-dialog">
      <AdminDashboard onClose={onClose} />
    </Dialog>
  );
}

function AdminDashboard({ onClose }: { onClose: () => void }) {
  const me = useData((s) => s.me);
  const initial = useUi((s) => (s.modal?.kind === 'admin' ? s.modal.tab : undefined));
  const [tab, setTab] = useState<AdminTab>(ITEMS.some((t) => t.id === initial) ? (initial as AdminTab) : 'overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const loadStats = useCallback(() => {
    setLoading(true);
    api()
      .request<AdminStats>('GET', '/admin/stats')
      .then((s) => {
        setStats(s);
        setLoadedAt(new Date());
      }, toastError)
      .finally(() => setLoading(false));
  }, []);
  useEffect(loadStats, [loadStats]);
  // o <dialog> foca o primeiro botão ao abrir (depois deste efeito); na volta do laço o foco vai para a seção aberta
  const initialTab = useRef(tab);
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(`adm-nav-${initialTab.current}`)?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const refresh = () => {
    loadStats();
    setReloadKey((k) => k + 1);
  };
  const goTab = (t: AdminTab) => {
    setTab(t);
    contentRef.current?.scrollTo({ top: 0 });
  };

  const current = ITEMS.find((i) => i.id === tab) ?? ITEMS[0]!;
  const group = GROUPS.find((g) => g.items.includes(current))?.label;
  const counts: Partial<Record<AdminTab, { n: number; tone?: 'warning' }>> = stats
    ? {
        servers: { n: stats.servers },
        users: { n: stats.users },
        ...(stats.pendingModeration ? { moderation: { n: stats.pendingModeration, tone: 'warning' as const } } : {}),
      }
    : {};

  /** ↑/↓/Home/End entre as seções da barra lateral */
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = ITEMS.findIndex((t) => t.id === tab);
    const next =
      e.key === 'ArrowDown'
        ? ITEMS[(i + 1) % ITEMS.length]
        : e.key === 'ArrowUp'
          ? ITEMS[(i - 1 + ITEMS.length) % ITEMS.length]
          : e.key === 'Home'
            ? ITEMS[0]
            : e.key === 'End'
              ? ITEMS[ITEMS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    goTab(next.id);
    document.getElementById(`adm-nav-${next.id}`)?.focus();
  };

  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-brand">
          <span className="brand-mark brand-mark-sm" aria-hidden />
          <span className="adm-brand-text">
            <strong>OpenCord</strong>
            <span>Painel admin</span>
          </span>
        </div>
        <nav className="adm-nav" aria-label="Seções do painel admin" onKeyDown={onNavKey}>
          {GROUPS.map((g, gi) => (
            <div key={gi} className="adm-nav-group">
              {g.label && <p className="adm-nav-label">{g.label}</p>}
              <ul>
                {g.items.map((it) => {
                  const on = it.id === tab;
                  const c = counts[it.id];
                  return (
                    <li key={it.id}>
                      <button
                        id={`adm-nav-${it.id}`}
                        type="button"
                        className="adm-nav-item"
                        aria-current={on ? 'page' : undefined}
                        onClick={() => goTab(it.id)}
                      >
                        <Icon name={it.icon} size={18} active={on} />
                        <span className="adm-nav-text">{it.label}</span>
                        {c && (
                          <span className="adm-nav-count" data-tone={c.tone}>
                            {nf(c.n)}
                            {c.tone === 'warning' && <span className="oc-visually-hidden"> pendentes</span>}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="adm-side-foot">
          {stats && (
            <p className="adm-side-status">
              <span className="adm-dot" data-on aria-hidden />
              {nf(stats.onlineNow)} online · {nf(stats.inVoice)} em voz
            </p>
          )}
          {me && (
            <div className="adm-me">
              <Avatar id={me.id} name={me.displayName} size={32} status="online" />
              <span className="adm-me-text">
                <strong className="truncate">{me.displayName}</strong>
                <span className="muted small">Super admin</span>
              </span>
            </div>
          )}
        </div>
      </aside>

      <div className="adm-main">
        <header className="adm-top">
          <div className="adm-top-titles">
            <p className="adm-crumb">Painel admin{group ? ` · ${group}` : ''}</p>
            <h2>{current.label}</h2>
            <p className="muted small adm-top-desc">{current.description}</p>
          </div>
          <div className="adm-top-actions">
            {loadedAt && (
              <span className="muted small adm-updated">
                Atualizado às {loadedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <Button variant="secondary" size="sm" icon="refresh" disabled={loading} onClick={refresh}>
              Atualizar
            </Button>
            <Tooltip label="Fechar (Esc)" side="bottom">
              <button type="button" className="adm-close" aria-label="Fechar painel admin (Esc)" onClick={onClose}>
                <Icon name="close" size={18} />
              </button>
            </Tooltip>
          </div>
        </header>
        <div className="adm-content" ref={contentRef} aria-label={current.label} role="region">
          <div className="adm-content-inner" key={`${tab}:${reloadKey}`}>
            {tab === 'overview' && <AdminOverviewTab stats={stats} onTab={goTab} />}
            {tab === 'servers' && <AdminServersTab onClose={onClose} />}
            {tab === 'users' && <AdminUsersTab stats={stats} />}
            {tab === 'badges' && <BadgesTab />}
            {tab === 'notices' && <SystemMessagesTab />}
            {tab === 'instance' && <AdminInstanceTab />}
            {tab === 'moderation' && <AdminModerationTab />}
            {tab === 'audit' && <AdminAuditTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
