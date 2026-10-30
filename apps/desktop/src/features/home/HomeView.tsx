import { MobileNavButton } from '../../components/MobileNavButton';
import type { Conversation, UserPublic } from '@opencord/contracts';
import { Avatar, Button, Icon, STATUS_LABEL, TextField } from '@opencord/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { useData, type FriendWithPresence as Friend } from '../../store/data';
import { api, describeError, loadFriends } from '../../store/session';
import { useUi } from '../../store/ui';
import { useActivity } from '../../store/activity';
import { useVoice } from '../../store/voice';
import { ServerIcon } from '../../components/ServerIcon';
import { openContextMenu, useContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';

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
  const list = (
    q ? base.filter((f) => f.user.displayName.toLowerCase().includes(q) || f.user.username.includes(q)) : base
  ).toSorted((a, b) => a.user.displayName.localeCompare(b.user.displayName, 'pt-BR', { sensitivity: 'base' }));
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
                  {list.map((f) => (
                    <FriendRow key={f.user.id} f={f} act={act} openDm={openDm} />
                  ))}
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

/** Linha de amigo: clique abre a conversa; status em texto (ou o canal de voz); ações em Mensagem e "⋮". */
function FriendRow({
  f,
  act,
  openDm,
}: {
  f: Friend;
  act: (p: Promise<unknown>, ok?: string) => void;
  openDm: (userId: string) => Promise<void>;
}) {
  const st = useData((s) => s.presence[f.user.id] ?? f.presence ?? 'offline');
  const voice = useData((s) => s.voiceStates[f.user.id]);
  const channel = useData((s) =>
    voice ? s.details[voice.serverId]?.channels.find((c) => c.id === voice.channelId)?.name : undefined,
  );
  const accepted = f.status === 'accepted';
  const name = f.user.displayName;
  const menu: MenuEntry[] = accepted
    ? [
        { label: 'Enviar mensagem', icon: 'chat', onSelect: () => void openDm(f.user.id) },
        'separator',
        {
          label: 'Remover amizade',
          icon: 'user-minus',
          danger: true,
          onSelect: () => {
            if (confirm(`Remover ${name} dos seus amigos?`))
              act(api().request('DELETE', `/friends/${f.user.id}`), 'Amizade removida.');
          },
        },
        {
          label: 'Bloquear',
          icon: 'block',
          danger: true,
          onSelect: () => {
            if (confirm(`Bloquear ${name}? Vocês não poderão trocar mensagens diretas.`))
              act(api().request('PUT', `/blocks/${f.user.id}`), 'Usuário bloqueado.');
          },
        },
      ]
    : [];
  const sub = !accepted ? (
    f.status === 'pending_incoming' ? (
      'Pedido de amizade recebido'
    ) : (
      'Pedido de amizade enviado'
    )
  ) : voice ? (
    <span className="friend-voice">
      <Icon name={voice.streaming ? 'screen' : 'speaker'} size={14} />
      {voice.streaming ? 'Transmitindo' : 'Em voz'}
      {channel ? ` · ${channel}` : ''}
    </span>
  ) : (
    STATUS_LABEL[st]
  );
  return (
    <li
      className="friend-row"
      data-clickable={accepted ? 'true' : undefined}
      onClick={accepted ? () => void openDm(f.user.id) : undefined}
      onContextMenu={accepted ? (e) => openContextMenu(e, menu, `Opções de ${name}`) : undefined}
    >
      <Avatar id={f.user.id} name={name} size={36} status={accepted ? st : undefined} />
      <div className="friend-names">
        <span className="friend-title">
          <strong className="truncate">{name}</strong>
          <span className="friend-username truncate">@{f.user.username}</span>
        </span>
        <span className="friend-sub truncate">{sub}</span>
      </div>
      {/* as ações não disparam o clique da linha */}
      <div className="friend-actions" onClick={(e) => e.stopPropagation()}>
        {accepted && (
          <Tooltip label="Mensagem">
            <button className="round-btn" aria-label={`Mensagem para ${name}`} onClick={() => void openDm(f.user.id)}>
              <Icon name="chat" size={18} />
            </button>
          </Tooltip>
        )}
        {accepted && (
          <Tooltip label="Mais">
            <button
              className="round-btn"
              aria-label={`Mais opções de ${name}`}
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                useContextMenu.getState().show(r.right - 200, r.bottom + 4, menu, `Opções de ${name}`);
              }}
            >
              <Icon name="more" size={18} />
            </button>
          </Tooltip>
        )}
        {f.status === 'pending_incoming' && (
          <Tooltip label="Aceitar">
            <button
              className="round-btn round-ok"
              aria-label={`Aceitar ${name}`}
              onClick={() => act(api().request('POST', `/friends/${f.user.id}/accept`), 'Pedido aceito.')}
            >
              <Icon name="check" size={18} />
            </button>
          </Tooltip>
        )}
        {!accepted && (
          <Tooltip label={f.status === 'pending_incoming' ? 'Recusar' : 'Cancelar pedido'}>
            <button
              className="round-btn round-danger"
              aria-label="Recusar ou cancelar pedido"
              onClick={() => act(api().request('DELETE', `/friends/${f.user.id}`))}
            >
              <Icon name="close" size={18} />
            </button>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

/** Entra na chamada (se preciso), abre o canal e assiste a live de `userId` em destaque. */
async function watchStream(serverId: string, channelId: string, userId: string, here: boolean) {
  useUi.getState().go({ kind: 'server', serverId, channelId });
  try {
    if (!here) await useVoice.getState().join(channelId, serverId);
  } catch (e) {
    useUi.getState().toast('error', describeError(e));
    return;
  }
  useVoice.getState().watch(userId, true);
  useUi.getState().focusStream(userId);
}

/** Prévia da live (imagem que quem transmite publica na API a cada 5 min); um clique entra e assiste. */
function StreamPreviewCard({
  userId,
  previewAt,
  name,
  onWatch,
}: {
  userId: string;
  previewAt: string | null;
  name: string;
  onWatch: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewAt) return;
    let alive = true;
    let made: string | null = null;
    void api()
      .blob(`/voice/members/${userId}/stream-preview`)
      .then(
        (b) => {
          if (!alive) return;
          made = URL.createObjectURL(b);
          setUrl(made);
        },
        () => undefined,
      );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [userId, previewAt]);
  return (
    <button className="now-stream" onClick={onWatch} aria-label={`Assistir a transmissão de ${name}`}>
      <span className="now-stream-thumb">
        {url ? <img src={url} alt="" draggable={false} /> : <Icon name="screen" size={24} />}
        <span className="live-pill">AO VIVO</span>
        <span className="now-stream-play" aria-hidden="true">
          <Icon name="play" size={18} />
          Assistir
        </span>
      </span>
      <span className="now-stream-name truncate">
        <Avatar id={userId} name={name} size={18} />
        {name}
      </span>
    </button>
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
                  <ServerIcon name={server?.name ?? '?'} iconKey={server?.iconKey} official={server?.official} />
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
                <ul className="now-streams" aria-label="Transmissões">
                  {streaming.map((st) => (
                    <li key={st.userId}>
                      <StreamPreviewCard
                        userId={st.userId}
                        previewAt={st.previewAt ?? null}
                        name={nameOf(st.userId)}
                        onWatch={() => server && void watchStream(server.id, channelId, st.userId, here)}
                      />
                    </li>
                  ))}
                </ul>
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
