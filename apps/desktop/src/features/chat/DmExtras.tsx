/**
 * Extras das mensagens diretas: perfil completo de uma pessoa e "adicionar amigos à conversa" (cria um grupo).
 */
import type { Conversation, UserProfile } from '@opencord/contracts';
import { Avatar, avatarColor, Button, Checkbox, Icon, STATUS_LABEL, TextArea, TextField } from '@opencord/ui';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { openContextMenu } from '../../components/ContextMenu';
import { ServerIcon } from '../../components/ServerIcon';
import { useData } from '../../store/data';
import { api, describeError, loadFriends } from '../../store/session';
import { useUi } from '../../store/ui';
import { openDmWith } from '../shell/FriendsPanel';
import { useNameAlias } from '../../lib/names';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
/** limite da API para grupos (com quem cria) */
const GROUP_MAX = 10;

const noteKey = (userId: string) => `oc-note-${userId}`;
const readNote = (userId: string) => {
  try {
    return localStorage.getItem(noteKey(userId)) ?? '';
  } catch {
    return '';
  }
};

type Tab = 'activity' | 'friends' | 'servers';

/** Perfil completo (janela): faixa, foto, ações, datas, nota só sua e abas de atividade e coisas em comum. */
export function FullProfileDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('activity');
  const [note, setNote] = useState(() => readNote(userId));
  const status = useData((s) => s.presence[userId] ?? 'offline');
  const voice = useData((s) => s.voiceStates[userId]);
  const channelName = useData((s) =>
    voice ? s.details[voice.serverId]?.channels.find((c) => c.id === voice.channelId)?.name : undefined,
  );
  const serverName = useData((s) => (voice ? s.servers.find((x) => x.id === voice.serverId)?.name : undefined));
  const friendship = useData((s) => s.friends.find((f) => f.user.id === userId && f.status === 'accepted'));
  const alias = useNameAlias(userId);

  useEffect(() => {
    void api()
      .request<UserProfile>('GET', `/users/${userId}/profile`)
      .then(setProfile, (e: unknown) => setError(describeError(e)));
  }, [userId]);

  const saveNote = (v: string) => {
    setNote(v);
    try {
      if (v.trim()) localStorage.setItem(noteKey(userId), v);
      else localStorage.removeItem(noteKey(userId));
    } catch {
      /* vale só nesta sessão */
    }
  };
  const more = (e: React.MouseEvent) =>
    openContextMenu(
      e,
      [
        {
          label: 'Copiar nome de usuário',
          icon: 'copy',
          onSelect: () => profile && void navigator.clipboard.writeText(profile.user.username),
        },
        ...(friendship
          ? [
              {
                label: 'Remover amizade',
                icon: 'user-minus' as const,
                danger: true,
                onSelect: () => {
                  if (!profile || !confirm(`Remover ${profile.user.displayName} dos seus amigos?`)) return;
                  void api()
                    .request('DELETE', `/friends/${userId}`)
                    .then(
                      () => loadFriends(),
                      (err: unknown) => useUi.getState().toast('error', describeError(err)),
                    );
                },
              },
            ]
          : []),
      ],
      'Mais opções do perfil',
    );

  const user = profile?.user;
  return (
    <Dialog title={user ? `Perfil de ${user.displayName}` : 'Perfil'} onClose={onClose} wide>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {user && profile && (
        <div className="full-profile">
          <section className="full-profile-card">
            <div className="full-profile-banner" style={{ background: avatarColor(user.id) }} />
            <div className="full-profile-avatar">
              <Avatar id={user.id} name={user.displayName} size={112} status={status} />
            </div>
            <div className="full-profile-body">
              <h2>{alias ?? user.displayName}</h2>
              <p className="muted">
                {alias && `${user.displayName} · `}@{user.username}
              </p>
              <div className="full-profile-actions">
                <Button icon="chat" onClick={() => void openDmWith(user.id).then(onClose)}>
                  Mensagem
                </Button>
                <button
                  className="icon-btn"
                  aria-label="Mais opções"
                  aria-haspopup="menu"
                  data-tip="Mais"
                  onClick={more}
                >
                  <Icon name="more" size={18} />
                </button>
              </div>
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
              <TextArea
                label="Nota (só você vê)"
                value={note}
                maxLength={256}
                rows={3}
                placeholder="Clique para adicionar uma nota"
                onChange={(e) => saveNote(e.target.value)}
              />
            </div>
          </section>
          <section className="full-profile-side">
            <div className="tabs" role="tablist" aria-label="Seções do perfil">
              <button role="tab" className="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>
                Atividade
              </button>
              <button role="tab" className="tab" aria-selected={tab === 'friends'} onClick={() => setTab('friends')}>
                {profile.mutualFriends.length} {profile.mutualFriends.length === 1 ? 'amigo' : 'amigos'} em comum
              </button>
              <button role="tab" className="tab" aria-selected={tab === 'servers'} onClick={() => setTab('servers')}>
                {profile.mutualServers.length} {profile.mutualServers.length === 1 ? 'servidor' : 'servidores'} em comum
              </button>
            </div>
            <div className="full-profile-tab" role="tabpanel">
              {tab === 'activity' &&
                (voice ? (
                  <button
                    className="full-profile-activity"
                    onClick={() => {
                      useUi.getState().go({ kind: 'server', serverId: voice.serverId, channelId: voice.channelId });
                      onClose();
                    }}
                  >
                    <Icon name={voice.streaming ? 'screen' : 'speaker'} size={22} />
                    <span>
                      <strong>{voice.streaming ? 'Transmitindo agora' : 'Em uma chamada de voz'}</strong>
                      <span className="muted small">
                        {channelName ?? 'canal de voz'}
                        {serverName ? ` · ${serverName}` : ''}
                      </span>
                    </span>
                  </button>
                ) : (
                  <p className="muted">{STATUS_LABEL[status]}. Nenhuma atividade agora.</p>
                ))}
              {tab === 'friends' &&
                (profile.mutualFriends.length ? (
                  <ul className="dm-profile-section-list">
                    {profile.mutualFriends.map((f) => (
                      <li key={f.id}>
                        <button className="dm-profile-row" onClick={() => void openDmWith(f.id).then(onClose)}>
                          <Avatar id={f.id} name={f.displayName} size={28} />
                          <span className="truncate">{f.displayName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Nenhum amigo em comum.</p>
                ))}
              {tab === 'servers' &&
                (profile.mutualServers.length ? (
                  <ul className="dm-profile-section-list">
                    {profile.mutualServers.map((s) => (
                      <li key={s.id}>
                        <button
                          className="dm-profile-row"
                          onClick={() => {
                            useUi.getState().go({ kind: 'server', serverId: s.id, channelId: null });
                            onClose();
                          }}
                        >
                          <span className="dm-profile-server" aria-hidden="true">
                            <ServerIcon name={s.name} iconKey={s.iconKey} official={s.official} />
                          </span>
                          <span className="truncate">{s.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Nenhum servidor em comum.</p>
                ))}
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** "Adicionar amigos à conversa": escolhe amigos e abre uma conversa em grupo com eles (e a pessoa desta DM). */
export function AddToDmDialog({ peerId, onClose }: { peerId: string; onClose: () => void }) {
  const friends = useData((s) => s.friends);
  const accepted = useMemo(
    () =>
      friends
        .filter((f) => f.status === 'accepted')
        .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName, 'pt-BR', { sensitivity: 'base' })),
    [friends],
  );
  const peerIsFriend = accepted.some((f) => f.user.id === peerId);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(peerIsFriend ? [peerId] : []));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const list = q
    ? accepted.filter((f) => f.user.displayName.toLowerCase().includes(q) || f.user.username.includes(q))
    : accepted;
  const full = picked.size + 1 >= GROUP_MAX;
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await api().request<Conversation>('POST', '/conversations', { userIds: [...picked] });
      useData.getState().upsertConversation(c);
      useUi.getState().go({ kind: 'dm', conversationId: c.id });
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Adicionar amigos à conversa"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || picked.size < 2} onClick={() => void create()}>
            Criar grupo ({picked.size + 1})
          </Button>
        </>
      }
    >
      <p className="muted small">
        Abre uma conversa em grupo com quem você marcar (até {GROUP_MAX} pessoas, contando você). Esta conversa continua
        como está.
        {!peerIsFriend && ' A pessoa desta conversa não é sua amiga, então não pode entrar no grupo.'}
      </p>
      <TextField
        leadingIcon="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar amigos"
        aria-label="Buscar amigos"
      />
      <ul className="add-dm-list" aria-label="Amigos">
        {list.length === 0 && <li className="muted small">Nenhum amigo encontrado.</li>}
        {list.map((f) => (
          <li key={f.user.id}>
            <Avatar id={f.user.id} name={f.user.displayName} size={28} />
            <Checkbox
              label={f.user.displayName}
              description={`@${f.user.username}`}
              checked={picked.has(f.user.id)}
              disabled={!picked.has(f.user.id) && full}
              onChange={(on) => toggle(f.user.id, on)}
            />
          </li>
        ))}
      </ul>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
