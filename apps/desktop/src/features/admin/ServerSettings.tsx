import { hasPermission, MAX_SERVER_EMOJIS, Permission, type ServerDetail, type Me } from '@opencord/contracts';
import { Avatar, Icon, type IconName } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { ServerIcon } from '../../components/ServerIcon';
import { Tooltip } from '../../components/Tooltip';
import { useData } from '../../store/data';
import { loadServer } from '../../store/session';
import { useUi } from '../../store/ui';
import '../settings/settings.css';
import './admin.css';
import './server-settings.css';
import { nf } from './adminKit';
import { SoundsTab } from '../voice/Soundboard';
import { BansTab } from './BansTab';
import { ModerationTab } from './ModerationTab';
import { ServerBotsTab } from './ServerBotsTab';
import { SlackTab } from './SlackTab';
import { WebhooksTab } from './WebhooksTab';
import { EngagementTab } from './ServerProfile';
import { InvitesTab } from './InvitesTab';
import { ChannelsTab } from './ChannelsTab';
import { EmojisTab } from './EmojisTab';
import { sortRoles, toastError } from './serverSettingsKit';
import { OverviewTab, ServerThemeSection } from './ServerOverviewTab';
import { RolesTab } from './ServerRolesTab';
import { MembersTab } from './ServerMembersTab';
import { AuditTab } from './ServerAuditTab';

type ServerTab =
  | 'overview'
  | 'theme'
  | 'engagement'
  | 'invites'
  | 'emojis'
  | 'roles'
  | 'members'
  | 'channels'
  | 'webhooks'
  | 'bots'
  | 'slack'
  | 'sounds'
  | 'moderation'
  | 'bans'
  | 'audit';

/** abas com tabela ou lista + painel: usam a coluna larga */
const WIDE_TABS = new Set<ServerTab>(['channels', 'members', 'roles', 'invites', 'audit', 'bans']);

interface NavItem {
  id: ServerTab;
  label: string;
  icon: IconName;
  description: string;
  /** quem pode ver a aba; sem = qualquer membro */
  perm?: number;
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Servidor',
    items: [
      {
        id: 'overview',
        label: 'Perfil do servidor',
        icon: 'server',
        description: 'Nome, imagem, faixa, descrição e marcas: como o servidor aparece para quem entra e no convite.',
      },
      {
        id: 'theme',
        label: 'Tema do servidor',
        icon: 'image',
        perm: Permission.MANAGE_SERVER,
        description: 'Cor de destaque e papel de parede para todo mundo enquanto o servidor está aberto.',
      },
      {
        id: 'engagement',
        label: 'Engajamento',
        icon: 'bell',
        perm: Permission.MANAGE_SERVER,
        description: 'Avisos de entrada, notificações padrão, canal de ausentes e fundo do convite.',
      },
      {
        id: 'channels',
        label: 'Canais',
        icon: 'hashtag',
        perm: Permission.MANAGE_CHANNELS,
        description: 'Organize canais e categorias, quem vê cada um e os quadros ligados.',
      },
    ],
  },
  {
    label: 'Expressões',
    items: [
      {
        id: 'emojis',
        label: 'Emoji',
        icon: 'emoji',
        description: 'Emojis do servidor, animados para todo mundo. No chat, escreva :nome:.',
      },
      {
        id: 'sounds',
        label: 'Efeitos sonoros',
        icon: 'soundboard',
        description: 'Sons que tocam para quem está no canal de voz.',
      },
    ],
  },
  {
    label: 'Pessoas',
    items: [
      {
        id: 'members',
        label: 'Membros',
        icon: 'users',
        description: 'Quem está no servidor, os cargos de cada um e o convite que usou para entrar.',
      },
      {
        id: 'roles',
        label: 'Cargos',
        icon: 'tag',
        perm: Permission.MANAGE_ROLES,
        description: 'Cargos dão cor ao nome e definem o que cada pessoa pode fazer.',
      },
      {
        id: 'invites',
        label: 'Convites',
        icon: 'link',
        perm: Permission.MANAGE_SERVER,
        description: 'Links de entrada com validade e limite de usos. Dá para pausar todos de uma vez.',
      },
    ],
  },
  {
    label: 'Apps',
    items: [
      {
        id: 'webhooks',
        label: 'Webhooks',
        icon: 'send',
        perm: Permission.MANAGE_CHANNELS,
        description: 'Links secretos que outros serviços usam para postar mensagens num canal.',
      },
      {
        id: 'bots',
        label: 'Bots',
        icon: 'grid',
        perm: Permission.MANAGE_SERVER,
        description: 'Bots que são membros deste servidor.',
      },
      {
        id: 'slack',
        label: 'Slack',
        icon: 'chats',
        perm: Permission.MANAGE_SERVER,
        description: 'Ligue um canal de texto a um canal do Slack: as mensagens passam nos dois sentidos.',
      },
    ],
  },
  {
    label: 'Moderação',
    items: [
      {
        id: 'moderation',
        label: 'Moderação',
        icon: 'shield',
        perm: Permission.MODERATE_MEMBERS,
        description: 'Regras que a moderação por IA leva em conta e os envios retidos esperando decisão.',
      },
      {
        id: 'bans',
        label: 'Banidos',
        icon: 'block',
        perm: Permission.BAN_MEMBERS,
        description: 'Quem não pode voltar ao servidor, por quem e por quê.',
      },
      {
        id: 'audit',
        label: 'Registro de auditoria',
        icon: 'clock',
        perm: Permission.VIEW_AUDIT_LOG,
        description: 'O que foi feito no servidor, por quem e quando.',
      },
    ],
  },
];

