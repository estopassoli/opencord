import { MobileNavButton } from '../../components/MobileNavButton';
import type { Conversation, UserPublic } from '@opencord/contracts';
import { Avatar, Button, Icon, STATUS_LABEL, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../store/data';
import { api, describeError, loadFriends } from '../../store/session';
import { useUi } from '../../store/ui';
import { useActivity } from '../../store/activity';
import { useVoice } from '../../store/voice';
import { ServerIcon } from '../../components/ServerIcon';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';
const TABS: [Tab, string][] = [
  ['online', 'Online'],
  ['all', 'Todos'],
  ['pending', 'Pendentes'],
  ['blocked', 'Bloqueados'],
];

export function HomeView() {
  const [tab, setTab] = useState<Tab>('online');
  const friends = useData((s) => s.friends);
  const presence = useData((s) => s.presence);
  const [blocked, setBlocked] = useState<UserPublic[]>([]);
  const pendingCount = friends.filter((f) => f.status === 'pending_incoming').length;

  useEffect(() => {
    if (tab === 'blocked')
      void api()
        .request<UserPublic[]>('GET', '/blocks')
        .then(setBlocked, () => undefined);
  }, [tab]);

  const act = (p: Promise<unknown>, ok?: string) =>
    void p.then(
      () => {
        if (ok) useUi.getState().toast('success', ok);
        void loadFriends();
      },
      (e: unknown) => useUi.getState().toast('error', describeError(e)),
    );

  const openDm = async (userId: string) => {
    try {
      const c = await api().request<Conversation>('POST', '/conversations', { userIds: [userId] });
      useData.getState().upsertConversation(c);
      useUi.getState().go({ kind: 'dm', conversationId: c.id });
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  };

  const [query, setQuery] = useState('');
  const base =
    tab === 'online'
      ? friends.filter((f) => f.status === 'accepted' && (presence[f.user.id] ?? f.presence ?? 'offline') !== 'offline')
      : tab === 'all'
        ? friends.filter((f) => f.status === 'accepted')
        : tab === 'pending'
          ? friends.filter((f) => f.status !== 'accepted')
          : [];
  const q = query.trim().toLowerCase();
  const list = q
    ? base.filter((f) => f.user.displayName.toLowerCase().includes(q) || f.user.username.includes(q))
    : base;
  const titles: Record<Exclude<Tab, 'add' | 'blocked'>, string> = {
    online: 'Online',
    all: 'Todos os amigos',
    pending: 'Pendentes',
  };

  return (
    <div className="home-layout">
      <section className="home" aria-label="Amigos">
        <header className="chat-header home-header">
          <MobileNavButton />
          <Icon name="users" size={22} />
          <h2>Amigos</h2>
          <span className="header-divider" aria-hidden />
          <div className="tabs" role="tablist" aria-label="Filtro de amigos">
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>
                {label}
                {t === 'pending' && pendingCount > 0 && <span className="badge badge-inline">{pendingCount}</span>}
              </button>
            ))}
            <button role="tab" aria-selected={tab === 'add'} className="tab tab-accent" onClick={() => setTab('add')}>
              Adicionar amigo
            </button>
          </div>
        </header>
        <div className="home-body" role="tabpanel">
          {tab === 'add' ? (
            <AddFriend />
          ) : (
            <>
              {tab !== 'blocked' && (
                <TextField
                  fieldClassName="friends-search"
                  leadingIcon="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar"
                  aria-label="Buscar amigos"
                />
              )}
              {tab === 'blocked' ? (
                <ul className="friend-list">
                  <li className="list-title">Bloqueados — {blocked.length}</li>
                  {blocked.length === 0 && <li className="empty-state">Ninguém bloqueado.</li>}
                  {blocked.map((u) => (
                    <li key={u.id} className="friend-row">
                      <Avatar id={u.id} name={u.displayName} size={32} />
                      <div className="friend-names">
                        <strong>{u.displayName}</strong>
                        <span className="muted small">Bloqueado</span>
                      </div>
                      <div className="friend-actions">
                        <button
                          className="round-btn"
                          aria-label={`Desbloquear ${u.displayName}`}
                          title="Desbloquear"
                          onClick={() =>
                            act(
                              api()
                                .request('DELETE', `/blocks/${u.id}`)
                                .then(() => setBlocked((b) => b.filter((x) => x.id !== u.id))),
                              'Desbloqueado.',
                            )
                          }
                        >
                          <Icon name="user-minus" size={18} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="friend-list">
                  <li className="list-title">
                    {titles[tab]} — {list.length}
                  </li>
                  {list.length === 0 && (
                    <li className="empty-state">
                      {tab === 'online'
                        ? 'Nenhum amigo online agora.'
                        : tab === 'pending'
                          ? 'Nenhum pedido pendente.'
                          : 'Adicione amigos pelo apelido.'}
                    </li>
                  )}
                  {list.map((f) => {
                    const st = presence[f.user.id] ?? f.presence ?? 'offline';
                    return (
                      <li key={f.user.id} className="friend-row" tabIndex={-1}>
                        <Avatar
                          id={f.user.id}
                          name={f.user.displayName}
                          size={32}
                          status={f.status === 'accepted' ? st : undefined}
                        />
                        <div className="friend-names">
                          <strong>{f.user.displayName}</strong>
                          <span className="muted small">
                            {f.status === 'accepted'
                              ? STATUS_LABEL[st]
                              : f.status === 'pending_incoming'
                                ? 'Pedido de amizade recebido'
                                : 'Pedido de amizade enviado'}
                          </span>
                        </div>
                        <div className="friend-actions">
                          {f.status === 'accepted' && (
                            <button
                              className="round-btn"
                              aria-label={`Mensagem para ${f.user.displayName}`}
                              title="Mensagem"
                              onClick={() => void openDm(f.user.id)}
                            >
                              <Icon name="chat" size={18} />
                            </button>
                          )}
                          {f.status === 'pending_incoming' && (
                            <button
                              className="round-btn round-ok"
                              aria-label={`Aceitar ${f.user.displayName}`}
                              title="Aceitar"
                              onClick={() =>
                                act(api().request('POST', `/friends/${f.user.id}/accept`), 'Pedido aceito.')
                              }
                            >
                              <Icon name="check" size={18} />
                            </button>
                          )}
                          <button
                            className="round-btn round-danger"
                            aria-label={
                              f.status === 'accepted' ? `Remover ${f.user.displayName}` : 'Recusar ou cancelar pedido'
                            }
                            title={f.status === 'accepted' ? 'Remover amizade' : 'Recusar'}
                            onClick={() => act(api().request('DELETE', `/friends/${f.user.id}`))}
                          >
                            <Icon name="close" size={18} />
                          </button>
                          <button
                            className="round-btn round-danger"
                            aria-label={`Bloquear ${f.user.displayName}`}
                            title="Bloquear"
                            onClick={() => {
                              if (
                                confirm(`Bloquear ${f.user.displayName}? Vocês não poderão trocar mensagens diretas.`)
                              )
                                act(api().request('PUT', `/blocks/${f.user.id}`), 'Usuário bloqueado.');
                            }}
                          >
                            <Icon name="block" size={18} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
      <ActivityColumn />
    </div>
  );
}

/** Coluna "Em atividade": amigos e membros conectados em canais de voz ou transmitindo agora. */
function ActivityColumn() {
  const voiceStates = useData((s) => s.voiceStates);
  const details = useData((s) => s.details);
  const meId = useData((s) => s.me?.id);
  const activities = useActivity((s) => s.channels);
  const myCall = useVoice((s) => (s.machine.status === 'disconnected' ? null : s.machine.channelId));
  const active = Object.values(voiceStates).filter((v) => v.userId !== meId);
  const byChannel = new Map<string, typeof active>();
  for (const v of active) byChannel.set(v.channelId, [...(byChannel.get(v.channelId) ?? []), v]);
  return (
    <aside className="activity" aria-label="Em atividade">
      <h2>Em atividade</h2>
      {byChannel.size === 0 ? (
        <div className="activity-empty">
          <strong>Tudo tranquilo por aqui…</strong>
          <p className="muted small">
            Quando alguém entrar em um canal de voz ou começar uma transmissão, aparece aqui.
          </p>
        </div>
      ) : (
        [...byChannel].map(([channelId, states]) => {
          const server = details[states[0]?.serverId ?? ''];
          const channel = server?.channels.find((c) => c.id === channelId);
          const nameOf = (id: string) => {
            const m = server?.members.find((x) => x.user.id === id);
            return m?.nickname ?? m?.user.displayName ?? 'Alguém';
          };
          const streaming = states.filter((s) => s.streaming);
          const names = states.map((s) => nameOf(s.userId));
          const people = names.length <= 2 ? names.join(' e ') : `${names[0]} e mais ${names.length - 1}`;
          const watch = activities[channelId];
          const open = () => server && useUi.getState().go({ kind: 'server', serverId: server.id, channelId });
          const here = myCall === channelId;
          return (
            <article
              key={channelId}
              className="now-card"
              aria-label={`${channel?.name ?? 'Canal de voz'} em ${server?.name ?? ''}`}
            >
              <div className="now-head">
                <span className="now-server" aria-hidden="true">
                  <ServerIcon name={server?.name ?? '?'} iconKey={server?.iconKey} />
                </span>
                <span className="truncate">{server?.name}</span>
                {streaming.length > 0 && <span className="live-pill">AO VIVO</span>}
              </div>
              <button className="now-channel" onClick={open}>
                <Icon name="speaker" size={18} />
                <span className="truncate">{channel?.name ?? 'Canal de voz'}</span>
              </button>
              <div className="now-people">
                <span className="now-avatars">
                  {states.slice(0, 5).map((s) => (
                    <Avatar key={s.userId} id={s.userId} name={nameOf(s.userId)} size={28} />
                  ))}
                </span>
                <span className="muted small truncate">{people}</span>
              </div>
              {streaming.length > 0 && (
                <span className="now-extra live">
                  <Icon name="screen" size={14} />
                  <span className="truncate">
                    {streaming.length === 1
                      ? `${nameOf(streaming[0]!.userId)} está transmitindo`
                      : `${streaming.length} transmissões`}
                  </span>
                </span>
              )}
              {watch && (
                <span className="now-extra watch">
                  <Icon name="play" size={14} />
                  <span className="truncate">Assistindo: {watch.title ?? 'vídeo do YouTube'}</span>
                </span>
              )}
              <Button
                variant="secondary"
                className="now-join"
                onClick={() => {
                  open();
                  if (!here && server) void useVoice.getState().join(channelId, server.id);
                }}
              >
                {here ? 'Abrir chamada' : 'Entrar na chamada'}
              </Button>
            </article>
          );
        })
      )}
    </aside>
  );
}

function AddFriend() {
  const [username, setUsername] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api().request('POST', '/friends/requests', { username: username.trim() });
      setMsg({ ok: true, text: `Pedido enviado para ${username.trim()}.` });
      setUsername('');
      void loadFriends();
    } catch (err) {
      setMsg({ ok: false, text: describeError(err) });
    }
  };
  return (
    <form className="add-friend" onSubmit={submit}>
      <h3>Adicionar amigo</h3>
      <p className="muted">Digite o apelido da pessoa.</p>
      <div className="copy-row">
        <TextField
          fieldClassName="add-friend-field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-label="Apelido"
          placeholder="Apelido"
          minLength={2}
          maxLength={32}
          required
          autoFocus
        />
        <Button type="submit" disabled={!username.trim()}>
          Enviar pedido
        </Button>
      </div>
      {msg && (
        <p className={msg.ok ? 'success-text' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
