import { hasPermission, Permission, type Channel } from '@opencord/contracts';
import { Avatar, Icon } from '@opencord/ui';
import { useMemo, useState } from 'react';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { useData } from '../../store/data';
import { api, describeError, markTargetRead } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { CreatorTag, isCreator, roleColorOf } from './MemberList';
import { ProfileButton } from './ProfileButton';
import { ActivityHint } from '../voice/WatchTogether';
import { Tooltip } from '../../components/Tooltip';
import { moveToVoice } from './voiceMove';
import { CHANNEL_ICON, CHANNEL_ORDER } from '../../lib/channels';
import { useAliases } from '../../lib/names';

/** Categorias recolhidas (por id de categoria), lembradas neste dispositivo. */
const COLLAPSED_KEY = 'oc:collapsed-categories';
function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}
function saveCollapsed(c: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(c));
  } catch {
    /* armazenamento indisponível: vale só nesta sessão */
  }
}

export function ChannelSidebar({ serverId }: { serverId: string }) {
  const detail = useData((s) => s.details[serverId]);
  const unread = useData((s) => s.unread);
  const voiceStates = useData((s) => s.voiceStates);
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const open = useUi((s) => s.openModal);
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>(loadCollapsed);
  const setCollapsed = (fn: (c: Record<string, boolean>) => Record<string, boolean>) =>
    setCollapsedState((c) => {
      const next = fn(c);
      saveCollapsed(next);
      return next;
    });
  const speaking = useVoice((s) => s.participants);
  const voiceChannel = useVoice((s) => s.machine.channelId);
  const me = useData((s) => s.me?.id);
  const aliases = useAliases();
  // arrastar alguém da voz para outro canal de voz (MOVE_MEMBERS; a si mesmo, qualquer um)
  const [drag, setDrag] = useState<{ userId: string; from: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const groups = useMemo(() => {
    if (!detail) return [];
    const byCat = new Map<string | null, Channel[]>();
    for (const c of detail.channels) byCat.set(c.categoryId, [...(byCat.get(c.categoryId) ?? []), c]);
    const sortCh = (l: Channel[]) =>
      [...l].sort((a, b) => CHANNEL_ORDER[a.kind] - CHANNEL_ORDER[b.kind] || a.position - b.position);
    const out: { id: string | null; name: string | null; channels: Channel[] }[] = [];
    const loose = byCat.get(null);
    if (loose?.length) out.push({ id: null, name: null, channels: sortCh(loose) });
    for (const cat of detail.categories)
      out.push({ id: cat.id, name: cat.name, channels: sortCh(byCat.get(cat.id) ?? []) });
    return out;
  }, [detail]);

  if (!detail) return <div className="sidebar-scroll skeleton-list" aria-busy="true" />;
  const canManage = hasPermission(detail.myPermissions, Permission.MANAGE_CHANNELS);
  const speakingIds = new Set(speaking.filter((p) => p.speaking).map((p) => p.identity));
  const memberName = (id: string) => detail.members.find((m) => m.user.id === id);
  const canMove = hasPermission(detail.myPermissions, Permission.MOVE_MEMBERS);
  const canDropOn = (c: Channel) =>
    drag !== null &&
    c.kind === 'voice' &&
    c.id !== drag.from &&
    hasPermission(c.myPermissions, Permission.CONNECT) &&
    (drag.userId === me || canMove);

  return (
    <>
      <header className="sidebar-header">
        <button
          className="server-name"
          onClick={() => open({ kind: 'server-settings', serverId })}
          data-tip="Configurações do servidor"
        >
          {(detail.official || detail.verified) && (
            <span
              className="verified-badge"
              data-tip={detail.official ? 'Servidor oficial verificado' : 'Servidor verificado'}
            >
              <Icon
                name="verified"
                size={16}
                active
                label={detail.official ? 'Servidor oficial verificado' : 'Servidor verificado'}
              />
            </span>
          )}
          <span className="truncate">{detail.name}</span>
          <Icon name="chevron-down" size={16} />
        </button>
        <Tooltip label="Convidar pessoas">
          <button
            className="icon-btn sidebar-invite"
            aria-label="Convidar pessoas"
            onClick={() => open({ kind: 'invite', serverId })}
          >
            <Icon name="user-plus" size={18} />
          </button>
        </Tooltip>
      </header>
      <div
        className="sidebar-scroll"
        // botão direito no espaço livre da lista (fora de canais/categorias): criar canal ou categoria
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.channel-row, .cat-header, .voice-member')) return;
          const items: MenuEntry[] = [];
          if (canManage)
            items.push(
              {
                label: 'Criar canal',
                icon: 'hashtag',
                onSelect: () => open({ kind: 'create-channel', serverId, channelKind: 'text', categoryId: null }),
              },
              { label: 'Criar categoria', icon: 'folder', onSelect: () => open({ kind: 'create-category', serverId }) },
              'separator',
            );
          items.push(
            {
              label: 'Expandir todas as categorias',
              icon: 'chevron-down',
              onSelect: () => setCollapsed(() => ({})),
            },
            {
              label: 'Recolher todas as categorias',
              icon: 'chevron-right',
              onSelect: () =>
                setCollapsed(() => Object.fromEntries(groups.filter((g) => g.id).map((g) => [g.id as string, true]))),
            },
          );
          openContextMenu(e, items, 'Opções da lista de canais');
        }}
      >
        {groups.map((g) => (
          <section key={g.id ?? 'none'} className="cat">
            {g.name && (
              <div className="cat-header">
                <button
                  className="cat-toggle"
                  aria-expanded={!collapsed[g.id as string]}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.id as string]: !c[g.id as string] }))}
                >
                  <Icon name={collapsed[g.id as string] ? 'chevron-right' : 'chevron-down'} size={12} />
                  <span className="truncate">{g.name}</span>
                </button>
                {canManage && (
                  <button
                    className="icon-btn icon-btn-sm"
                    aria-label={`Criar canal em ${g.name}`}
                    data-tip="Criar canal"
                    onClick={() => open({ kind: 'create-channel', serverId, channelKind: 'text', categoryId: g.id })}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                )}
              </div>
            )}
            <ul className="channel-list">
              {g.channels.map((c) => {
                const active = view.kind === 'server' && view.channelId === c.id;
                const u = unread[`c:${c.id}`];
                const hasUnread = (u?.unreadCount ?? 0) > 0;
                // recolhida: some tudo, menos o canal aberto, os não lidos e a voz em que estou conectado
                const keep = active || hasUnread || (c.kind === 'voice' && voiceChannel === c.id);
                if (collapsed[g.id as string] && !keep) return null;
                const inVoice = Object.values(voiceStates).filter((v) => v.channelId === c.id);
                return (
                  <li
                    key={c.id}
                    data-drop-target={dropOn === c.id ? 'true' : undefined}
                    onDragOver={(e) => {
                      if (!canDropOn(c)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropOn !== c.id) setDropOn(c.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (drag && canDropOn(c)) moveToVoice(drag.userId, serverId, c.id);
                      setDrag(null);
                      setDropOn(null);
                    }}
                  >
                    <button
                      className="channel-row"
                      aria-current={active ? 'page' : undefined}
                      data-unread={hasUnread && !active ? 'true' : undefined}
                      onContextMenu={(e) =>
                        openContextMenu(
                          e,
                          [
                            ...(c.kind === 'text'
                              ? [
                                  {
                                    label: 'Marcar como lido',
                                    icon: 'check' as const,
                                    disabled: !hasUnread,
                                    onSelect: () => void markTargetRead(`c:${c.id}`),
                                  },
                                ]
                              : c.kind === 'board'
                                ? []
                                : [
                                    {
                                      label: 'Entrar no canal de voz',
                                      icon: 'speaker' as const,
                                      onSelect: () => void useVoice.getState().join(c.id, serverId),
                                    },
                                  ]),
                            ...(canManage
                              ? ([
                                  'separator',
                                  {
                                    label: 'Editar canal',
                                    icon: 'edit' as const,
                                    onSelect: () => open({ kind: 'server-settings', serverId, tab: 'channels' }),
                                  },
                                  {
                                    label: 'Excluir canal',
                                    icon: 'trash' as const,
                                    danger: true,
                                    onSelect: () => {
                                      if (confirm(`Excluir o canal "${c.name}"? Esta ação não pode ser desfeita.`))
                                        void api()
                                          .request('DELETE', `/channels/${c.id}`)
                                          .catch((err: unknown) => useUi.getState().toast('error', describeError(err)));
                                    },
                                  },
                                ] as const)
                              : []),
                          ],
                          `Opções do canal ${c.name}`,
                        )
                      }
                      onClick={() => {
                        go({ kind: 'server', serverId, channelId: c.id });
                        // clique em canal de voz conecta; em texto apenas navega (sem sair da voz)
                        if (c.kind === 'voice' && voiceChannel !== c.id) void useVoice.getState().join(c.id, serverId);
                      }}
                    >
                      <Icon name={CHANNEL_ICON[c.kind]} size={18} />
                      <span className="truncate">{c.name}</span>
                      {!hasPermission(c.myPermissions, Permission.SEND_MESSAGES) && c.kind === 'text' && (
                        <Icon name="lock" size={14} label="Somente leitura" />
                      )}
                      {(u?.mentionCount ?? 0) > 0 && <span className="badge badge-inline">{u?.mentionCount}</span>}
                    </button>
                    {c.kind === 'voice' && <ActivityHint channelId={c.id} />}
                    {c.kind === 'voice' && inVoice.length > 0 && (
                      <ul className="voice-members" aria-label={`Pessoas em ${c.name}`}>
                        {inVoice.map((v) => {
                          const m = memberName(v.userId);
                          const name = aliases?.[v.userId] ?? m?.nickname ?? m?.user.displayName ?? 'Alguém';
                          const draggable = v.userId === me || canMove;
                          const creator = isCreator(detail, v.userId);
                          return (
                            <li
                              key={v.userId}
                              data-creator={creator ? 'true' : undefined}
                              draggable={draggable || undefined}
                              data-dragging={drag?.userId === v.userId ? 'true' : undefined}
                              onDragStart={(e) => {
                                if (!draggable) return;
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', name);
                                setDrag({ userId: v.userId, from: c.id });
                              }}
                              onDragEnd={() => {
                                setDrag(null);
                                setDropOn(null);
                              }}
                            >
                              <ProfileButton userId={v.userId} serverId={serverId} className="voice-member">
                                <Avatar id={v.userId} name={name} size={22} speaking={speakingIds.has(v.userId)} />
                                <span className="truncate" style={{ color: roleColorOf(detail, m) }}>
                                  {name}
                                </span>
                                {creator && <CreatorTag />}
                                {v.streaming && <span className="live-pill">AO VIVO</span>}
                                {v.video && <Icon name="camera" size={14} label="Câmera ligada" />}
                                {(v.selfMute || v.serverMute) && (
                                  <Icon
                                    name="microphone"
                                    size={14}
                                    slashed
                                    label={v.serverMute ? 'Silenciado pelo servidor' : 'Microfone desligado'}
                                  />
                                )}
                                {v.selfDeaf && <Icon name="speaker-off" size={14} label="Áudio desligado" />}
                              </ProfileButton>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
