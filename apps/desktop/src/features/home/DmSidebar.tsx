import type { Conversation, Invite } from '@opencord/contracts';
import { Avatar, Icon, STATUS_LABEL } from '@opencord/ui';
import { useMemo } from 'react';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { nameFor, togglePinnedConversation, useAliases } from '../../lib/names';
import { useData } from '../../store/data';
import { api, describeError, markTargetRead } from '../../store/session';
import { useUi } from '../../store/ui';
import { sendMessage } from '../chat/ChatView';

const NO_PINS: string[] = [];
const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

/** Convida para um servidor: gera (ou reaproveita) o meu convite e manda o link na conversa. */
async function inviteTo(serverId: string, conversationId: string) {
  try {
    const inv = await api().request<Invite>('POST', `/servers/${serverId}/invites`);
    const body = inv.url ?? `Convite para o servidor: ${inv.code}`;
    await sendMessage(`d:${conversationId}`, { conversationId }, crypto.randomUUID(), body);
  } catch (e) {
    toastError(e);
  }
}

/** Menu da conversa direta (botão direito na lista). */
function dmMenu(c: Conversation, meId: string | undefined): MenuEntry[] {
  const d = useData.getState();
  const pinned = d.settings?.pinnedConversations.includes(c.id) ?? false;
  const hasUnread = (d.unread[`d:${c.id}`]?.unreadCount ?? 0) > 0;
  const items: MenuEntry[] = [
    {
      label: 'Marcar como lida',
      icon: 'check',
      disabled: !hasUnread,
      onSelect: () => void markTargetRead(`d:${c.id}`),
    },
    'separator',
    {
      label: pinned ? 'Desafixar conversa' : 'Fixar conversa',
      icon: 'pin',
      onSelect: () => togglePinnedConversation(c.id),
    },
  ];
  const other = c.kind === 'dm' ? c.members.find((m) => m.id !== meId) : undefined;
  if (!other) return items;
  const friend = d.friends.find((f) => f.user.id === other.id);
  const name = nameFor(other.id, other.displayName);
  const alias = d.settings?.friendNicknames[other.id];
  // servidores em que a pessoa ainda não está (os que eu sei; o oficial todo mundo já tem)
  const servers = d.servers.filter((s) => !s.official && !d.details[s.id]?.members.some((m) => m.user.id === other.id));
  items.push(
    'separator',
    {
      label: 'Perfil',
      icon: 'user',
      onSelect: () => useUi.getState().openModal({ kind: 'profile', userId: other.id }),
    },
    {
      label: alias ? 'Editar apelido de amigo' : 'Adicionar apelido de amigo',
      icon: 'edit',
      hint: 'Só você vê',
      onSelect: () => useUi.getState().openModal({ kind: 'friend-nickname', userId: other.id }),
    },
  );
  if (servers.length)
    items.push({
      kind: 'submenu',
      label: 'Convidar para o servidor',
      icon: 'user-plus',
      items: servers.map((s) => ({ label: s.name, onSelect: () => void inviteTo(s.id, c.id) })),
    });
  items.push('separator');
  if (friend?.status === 'accepted')
    items.push({
      label: 'Desfazer amizade',
      icon: 'user-minus',
      onSelect: () => {
        if (!confirm(`Desfazer a amizade com ${name}?`)) return;
        void api()
          .request('DELETE', `/friends/${other.id}`)
          .then(() => useUi.getState().toast('success', 'Amizade desfeita.'), toastError);
      },
    });
  items.push({
    label: 'Bloquear',
    icon: 'block',
    danger: true,
    onSelect: () => {
      if (!confirm(`Bloquear ${name}? Vocês não poderão trocar mensagens diretas.`)) return;
      void api()
        .request('PUT', `/blocks/${other.id}`)
        .then(() => useUi.getState().toast('success', 'Usuário bloqueado.'), toastError);
    },
  });
  return items;
}

export function DmSidebar() {
  const conversations = useData((s) => s.conversations);
  const meId = useData((s) => s.me?.id);
  const unread = useData((s) => s.unread);
  const presence = useData((s) => s.presence);
  const pending = useData((s) => s.friends.reduce((n, f) => n + (f.status === 'pending_incoming' ? 1 : 0), 0));
  const pins = useData((s) => s.settings?.pinnedConversations) ?? NO_PINS;
  const aliases = useAliases();
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const openSwitcher = () => useUi.getState().openModal({ kind: 'quick-switcher' });
  // fixadas no topo (na ordem em que foram fixadas), depois as demais como vieram
  const ordered = useMemo(() => {
    const byId = new Map(conversations.map((c) => [c.id, c]));
    const top = pins.flatMap((id) => byId.get(id) ?? []);
    return [...top, ...conversations.filter((c) => !pins.includes(c.id))];
  }, [conversations, pins]);

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
          {ordered.length === 0 && <li className="muted small dm-empty">Nenhuma conversa ainda.</li>}
          {ordered.map((c) => {
            const others = c.members.filter((m) => m.id !== meId);
            const name = c.name ?? (others.map((o) => aliases?.[o.id] ?? o.displayName).join(', ') || 'Você');
            const first = others[0];
            const u = unread[`d:${c.id}`];
            const active = view.kind === 'dm' && view.conversationId === c.id;
            const status = first && c.kind === 'dm' ? (presence[first.id] ?? 'offline') : undefined;
            const pinned = pins.includes(c.id);
            return (
              <li key={c.id}>
                <button
                  className="channel-row dm-row"
                  aria-current={active ? 'page' : undefined}
                  data-unread={(u?.unreadCount ?? 0) > 0 && !active ? 'true' : undefined}
                  data-offline={status === 'offline' ? 'true' : undefined}
                  onClick={() => go({ kind: 'dm', conversationId: c.id })}
                  onContextMenu={(e) => openContextMenu(e, dmMenu(c, meId), `Opções da conversa com ${name}`)}
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
                  {pinned && <Icon name="pin" size={14} label="Conversa fixada" />}
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
