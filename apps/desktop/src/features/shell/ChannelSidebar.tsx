import { askConfirm } from '../../components/AskDialog';
import { hasPermission, Permission, type Channel } from '@opencord/contracts';
import { Avatar, Icon } from '@opencord/ui';
import { useMemo, useState } from 'react';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { useData } from '../../store/data';
import { whenLabel } from '../../lib/when';
import { api, describeError, loadServer, markTargetRead } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { CreatorTag, VerifiedTag, roleColorOf, useCreatorId } from './MemberList';
import { UserBadges } from '../../components/UserBadges';
import { ProfileButton } from './ProfileButton';
import { MusicHint } from '../voice/MusicPlayer';
import { Tooltip } from '../../components/Tooltip';
import { moveToVoice } from './voiceMove';
import { CallTimer } from './CallTimer';
import { CHANNEL_ICON, CHANNEL_ORDER } from '../../lib/channels';
import { useBannerStyle } from '../../lib/serverBanner';
import { useAliases } from '../../lib/names';
import { useIsMobile } from '../../lib/media';
import { GameBadge } from './Playing';
import { createLockedRoom, isLockedRoom, isPrivateChannel, knockRoom, roomMenuItems } from './rooms';

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
  const banner = useBannerStyle(detail);
  const unread = useData((s) => s.unread);
  const voiceStates = useData((s) => s.voiceStates);
  const view = useUi((s) => s.view);
  const go = useUi((s) => s.go);
  const open = useUi((s) => s.openModal);
  const eventCount = useData((s) => s.events[serverId]?.length ?? 0);
  const nextEvent = useData((s) => s.events[serverId]?.[0]);
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
  const mobile = useIsMobile();
  const creatorId = useCreatorId(detail);
  // arrastar alguém da voz para outro canal de voz (MOVE_MEMBERS; a si mesmo, qualquer um)
  const [drag, setDrag] = useState<{ userId: string; from: string } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  // arrastar um canal para mudar a ordem ou a categoria (MANAGE_CHANNELS); só entre canais do mesmo tipo
  const [chDrag, setChDrag] = useState<Channel | null>(null);
  const [chDrop, setChDrop] = useState<{ cat: string | null; id: string | null; after: boolean } | null>(null);

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
  const canDropChannel = (c: Channel) =>
    chDrag !== null && c.kind === chDrag.kind && !c.temporary && c.id !== chDrag.id;
  const endChannelDrag = () => {
    setChDrag(null);
    setChDrop(null);
  };
  /** solta o canal arrastado: antes/depois de outro canal, ou no fim da categoria */
  const dropChannel = () => {
    const target = chDrop;
    const moving = chDrag;
    endChannelDrag();
    if (!target || !moving) return;
    const from = groups.find((g) => g.channels.some((x) => x.id === moving.id));
    const to = groups.find((g) => g.id === target.cat);
    if (!from || !to) return;
    // o canal leva junto as salas temporárias logo abaixo dele (criador de salas)
    const start = from.channels.findIndex((x) => x.id === moving.id);
    let end = start + 1;
    while (from.channels[end]?.temporary) end++;
    const block = from.channels.slice(start, end);
    const rest = to.channels.filter((x) => !block.includes(x));
    let at = rest.length;
    if (target.id) {
      at = rest.findIndex((x) => x.id === target.id);
      if (at < 0) return;
      if (target.after) {
        at++;
        while (rest[at]?.temporary) at++;
      }
    }
    const next = [...rest.slice(0, at), ...block, ...rest.slice(at)].sort(
      (a, b) => CHANNEL_ORDER[a.kind] - CHANNEL_ORDER[b.kind],
    );
    if (from === to && next.every((x, i) => x.id === to.channels[i]?.id)) return;
    const pos = new Map(next.map((x, i) => [x.id, i]));
    useData.setState((st) => {
      const d = st.details[serverId];
      if (!d) return {};
      const channels = d.channels.map((x) =>
        pos.has(x.id) ? { ...x, position: pos.get(x.id)!, categoryId: target.cat } : x,
      );
      return { details: { ...st.details, [serverId]: { ...d, channels } } };
    });
    api()
      .request('PUT', `/servers/${serverId}/channels/order`, {
        categoryId: target.cat,
        channelIds: next.map((x) => x.id),
      })
      .catch((err: unknown) => {
        useUi.getState().toast('error', describeError(err));
        void loadServer(serverId).catch(() => undefined);
      });
  };

  return (
    <>
      <header
        className="sidebar-header"
        data-banner={banner ? 'true' : undefined}
        // faixa do servidor (ADR-0050): cor ou imagem atrás do nome
        style={banner ?? undefined}
      >
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
        {!mobile && (
          <Tooltip label="Esconder canais">
            <button
              className="icon-btn sidebar-invite"
              aria-label="Esconder canais"
              onClick={() => useUi.getState().setChannelsHidden(true)}
            >
              <Icon name="panel-close" size={18} />
            </button>
          </Tooltip>
        )}
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
        <button
          className="channel-row events-row"
          onClick={() => open({ kind: 'events', serverId })}
          aria-label={eventCount ? `Eventos: ${eventCount} marcados` : 'Eventos'}
        >
          <Icon name="calendar" size={18} />
          <span className="truncate">Eventos</span>
          {nextEvent && (
            <span className="events-next truncate" data-tip={nextEvent.title}>
              {new Date(nextEvent.startsAt).getTime() <= Date.now() ? 'agora' : whenLabel(nextEvent.startsAt)}
            </span>
          )}
          {eventCount > 0 && <span className="events-count">{eventCount}</span>}
        </button>
        <button className="channel-row events-row" onClick={() => open({ kind: 'highlights', serverId })}>
          <Icon name="trophy" size={18} />
          <span className="truncate">Melhores momentos</span>
        </button>
        {groups.map((g) => (
          <section key={g.id ?? 'none'} className="cat">
            {g.name && (
              <div
                className="cat-header"
                data-drop-target={chDrop && chDrop.cat === g.id && !chDrop.id ? 'true' : undefined}
                onDragOver={(e) => {
                  if (!chDrag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (chDrop?.cat !== g.id || chDrop.id) setChDrop({ cat: g.id, id: null, after: true });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropChannel();
                }}
              >
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
                    data-drop-line={chDrop?.id === c.id ? (chDrop.after ? 'after' : 'before') : undefined}
                    data-dragging={chDrag?.id === c.id ? 'true' : undefined}
                    onDragOver={(e) => {
                      if (chDrag) {
                        if (!canDropChannel(c)) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const row = e.currentTarget.firstElementChild?.getBoundingClientRect();
                        const after = row ? e.clientY > row.top + row.height / 2 : false;
                        if (chDrop?.id !== c.id || chDrop.after !== after) setChDrop({ cat: g.id, id: c.id, after });
                        return;
                      }
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
                      if (chDrag) return dropChannel();
                      if (drag && canDropOn(c)) moveToVoice(drag.userId, serverId, c.id);
                      setDrag(null);
                      setDropOn(null);
                    }}
                  >
                    <button
                      className="channel-row"
                      draggable={canManage && !c.temporary ? true : undefined}
                      onDragStart={(e) => {
                        if (!canManage || c.temporary) return;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', c.name);
                        setChDrag(c);
                      }}
                      onDragEnd={endChannelDrag}
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
                                    ...(c.roomHub && hasPermission(c.myPermissions, Permission.CONNECT)
                                      ? [
                                          {
                                            label: 'Criar sala trancada…',
                                            icon: 'lock' as const,
                                            hint: 'Só quem você convidar entra',
                                            onSelect: () => void createLockedRoom(c),
                                          },
                                        ]
                                      : []),
                                  ]),
                            ...roomMenuItems(detail, c, me),
                            ...(canManage
                              ? ([
                                  'separator',
                                  {
                                    label: 'Editar canal',
                                    icon: 'edit' as const,
                                    onSelect: () => open({ kind: 'server-settings', serverId, tab: 'channels' }),
                                  },
                                  ...(c.kind === 'voice' && !c.temporary
                                    ? [
                                        {
                                          label: 'Criador de salas temporárias',
                                          icon: 'plus-circle' as const,
                                          hint: 'Entrar cria uma sala só sua',
                                          checked: c.roomHub,
                                          onSelect: () =>
                                            void api()
                                              .request('PATCH', `/channels/${c.id}`, { roomHub: !c.roomHub })
                                              .catch((err: unknown) =>
                                                useUi.getState().toast('error', describeError(err)),
                                              ),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: 'Excluir canal',
                                    icon: 'trash' as const,
                                    danger: true,
                                    onSelect: async () => {
                                      if (
                                        await askConfirm(
                                          `O canal "${c.name}" será excluído. Isso não pode ser desfeito.`,
                                          {
                                            title: 'Excluir canal',
                                            confirmLabel: 'Excluir',
                                            danger: true,
                                          },
                                        )
                                      )
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
                        // sala trancada em que não entro: pede para a dona (ADR-0040)
                        if (c.kind === 'voice' && voiceChannel !== c.id) {
                          if (c.temporary && !hasPermission(c.myPermissions, Permission.CONNECT)) void knockRoom(c);
                          else void useVoice.getState().join(c.id, serverId);
                        }
                      }}
                    >
                      <Icon name={c.roomHub ? 'plus-circle' : CHANNEL_ICON[c.kind]} size={18} />
                      <span className="truncate">{c.name}</span>
                      {c.roomHub && <span className="small muted">cria uma sala</span>}
                      {c.temporary && <Icon name="clock" size={14} label="Sala temporária: some quando esvazia" />}
                      {(isLockedRoom(detail, c) || isPrivateChannel(detail, c)) && (
                        <Icon
                          name="lock"
                          size={14}
                          label={
                            c.temporary
                              ? hasPermission(c.myPermissions, Permission.CONNECT)
                                ? 'Sala trancada: você pode entrar'
                                : 'Sala trancada: clique para pedir para entrar'
                              : 'Canal privado'
                          }
                        />
                      )}
                      {c.kind === 'voice' && inVoice.length > 0 && <CallTimer members={inVoice} />}
                      {c.temporary && c.userLimit !== null && (
                        <span className="small muted room-count">
                          {inVoice.length}/{c.userLimit}
                        </span>
                      )}
                      {!hasPermission(c.myPermissions, Permission.SEND_MESSAGES) && c.kind === 'text' && (
                        <Icon name="lock" size={14} label="Somente leitura" />
                      )}
                      {(u?.mentionCount ?? 0) > 0 && <span className="badge badge-inline">{u?.mentionCount}</span>}
                    </button>
                    {c.kind === 'voice' && <MusicHint channelId={c.id} />}
                    {c.kind === 'voice' && inVoice.length > 0 && (
                      <ul className="voice-members" aria-label={`Pessoas em ${c.name}`}>
                        {inVoice.map((v) => {
                          const m = memberName(v.userId);
                          const name = aliases?.[v.userId] ?? m?.nickname ?? m?.user.displayName ?? 'Alguém';
                          const draggable = v.userId === me || canMove;
                          const creator = v.userId === creatorId;
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
                                {creator ? <CreatorTag iconOnly /> : m?.user.verified && <VerifiedTag iconOnly />}
                                <UserBadges
                                  userId={v.userId}
                                  fallback={m?.user.badges}
                                  featuredFallback={m?.user.featuredBadges}
                                />
                                <GameBadge userId={v.userId} />
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