export function ServerSettings({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const detail = useData((s) => s.details[serverId]);
  const me = useData((s) => s.me);

  useEffect(() => {
    if (!detail) void loadServer(serverId).catch(toastError);
  }, [detail, serverId]);

  if (!detail || !me) {
    return (
      <Dialog title="Configurações do servidor" onClose={onClose} fullscreen>
        <p className="muted">Carregando…</p>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={`Configurações — ${detail.name}`}
      onClose={onClose}
      fullscreen
      hideClose
      className="adm-dialog srv-dialog"
    >
      <ServerSettingsDashboard detail={detail} me={me} onClose={onClose} />
    </Dialog>
  );
}

/**
 * Configurações do servidor no mesmo formato do painel admin (ADR-0050): barra lateral com o servidor, seções
 * agrupadas com ícone e contador, topo com título e descrição da seção, e o conteúdo em cartões.
 */
function ServerSettingsDashboard({ detail, me, onClose }: { detail: ServerDetail; me: Me; onClose: () => void }) {
  const initial = useUi((s) => (s.modal?.kind === 'server-settings' ? s.modal.tab : undefined));
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((it) => it.perm === undefined || hasPermission(detail.myPermissions, it.perm)),
      })).filter((g) => g.items.length > 0),
    [detail.myPermissions],
  );
  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [tab, setTab] = useState<ServerTab>((initial as ServerTab | undefined) ?? 'overview');
  const contentRef = useRef<HTMLDivElement>(null);

  // o <dialog> foca o primeiro botão ao abrir; o foco vai para a seção aberta
  const initialTab = useRef(tab);
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(`srv-nav-${initialTab.current}`)?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const current = items.find((i) => i.id === tab) ?? items[0]!;
  const active = current.id;
  const group = groups.find((g) => g.items.includes(current))?.label;
  const isOwner = detail.ownerId === me.id;

  const goTab = (t: ServerTab) => {
    setTab(t);
    contentRef.current?.scrollTo({ top: 0 });
  };

  const channelCount = detail.channels.filter((c) => !c.temporary).length;
  const counts: Partial<Record<ServerTab, string>> = {
    channels: nf(channelCount),
    emojis: `${detail.emojis?.length ?? 0}/${MAX_SERVER_EMOJIS}`,
    members: nf(detail.members.length),
    roles: nf(detail.roles.length),
  };

  const myMember = detail.members.find((m) => m.user.id === me.id);
  const topRole = sortRoles(detail.roles).find((r) => !r.isEveryone && myMember?.roleIds.includes(r.id));
  const myRole = isOwner ? 'Dono do servidor' : (topRole?.name ?? 'Membro');

  /** ↑/↓/Home/End entre as seções da barra lateral */
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = items.findIndex((t) => t.id === active);
    const next =
      e.key === 'ArrowDown'
        ? items[(i + 1) % items.length]
        : e.key === 'ArrowUp'
          ? items[(i - 1 + items.length) % items.length]
          : e.key === 'Home'
            ? items[0]
            : e.key === 'End'
              ? items[items.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    goTab(next.id);
    document.getElementById(`srv-nav-${next.id}`)?.focus();
  };

  return (
    <div className="adm-shell">
      <aside className="adm-side">
        <div className="adm-brand">
          <span className="srv-brand-icon" aria-hidden>
            <ServerIcon name={detail.name} iconKey={detail.iconKey} official={detail.official} />
          </span>
          <span className="adm-brand-text">
            <strong className="truncate">{detail.name}</strong>
            <span>Configurações</span>
          </span>
        </div>
        <nav className="adm-nav" aria-label="Seções do servidor" onKeyDown={onNavKey}>
          {groups.map((g) => (
            <div key={g.label} className="adm-nav-group">
              <p className="adm-nav-label">{g.label}</p>
              <ul>
                {g.items.map((it) => {
                  const on = it.id === active;
                  const c = counts[it.id];
                  return (
                    <li key={it.id}>
                      <button
                        id={`srv-nav-${it.id}`}
                        type="button"
                        className="adm-nav-item"
                        aria-current={on ? 'page' : undefined}
                        onClick={() => goTab(it.id)}
                      >
                        <Icon name={it.icon} size={18} active={on} />
                        <span className="adm-nav-text">{it.label}</span>
                        {c && <span className="adm-nav-count">{c}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="adm-side-foot">
          <div className="adm-me">
            <Avatar id={me.id} name={me.displayName} size={32} status="online" />
            <span className="adm-me-text">
              <strong className="truncate">{myMember?.nickname ?? me.displayName}</strong>
              <span className="muted small truncate">{myRole}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="adm-main">
        <header className="adm-top">
          <div className="adm-top-titles">
            <p className="adm-crumb">
              {detail.name}
              {group ? ` · ${group}` : ''}
            </p>
            <h2>{current.label}</h2>
            <p className="muted small adm-top-desc">{current.description}</p>
          </div>
          <div className="adm-top-actions">
            <Tooltip label="Fechar (Esc)" side="bottom">
              <button
                type="button"
                className="adm-close"
                aria-label="Fechar configurações do servidor (Esc)"
                onClick={onClose}
              >
                <Icon name="close" size={18} />
              </button>
            </Tooltip>
          </div>
        </header>
        <div className="adm-content" ref={contentRef} aria-label={current.label} role="region">
          <div
            className="adm-content-inner srv-content"
            data-wide={WIDE_TABS.has(active) ? 'true' : undefined}
            key={active}
          >
            {active === 'overview' && <OverviewTab detail={detail} isOwner={isOwner} onClose={onClose} />}
            {active === 'theme' && <ServerThemeSection detail={detail} />}
            {active === 'engagement' && <EngagementTab detail={detail} />}
            {active === 'roles' && <RolesTab detail={detail} />}
            {active === 'invites' && <InvitesTab detail={detail} />}
            {active === 'emojis' && <EmojisTab detail={detail} />}
            {active === 'members' && <MembersTab detail={detail} myId={me.id} />}
            {active === 'channels' && <ChannelsTab detail={detail} />}
            {active === 'webhooks' && <WebhooksTab detail={detail} />}
            {active === 'bots' && <ServerBotsTab detail={detail} />}
            {active === 'slack' && <SlackTab detail={detail} />}
            {active === 'sounds' && (
              <SoundsTab
                serverId={detail.id}
                myId={me.id}
                canManage={hasPermission(detail.myPermissions, Permission.MANAGE_SERVER)}
              />
            )}
            {active === 'moderation' && <ModerationTab detail={detail} />}
            {active === 'bans' && <BansTab detail={detail} />}
            {active === 'audit' && <AuditTab detail={detail} />}
          </div>
        </div>
      </div>
    </div>
  );
}
