import { MobileNavButton } from '../../components/MobileNavButton';
import { useIsMobile } from '../../lib/media';
import { hasPermission, Permission, type Message, type MessagePage } from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { keyOf, useData, useMessages, type TargetKey } from '../../store/data';
import { api, describeError, useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { Composer } from './Composer';
import { useDmPeer } from '../shell/DmProfilePanel';
import { MessageItem } from './MessageItem';

export type ChatTarget =
  { channelId: string; conversationId?: undefined } | { conversationId: string; channelId?: undefined };

const GROUP_MS = 7 * 60 * 1000;
const path = (t: ChatTarget) => (t.channelId ? `/channels/${t.channelId}` : `/conversations/${t.conversationId}`);

export function ChatView({ target }: { target: ChatTarget }) {
  const key: TargetKey = keyOf(target);
  const timeline = useMessages((s) => s.timelines[key]);
  const meId = useData((s) => s.me?.id ?? '');
  const channel = useData((s) =>
    target.channelId
      ? Object.values(s.details)
          .flatMap((d) => d.channels)
          .find((c) => c.id === target.channelId)
      : undefined,
  );
  const conv = useData((s) =>
    target.conversationId ? s.conversations.find((c) => c.id === target.conversationId) : undefined,
  );
  const unread = useData((s) => s.unread[key]);
  const typing = useData((s) => s.typing[key]);
  const members = useData((s) => (channel ? s.details[channel.serverId]?.members : undefined));
  const showMembers = useUi((s) => s.showMembers);
  const friendsPanel = useUi((s) => s.friendsPanel);
  const dmProfile = useUi((s) => s.dmProfile);
  const dmPeer = useDmPeer(target.conversationId ?? null);
  const membersPanel = useUi((s) => s.panel === 'members');
  const mobile = useIsMobile();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [firstUnreadId] = useState(() => (unread && unread.unreadCount > 0 ? unread.lastReadMessageId : null));
  const [loadError, setLoadError] = useState<string | null>(null);

  const perms = channel?.myPermissions ?? Permission.SEND_MESSAGES | Permission.ATTACH_FILES | Permission.ADD_REACTIONS;
  const canSend = hasPermission(perms, Permission.SEND_MESSAGES);
  const title = channel
    ? channel.name
    : conv
      ? (conv.name ??
        conv.members
          .filter((m) => m.id !== meId)
          .map((m) => m.displayName)
          .join(', '))
      : '';

  const load = useCallback(
    async (older: boolean) => {
      const tl = useMessages.getState().get(key);
      if (tl.loading || (older && !tl.nextBefore)) return;
      useMessages.getState().setLoading(key, true);
      try {
        const q = older && tl.nextBefore ? `?limit=50&before=${encodeURIComponent(tl.nextBefore)}` : '?limit=50';
        const page = await api().request<MessagePage>('GET', `${path(target)}/messages${q}`);
        useMessages.getState().setPage(key, page, older ? 'prepend' : 'replace');
        setLoadError(null);
      } catch (e) {
        useMessages.getState().setLoading(key, false);
        setLoadError(describeError(e));
      }
    },
    [key, target],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // marcar como lido ao ver o fim da conversa
  const last = timeline?.messages.at(-1);
  useEffect(() => {
    if (!last || !atBottom.current || !document.hasFocus()) return;
    const u = useData.getState().unread[key];
    if (u && u.lastReadMessageId === last.id && u.unreadCount === 0) return;
    useData.getState().markRead(key, last.id);
    const rt = useSession.getState().realtime;
    const payload = target.channelId
      ? { channelId: target.channelId, messageId: last.id }
      : { conversationId: target.conversationId as string, messageId: last.id };
    if (rt?.connected) void rt.command('chat:read', payload).catch(() => undefined);
    else
      void api()
        .request('PUT', `${path(target)}/read`, { messageId: last.id })
        .catch(() => undefined);
  }, [last, key, target]);

  // manter rolagem: no fim quando chegam mensagens; preservar posição ao carregar antigas
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !timeline) return;
    const first = timeline.messages[0]?.id;
    if (prevFirst.current && first !== prevFirst.current && el.scrollHeight > prevHeight.current && !atBottom.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = el.scrollHeight;
    prevFirst.current = first;
  }, [timeline]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 200) void load(true);
  };

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) map.set(m.user.id, m.nickname ?? m.user.displayName);
    for (const u of conv?.members ?? []) map.set(u.id, u.displayName);
    return (id: string) => map.get(id) ?? 'alguém';
  }, [members, conv]);

  const typers = Object.entries(typing ?? {})
    .filter(([id, until]) => id !== meId && until > Date.now())
    .map(([id]) => nameOf(id));

  const pending = Object.entries(timeline?.pending ?? {});

  return (
    <section className="chat" aria-label={`Conversa ${title}`}>
      <header className="chat-header">
        <MobileNavButton />
        <Icon name={channel ? 'hashtag' : 'chat'} size={22} />
        <h2 className="truncate">{title}</h2>
        {channel?.topic && <span className="chat-topic truncate">{channel.topic}</span>}
        <span className="spacer" />
        {!channel && !mobile && dmPeer && (
          <button
            className="icon-btn"
            aria-pressed={dmProfile}
            aria-label={dmProfile ? 'Ocultar perfil do usuário' : 'Mostrar perfil do usuário'}
            data-tip={dmProfile ? 'Ocultar perfil do usuário' : 'Mostrar perfil do usuário'}
            onClick={() => useUi.getState().setDmProfile(!dmProfile)}
          >
            <Icon name="user" />
          </button>
        )}
        {!channel && !mobile && (
          <button
            className="icon-btn"
            aria-pressed={friendsPanel !== 'hidden'}
            aria-label="Mostrar amigos"
            data-tip={friendsPanel === 'hidden' ? 'Mostrar amigos' : 'Ocultar amigos'}
            onClick={() => useUi.getState().setFriendsPanel(friendsPanel === 'hidden' ? 'open' : 'hidden')}
          >
            <Icon name="users" />
          </button>
        )}
        {channel && (
          <button
            className="icon-btn"
            aria-pressed={mobile ? membersPanel : showMembers}
            aria-label="Mostrar membros"
            data-tip="Lista de membros"
            onClick={() =>
              mobile ? useUi.getState().setPanel(membersPanel ? 'none' : 'members') : useUi.getState().toggleMembers()
            }
          >
            <Icon name="users" />
          </button>
        )}
      </header>
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
      >
        {timeline?.loaded && !timeline.nextBefore && (
          <div className="chat-start">
            <h3>{channel ? `Bem-vindo a #${title}` : title}</h3>
            <p className="muted">{channel ? 'Este é o começo do canal.' : 'Este é o começo da conversa.'}</p>
          </div>
        )}
        {timeline?.loading && (
          <div className="chat-loading" aria-busy="true">
            Carregando mensagens…
          </div>
        )}
        {loadError && (
          <div className="chat-loading" role="alert">
            {loadError}{' '}
            <button className="link-btn" onClick={() => void load(false)}>
              Tentar de novo
            </button>
          </div>
        )}
        <ol className="messages">
          {timeline?.messages.map((m, i) => {
            const prev = timeline.messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const grouped = Boolean(
              prev &&
              !newDay &&
              !m.replyTo &&
              prev.author.id === m.author.id &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS &&
              !prev.deleted,
            );
            const unreadLine = firstUnreadId && prev?.id === firstUnreadId;
            return (
              <li key={m.id}>
                {newDay && (
                  <div className="day-divider" role="separator">
                    <span>
                      {new Date(m.createdAt).toLocaleDateString(undefined, {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                )}
                {unreadLine && (
                  <div className="unread-divider" role="separator">
                    <span>Novas</span>
                  </div>
                )}
                <MessageItem
                  message={m}
                  grouped={grouped}
                  meId={meId}
                  perms={perms}
                  target={target}
                  nameOf={nameOf}
                  mentionsMe={m.mentions.includes(meId)}
                />
              </li>
            );
          })}
          {pending.map(([rid, p]) => (
            <li key={rid}>
              <PendingMessage body={p.body} failed={p.failed} onRetry={() => retry(key, target, rid)} />
            </li>
          ))}
        </ol>
      </div>
      <div className="typing" aria-live="polite">
        {typers.length > 0 && (
          <span>
            {typers.length > 3
              ? 'Várias pessoas estão digitando…'
              : `${typers.join(', ')} ${typers.length > 1 ? 'estão' : 'está'} digitando…`}
          </span>
        )}
      </div>
      {canSend ? (
        <Composer
          target={target}
          targetKey={key}
          placeholder={channel ? `Conversar em #${title}` : `Mensagem para ${title}`}
          canAttach={hasPermission(perms, Permission.ATTACH_FILES)}
        />
      ) : (
        <div className="composer composer-disabled">Você não tem permissão para enviar mensagens neste canal.</div>
      )}
    </section>
  );
}

function PendingMessage({
  body,
  failed,
  onRetry,
}: {
  body: string;
  failed?: boolean | undefined;
  onRetry: () => void;
}) {
  return (
    <div className="msg msg-grouped msg-pending" data-failed={failed ? 'true' : undefined}>
      <div className="msg-body">{body}</div>
      {failed && (
        <button className="link-btn small danger-text" onClick={onRetry}>
          Falha ao enviar. Tentar novamente
        </button>
      )}
    </div>
  );
}

/** Envio com idempotência: o mesmo requestId é reenviado em retries; o servidor deduplica. */
export async function sendMessage(
  key: TargetKey,
  target: ChatTarget,
  requestId: string,
  body: string,
  replyToId?: string,
  attachmentIds?: string[],
) {
  const store = useMessages.getState();
  store.addPending(key, requestId, {
    body,
    createdAt: new Date().toISOString(),
    ...(replyToId ? { replyToId } : {}),
    ...(attachmentIds ? { attachmentIds } : {}),
  });
  const rt = useSession.getState().realtime;
  try {
    if (rt?.connected) {
      await rt.command('chat:message:create', {
        requestId,
        body,
        ...(target.channelId ? { channelId: target.channelId } : { conversationId: target.conversationId }),
        ...(replyToId ? { replyToId } : {}),
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      });
    } else {
      const m = await api().request<Message>('POST', `${path(target)}/messages`, {
        requestId,
        body,
        ...(replyToId ? { replyToId } : {}),
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      });
      store.upsert(m);
    }
    store.resolvePending(key, requestId);
  } catch (e) {
    store.resolvePending(key, requestId, true);
    useUi.getState().toast('error', `Mensagem não enviada: ${describeError(e)}`);
  }
}

function retry(key: TargetKey, target: ChatTarget, requestId: string) {
  const p = useMessages.getState().get(key).pending[requestId];
  if (p) void sendMessage(key, target, requestId, p.body, p.replyToId, p.attachmentIds);
}
