import type { Conversation } from '@opencord/contracts';
import { Avatar, Icon, STATUS_LABEL } from '@opencord/ui';
import { useState } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { useData, type FriendWithPresence } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

export async function openDmWith(userId: string) {
  try {
    const c = await api().request<Conversation>('POST', '/conversations', { userIds: [userId] });
    useData.getState().upsertConversation(c);
    useUi.getState().go({ kind: 'dm', conversationId: c.id });
  } catch (e) {
    useUi.getState().toast('error', describeError(e));
  }
}

const byName = (a: FriendWithPresence, b: FriendWithPresence) =>
  a.user.displayName.localeCompare(b.user.displayName, 'pt-BR', { sensitivity: 'base' });

/**
 * Painel de amigos ao lado das mensagens diretas: "Ativo agora" (em voz ou transmitindo) e "Disponível" (online).
 * Pode ficar aberto ou só com os avatares; um clique abre a conversa com a pessoa.
 */
export function FriendsPanel() {
  const mode = useUi((s) => s.friendsPanel);
  const friends = useData((s) => s.friends);
  const presence = useData((s) => s.presence);
  const voiceStates = useData((s) => s.voiceStates);
  const details = useData((s) => s.details);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  if (mode === 'hidden') return null;
  const compact = mode === 'compact';
  const statusOf = (f: FriendWithPresence) => presence[f.user.id] ?? f.presence ?? 'offline';
  const accepted = friends.filter((f) => f.status === 'accepted');
  const active = accepted.filter((f) => voiceStates[f.user.id]).sort(byName);
  const available = accepted
    .filter((f) => !voiceStates[f.user.id] && statusOf(f) !== 'offline' && statusOf(f) !== 'invisible')
    .sort(byName);
  const sub = (f: FriendWithPresence) => {
    const v = voiceStates[f.user.id];
    if (!v) return STATUS_LABEL[statusOf(f)];
    const ch = details[v.serverId]?.channels.find((c) => c.id === v.channelId)?.name;
    return `${v.streaming ? 'Transmitindo' : 'Em voz'}${ch ? ` · ${ch}` : ''}`;
  };
  const sections: { id: string; title: string; icon: 'speaker' | 'users'; list: FriendWithPresence[] }[] = [
    { id: 'active', title: 'Ativo agora', icon: 'speaker', list: active },
    { id: 'available', title: 'Disponível', icon: 'users', list: available },
  ];
  return (
    <aside className="friends-panel" data-compact={compact ? 'true' : undefined} aria-label="Amigos">
      <header className="friends-panel-head">
        {!compact && <h2>Amigos</h2>}
        <Tooltip label={compact ? 'Expandir' : 'Mostrar só os avatares'} side={compact ? 'left' : 'bottom'}>
          <button
            className="icon-btn"
            aria-label={compact ? 'Expandir painel de amigos' : 'Recolher painel de amigos'}
            onClick={() => useUi.getState().setFriendsPanel(compact ? 'open' : 'compact')}
          >
            <Icon name={compact ? 'popin' : 'popout'} size={18} />
          </button>
        </Tooltip>
      </header>
      <div className="friends-panel-scroll">
        {active.length + available.length === 0 && !compact && (
          <p className="muted small friends-panel-empty">Nenhum amigo online agora.</p>
        )}
        {sections.map(
          (sec) =>
            sec.list.length > 0 && (
              <section key={sec.id}>
                {compact ? (
                  <span className="friends-panel-sep" title={sec.title}>
                    <Icon name={sec.icon} size={14} label={sec.title} />
                  </span>
                ) : (
                  <button
                    className="friends-panel-title"
                    aria-expanded={!closed[sec.id]}
                    onClick={() => setClosed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
                  >
                    <Icon name={sec.icon} size={14} />
                    {sec.title} · {sec.list.length}
                    <Icon name="chevron-down" size={14} />
                  </button>
                )}
                {(compact || !closed[sec.id]) && (
                  <ul>
                    {sec.list.map((f) => {
                      const row = (
                        <button
                          className="friends-panel-row"
                          aria-label={`Conversar com ${f.user.displayName} (${sub(f)})`}
                          onClick={() => void openDmWith(f.user.id)}
                        >
                          <Avatar id={f.user.id} name={f.user.displayName} size={32} status={statusOf(f)} />
                          {!compact && (
                            <span className="friends-panel-names">
                              <strong className="truncate">{f.user.displayName}</strong>
                              <span className="truncate" data-voice={voiceStates[f.user.id] ? 'true' : undefined}>
                                {sub(f)}
                              </span>
                            </span>
                          )}
                        </button>
                      );
                      return (
                        <li key={f.user.id}>
                          {compact ? (
                            <Tooltip label={`${f.user.displayName} · ${sub(f)}`} side="left">
                              {row}
                            </Tooltip>
                          ) : (
                            row
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ),
        )}
      </div>
    </aside>
  );
}
