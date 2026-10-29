import { hasPermission, Permission, type Channel } from '@opencord/contracts';
import { Avatar, Icon } from '@opencord/ui';
import { useMemo, useState } from 'react';
import { openContextMenu } from '../../components/ContextMenu';
import { useData } from '../../store/data';
import { api, describeError, markTargetRead } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { ProfileButton } from './ProfileButton';

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

  const groups = useMemo(() => {
    if (!detail) return [];
    const byCat = new Map<string | null, Channel[]>();
    for (const c of detail.channels) byCat.set(c.categoryId, [...(byCat.get(c.categoryId) ?? []), c]);
    const sortCh = (l: Channel[]) =>
      [...l].sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === 'text' ? -1 : 1));
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

  return (
    <>
      <header className="sidebar-header">
        <button
          className="server-name"
          onClick={() => open({ kind: 'server-settings', serverId })}
          title="Configurações do servidor"
        >
          <span className="truncate">{detail.name}</span>
          <Icon name="chevron-down" size={16} />
        </button>
      </header>
      <div className="sidebar-scroll">
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
                    title="Criar canal"
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
                  <li key={c.id}>
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
                      <Icon name={c.kind === 'text' ? 'hashtag' : 'speaker'} size={18} />
                      <span className="truncate">{c.name}</span>
                      {!hasPermission(c.myPermissions, Permission.SEND_MESSAGES) && c.kind === 'text' && (
                        <Icon name="lock" size={14} label="Somente leitura" />
                      )}
                      {(u?.mentionCount ?? 0) > 0 && <span className="badge badge-inline">{u?.mentionCount}</span>}
                    </button>
                    {c.kind === 'voice' && inVoice.length > 0 && (
                      <ul className="voice-members" aria-label={`Pessoas em ${c.name}`}>
                        {inVoice.map((v) => {
                          const m = memberName(v.userId);
                          const name = m?.nickname ?? m?.user.displayName ?? 'Alguém';
                          return (
                            <li key={v.userId}>
                              <ProfileButton userId={v.userId} serverId={serverId} className="voice-member">
                                <Avatar id={v.userId} name={name} size={22} speaking={speakingIds.has(v.userId)} />
                                <span className="truncate">{name}</span>
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
