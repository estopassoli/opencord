import type { ServerSummary } from '@opencord/contracts';
import { Avatar, Icon } from '@opencord/ui';
import { useShallow } from 'zustand/react/shallow';
import { ServerIcon } from '../../components/ServerIcon';
import type { ReactNode } from 'react';
import { openContextMenu } from '../../components/ContextMenu';
import { DownloadAppRailItem } from '../../components/DownloadApp';
import { Tooltip } from '../../components/Tooltip';
import { useData } from '../../store/data';
import { markServerRead } from '../../store/session';
import { useUi } from '../../store/ui';

/**
 * Item do rail com pílula indicadora à esquerda:
 * ponto quando há não lidas, média no hover/foco e alta quando ativo.
 */
function RailItem({
  label,
  active,
  unread,
  badge,
  card,
  variant,
  onClick,
  onContextMenu,
  children,
}: {
  label: string;
  active?: boolean;
  unread?: boolean;
  badge?: number;
  /** conteúdo rico do tooltip (cartão do servidor); sem ele, o tooltip é só o nome */
  card?: ReactNode;
  variant?: 'home' | 'action';
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <li
      className="rail-li"
      data-active={active ? 'true' : undefined}
      data-unread={unread && !active ? 'true' : undefined}
    >
      <span className="rail-pill" aria-hidden />
      <Tooltip label={card ?? label} side="right">
        <button
          className={variant ? `rail-item rail-${variant}` : 'rail-item'}
          aria-current={active ? 'page' : undefined}
          aria-label={badge ? `${label}, ${badge} menções` : label}
          onClick={onClick}
          onContextMenu={onContextMenu}
        >
          {children}
          {badge ? (
            <span className="badge" aria-hidden>
              {badge > 99 ? '99+' : badge}
            </span>
          ) : null}
        </button>
      </Tooltip>
    </li>
  );
}

export function ServerRail() {
  const servers = useData((s) => s.servers);
  const unread = useData((s) => s.unread);
  const details = useData((s) => s.details);
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const open = useUi((s) => s.openModal);
  const isAdmin = useData((s) => Boolean(s.me?.isInstanceAdmin));
  const homeActive = view.kind === 'home' || view.kind === 'dm';
  const dmUnread = Object.values(unread).reduce((n, u) => n + (u.conversationId ? u.unreadCount : 0), 0);

  const serverBadge = (serverId: string) => {
    let mentions = 0;
    let any = false;
    for (const c of details[serverId]?.channels ?? []) {
      const u = unread[`c:${c.id}`];
      if (u) {
        mentions += u.mentionCount;
        if (u.unreadCount > 0) any = true;
      }
    }
    return { mentions, any };
  };

  return (
    <nav className="rail" aria-label="Servidores">
      <ul className="rail-list">
        <RailItem
          label="Mensagens diretas"
          variant="home"
          active={homeActive}
          unread={dmUnread > 0}
          badge={dmUnread}
          onClick={() => go({ kind: 'home', tab: 'friends' }, { keepPanel: true })}
        >
          <span className="brand-mark brand-mark-sm" aria-hidden />
        </RailItem>
        <li className="rail-sep" role="separator" />
        {servers.map((s) => {
          const active = view.kind === 'server' && view.serverId === s.id;
          const b = serverBadge(s.id);
          return (
            <RailItem
              key={s.id}
              label={s.name}
              card={<ServerHoverCard server={s} />}
              active={active}
              unread={b.any}
              badge={b.mentions}
              onClick={() =>
                go(
                  { kind: 'server', serverId: s.id, channelId: useUi.getState().lastChannel[s.id] ?? null },
                  { keepPanel: true },
                )
              }
              onContextMenu={(e) =>
                openContextMenu(
                  e,
                  [
                    {
                      label: 'Marcar como lido',
                      icon: 'check',
                      disabled: !b.any,
                      onSelect: () => void markServerRead(s.id),
                    },
                    {
                      label: 'Convidar pessoas',
                      icon: 'user-plus',
                      onSelect: () => open({ kind: 'invite', serverId: s.id }),
                    },
                    'separator',
                    {
                      label: 'Configurações do servidor',
                      icon: 'settings',
                      onSelect: () => open({ kind: 'server-settings', serverId: s.id }),
                    },
                  ],
                  `Opções de ${s.name}`,
                )
              }
            >
              <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
            </RailItem>
          );
        })}
        <RailItem label="Criar um servidor" variant="action" onClick={() => open({ kind: 'create-server' })}>
          <Icon name="plus" />
        </RailItem>
        <RailItem label="Explorar servidores" variant="action" onClick={() => open({ kind: 'explore-servers' })}>
          <Icon name="search" />
        </RailItem>
        {isAdmin && (
          <RailItem label="Painel admin" variant="action" onClick={() => open({ kind: 'admin' })}>
            <Icon name="shield" />
          </RailItem>
        )}
        <DownloadAppRailItem />
      </ul>
    </nav>
  );
}

/**
 * Cartão ao passar o mouse num servidor: imagem, nome (com selo) e quem está em voz agora, com o canal e se há live.
 * Os avatares vêm do estado de voz que o app já recebe em tempo real.
 */
function ServerHoverCard({ server }: { server: ServerSummary }) {
  const inVoice = useData(useShallow((st) => Object.values(st.voiceStates).filter((v) => v.serverId === server.id)));
  const detail = useData((st) => st.details[server.id]);
  const nameOf = (id: string) => {
    const m = detail?.members.find((x) => x.user.id === id);
    return m?.nickname ?? m?.user.displayName ?? '?';
  };
  const channels = new Set(inVoice.map((v) => v.channelId));
  const firstChannel = detail?.channels.find((c) => channels.has(c.id))?.name;
  const live = inVoice.some((v) => v.streaming);
  return (
    <span className="server-card">
      <span className="server-card-head">
        <span className="server-card-icon" aria-hidden="true">
          <ServerIcon name={server.name} iconKey={server.iconKey} official={server.official} />
        </span>
        <strong className="truncate">{server.name}</strong>
        {(server.official || server.verified) && <Icon name="verified" size={14} active label="Verificado" />}
      </span>
      {inVoice.length > 0 && (
        <span className="server-card-voice">
          <Icon name="speaker" size={16} label="Em voz" />
          <span className="server-card-avatars">
            {inVoice.slice(0, 6).map((v) => (
              <Avatar key={v.userId} id={v.userId} name={nameOf(v.userId)} size={24} />
            ))}
            {inVoice.length > 6 && <span className="server-card-more">+{inVoice.length - 6}</span>}
          </span>
          {live && <span className="live-pill">AO VIVO</span>}
        </span>
      )}
      {inVoice.length > 0 && (
        <span className="server-card-sub">
          {inVoice.length} em voz
          {channels.size === 1 && firstChannel
            ? ` · ${firstChannel}`
            : channels.size > 1
              ? ` · ${channels.size} canais`
              : ''}
        </span>
      )}
    </span>
  );
}
