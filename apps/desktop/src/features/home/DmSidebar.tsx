import { Avatar, Icon, STATUS_LABEL } from '@opencord/ui';
import { Tooltip } from '../../components/Tooltip';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';

export function DmSidebar() {
  const conversations = useData((s) => s.conversations);
  const meId = useData((s) => s.me?.id);
  const unread = useData((s) => s.unread);
  const presence = useData((s) => s.presence);
  const pending = useData((s) => s.friends.reduce((n, f) => n + (f.status === 'pending_incoming' ? 1 : 0), 0));
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const openSwitcher = () => useUi.getState().openModal({ kind: 'quick-switcher' });

  return (
    <>
      <header className="sidebar-header sidebar-search">
        <button className="search-trigger" onClick={openSwitcher}>
          Buscar ou iniciar conversa
        </button>
      </header>
      <div className="sidebar-scroll">
        <nav className="dm-nav" aria-label="Início">
          <button
            className="channel-row nav-row"
            aria-current={view.kind === 'home' && view.tab === 'news' ? 'page' : undefined}
            onClick={() => go({ kind: 'home', tab: 'news' })}
          >
            <Icon name="bell" size={22} />
            <span>Novidades</span>
          </button>
          <button
            className="channel-row nav-row"
            aria-current={view.kind === 'home' && view.tab === 'friends' ? 'page' : undefined}
            onClick={() => go({ kind: 'home', tab: 'friends' })}
          >
            <Icon name="users" size={22} />
            <span>Amigos</span>
            {pending > 0 && <span className="badge badge-inline">{pending}</span>}
          </button>
        </nav>
        <div className="section-header">
          <span>Mensagens diretas</span>
          <Tooltip label="Nova mensagem direta">
            <button className="icon-btn icon-btn-sm" aria-label="Nova mensagem direta" onClick={openSwitcher}>
              <Icon name="plus" size={16} />
            </button>
          </Tooltip>
        </div>
        <ul className="channel-list dm-list" aria-label="Conversas">
          {conversations.length === 0 && <li className="muted small dm-empty">Nenhuma conversa ainda.</li>}
          {conversations.map((c) => {
            const others = c.members.filter((m) => m.id !== meId);
            const name = c.name ?? (others.map((o) => o.displayName).join(', ') || 'Você');
            const first = others[0];
            const u = unread[`d:${c.id}`];
            const active = view.kind === 'dm' && view.conversationId === c.id;
            const status = first && c.kind === 'dm' ? (presence[first.id] ?? 'offline') : undefined;
            return (
              <li key={c.id}>
                <button
                  className="channel-row dm-row"
                  aria-current={active ? 'page' : undefined}
                  data-unread={(u?.unreadCount ?? 0) > 0 && !active ? 'true' : undefined}
                  data-offline={status === 'offline' ? 'true' : undefined}
                  onClick={() => go({ kind: 'dm', conversationId: c.id })}
                >
                  {first ? (
                    <Avatar id={first.id} name={first.displayName} size={32} status={status} />
                  ) : (
                    <Icon name="group" size={32} />
                  )}
                  <span className="dm-names">
                    <span className="truncate">{name}</span>
                    {c.kind === 'group' ? (
                      <span className="muted small">{c.members.length} membros</span>
                    ) : status && status !== 'offline' ? (
                      <span className="muted small">{STATUS_LABEL[status]}</span>
                    ) : null}
                  </span>
                  {(u?.unreadCount ?? 0) > 0 && !active && <span className="badge badge-inline">{u?.unreadCount}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
