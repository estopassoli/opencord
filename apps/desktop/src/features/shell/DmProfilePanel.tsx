import type { UserProfile, UserPublic } from '@opencord/contracts';
import { Avatar, avatarColor, Icon, STATUS_LABEL } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { ServerIcon } from '../../components/ServerIcon';
import { useData } from '../../store/data';
import { api } from '../../store/session';
import { useUi } from '../../store/ui';
import { openDmWith } from './FriendsPanel';

/** A outra pessoa de uma DM 1:1 (null em grupos ou fora de DM). */
export function useDmPeer(conversationId: string | null): UserPublic | null {
  return useData((s) => {
    if (!conversationId) return null;
    const c = s.conversations.find((x) => x.id === conversationId);
    if (!c || c.kind !== 'dm') return null;
    return c.members.find((m) => m.id !== s.me?.id) ?? null;
  });
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Painel de perfil ao lado da DM: faixa na cor da pessoa, foto com status, apelido, onde está agora (voz),
 * desde quando está no OpenCord e é seu amigo, servidores e amigos em comum.
 */
export function DmProfilePanel({ conversationId }: { conversationId: string }) {
  const peer = useDmPeer(conversationId);
  const open = useUi((s) => s.dmProfile);
  const status = useData((s) => (peer ? (s.presence[peer.id] ?? 'offline') : 'offline'));
  const voice = useData((s) => (peer ? s.voiceStates[peer.id] : undefined));
  const channelName = useData((s) =>
    voice ? s.details[voice.serverId]?.channels.find((c) => c.id === voice.channelId)?.name : undefined,
  );
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    setProfile(null);
    if (!peer) return;
    let alive = true;
    void api()
      .request<UserProfile>('GET', `/users/${peer.id}/profile`)
      .then(
        (p) => alive && setProfile(p),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, [peer?.id]);
  if (!peer || !open) return null;
  return (
    <aside className="dm-profile" aria-label={`Perfil de ${peer.displayName}`}>
      <div className="dm-profile-banner" style={{ background: avatarColor(peer.id) }} />
      <div className="dm-profile-avatar">
        <Avatar id={peer.id} name={peer.displayName} size={80} status={status} />
      </div>
      <div className="dm-profile-body">
        <h2 className="truncate">{peer.displayName}</h2>
        <p className="muted small truncate">@{peer.username}</p>
        {voice ? (
          <button
            className="dm-profile-voice"
            onClick={() =>
              useUi.getState().go({ kind: 'server', serverId: voice.serverId, channelId: voice.channelId })
            }
          >
            <Icon name={voice.streaming ? 'screen' : 'speaker'} size={16} />
            <span className="truncate">
              {voice.streaming ? 'Transmitindo' : 'Em voz'}
              {channelName ? ` · ${channelName}` : ''}
            </span>
          </button>
        ) : (
          <p className="dm-profile-status small">{STATUS_LABEL[status]}</p>
        )}
        {profile && (
          <dl className="dm-profile-facts">
            <div>
              <dt>Membro desde</dt>
              <dd>{fmt(profile.createdAt)}</dd>
            </div>
            {profile.friendSince && (
              <div>
                <dt>Amigos desde</dt>
                <dd>{fmt(profile.friendSince)}</dd>
              </div>
            )}
          </dl>
        )}
        {profile && profile.mutualServers.length > 0 && (
          <section className="dm-profile-section">
            <h3>
              {profile.mutualServers.length} {profile.mutualServers.length === 1 ? 'servidor' : 'servidores'} em comum
            </h3>
            <ul>
              {profile.mutualServers.map((s) => (
                <li key={s.id}>
                  <button
                    className="dm-profile-row"
                    onClick={() => useUi.getState().go({ kind: 'server', serverId: s.id, channelId: null })}
                  >
                    <span className="dm-profile-server" aria-hidden="true">
                      <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
                    </span>
                    <span className="truncate">{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {profile && profile.mutualFriends.length > 0 && (
          <section className="dm-profile-section">
            <h3>
              {profile.mutualFriends.length} {profile.mutualFriends.length === 1 ? 'amigo' : 'amigos'} em comum
            </h3>
            <ul>
              {profile.mutualFriends.map((f) => (
                <li key={f.id}>
                  <button className="dm-profile-row" onClick={() => void openDmWith(f.id)}>
                    <Avatar id={f.id} name={f.displayName} size={24} />
                    <span className="truncate">{f.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
