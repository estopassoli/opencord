import { MobileNavButton } from '../../components/MobileNavButton';
import { useIsMobile } from '../../lib/media';
import { hasPermission, Permission, type Message, type MessagePage } from '@opencord/contracts';
import { Icon } from '@opencord/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBots } from '../../store/bots';
import { keyOf, useData, useMessages, type TargetKey } from '../../store/data';
import { api, describeError, markTargetRead, useSession } from '../../store/session';
import { ApiError } from '../../lib/api';
import { noteRefused, noteSent } from '../../lib/slowmode';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { DmCallBar } from './DmCallBar';
import { Composer } from './Composer';
import { EphemeralReplies } from './EphemeralReplies';
import { useDmPeer } from '../shell/DmProfilePanel';
import { MessageItem } from './MessageItem';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { PinnedMessages } from './PinnedMessages';
import { MessageSearch } from './MessageSearch';
import { useAliases } from '../../lib/names';
import { reopenConversation } from '../../lib/closedConversations';

export type ChatTarget =
  { channelId: string; conversationId?: undefined } | { conversationId: string; channelId?: undefined };

const GROUP_MS = 7 * 60 * 1000;
const path = (t: ChatTarget) => (t.channelId ? `/channels/${t.channelId}` : `/conversations/${t.conversationId}`);

export function ChatView({ target }: { target: ChatTarget }) {
  const aliases = useAliases();
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
  // retrato do "não lido" ao abrir: a linha "Novas" e a faixa do topo não mudam enquanto leio
  const [opened] = useState(() =>
    unread && unread.unreadCount > 0 && unread.lastReadMessageId
      ? { lastRead: unread.lastReadMessageId, count: unread.unreadCount }
      : null,
  );
  const firstUnreadId = opened?.lastRead ?? null;
  const [unreadBar, setUnreadBar] = useState(Boolean(opened));
  const [loadError, setLoadError] = useState<string | null>(null);

  // comandos dos bots do servidor (barra e "Apps" nos menus): prontos antes do primeiro "/" ou botão direito
  const serverIdForBots = channel?.serverId;
  useEffect(() => {
    if (serverIdForBots)
      void useBots
        .getState()
        .ensureCommands(serverIdForBots)
        .catch(() => undefined);
  }, [serverIdForBots]);

  const perms = channel?.myPermissions ?? Permission.SEND_MESSAGES | Permission.ATTACH_FILES | Permission.ADD_REACTIONS;
  const canSend = hasPermission(perms, Permission.SEND_MESSAGES);
  // DM com a conta de avisos do OpenCord (ADR-0045): só leitura, sem chamada nem convidar
  const noReply = Boolean(conv?.members.some((m) => m.system));
  const title = channel
    ? channel.name
    : conv
      ? (conv.name ??
        conv.members
          .filter((m) => m.id !== meId)
          .map((m) => aliases?.[m.id] ?? m.displayName)
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

  // abrir uma conversa fechada (pelo perfil, pela busca...) a traz de volta para a lista
  useEffect(() => {
    if (target.conversationId) reopenConversation(target.conversationId);
  }, [target.conversationId]);

  // falhou ao carregar (ex.: servidor reiniciando numa atualização): tenta de novo sozinho a cada 5 s
  useEffect(() => {
    if (!loadError) return;
    const t = setTimeout(() => void load(false), 5000);
    return () => clearTimeout(t);
  }, [loadError, load]);

  // faixa "N mensagens novas": some quando a linha "Novas" aparece na tela
  const dividerRef = useRef<HTMLDivElement>(null);
  const firstUnread = firstUnreadId ? timeline?.messages.find((x) => x.id > firstUnreadId) : undefined;
  useEffect(() => {
    const el = dividerRef.current;
    if (!unreadBar || !el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) setUnreadBar(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [unreadBar, firstUnread?.id]);
  const jumpToUnread = () => {
    if (dividerRef.current) dividerRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else useUi.getState().toast('info', 'As primeiras novas são antigas: role a conversa para cima para chegar nelas.');
  };

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

  // conteúdo que cresce depois (imagem sem dimensões, embed, convite) não tira do fim quem já estava lá
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = scroller.current;
    const ol = list.current;
    if (!el || !ol || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    ro.observe(ol);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (el.scrollTop < 200) void load(true);
  };

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) map.set(m.user.id, aliases?.[m.user.id] ?? m.nickname ?? m.user.displayName);
    for (const u of conv?.members ?? []) map.set(u.id, aliases?.[u.id] ?? u.displayName);
    return (id: string) => map.get(id) ?? 'alguém';
  }, [members, conv, aliases]);

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
        <MessageSearch
          target={target}
          serverId={channel?.serverId}
          people={
            channel
              ? (members ?? []).map((m) => ({ id: m.user.id, name: nameOf(m.user.id) }))
              : (conv?.members ?? []).map((u) => ({ id: u.id, name: nameOf(u.id) }))
          }
          nameOf={nameOf}
        />
        <PinnedMessages
          target={target}
          canUnpin={!channel || hasPermission(perms, Permission.MANAGE_MESSAGES)}
          nameOf={nameOf}
        />
        {!channel && target.conversationId && !noReply && (
          <button
            className="icon-btn"
            aria-label="Ligar"
            data-tip="Começar uma chamada"
            onClick={() => void useVoice.getState().joinConversation(target.conversationId as string)}
          >
            <Icon name="phone" />
          </button>
        )}
        {!channel && dmPeer && !noReply && (
          <button
            className="icon-btn"
            aria-label="Adicionar amigos à conversa"
            data-tip="Adicionar amigos à conversa"
            onClick={() => useUi.getState().openModal({ kind: 'add-to-dm', peerId: dmPeer.id })}
          >
            <Icon name="user-plus" />
          </button>
        )}
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
      {target.conversationId && <DmCallBar conversationId={target.conversationId} />}
      {unreadBar && opened && firstUnread && (
        <div className="unread-bar" role="status">
          <button className="unread-bar-jump" onClick={jumpToUnread}>
            {opened.count} {opened.count === 1 ? 'mensagem nova' : 'mensagens novas'} desde{' '}
            {new Date(firstUnread.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </button>
          <button
            className="unread-bar-read"
            onClick={() => {
              setUnreadBar(false);
              void markTargetRead(key);
            }}
          >
            Marcar como lido
            <Icon name="check" size={14} />
          </button>
        </div>
      )}
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
        {timeline?.loading && !loadError && <MessageSkeleton rows={timeline.loaded ? 2 : 7} />}
        {loadError && (
          <div className="chat-loading" role="alert">
            {loadError}{' '}
            <button className="link-btn" onClick={() => void load(false)}>
              Tentar de novo
            </button>
          </div>
        )}
        <ol className="messages" ref={list}>
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
            // ids são uuid v7 (crescem com o tempo): a linha vai antes da primeira mensagem depois da última lida,
            // mesmo que a lida já tenha saído da página carregada
            const unreadLine = Boolean(firstUnreadId && m.id > firstUnreadId && (!prev || prev.id <= firstUnreadId));
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
                  <div className="unread-divider" role="separator" ref={dividerRef}>
                    <span>Novas</span>
                  </div>
                )}
                {/* uma mensagem com problema mostra um aviso só nela; a conversa continua */}
                <ErrorBoundary area="esta mensagem">
                  <MessageItem
                    message={m}
                    grouped={grouped}
                    meId={meId}
                    perms={perms}
                    target={target}
                    nameOf={nameOf}
                    mentionsMe={m.mentions.includes(meId)}
                  />
                </ErrorBoundary>
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
      {target.channelId && <EphemeralReplies channelId={target.channelId} nameOf={nameOf} />}
      {channel?.boardId && (
        <p className="board-feed-hint muted small">
          <Icon name="kanban" size={14} /> Cada mensagem aqui vira um card no quadro da equipe.
        </p>
      )}
      {noReply ? (
        <div className="composer composer-disabled composer-noreply">
          <Icon name="inbox" size={16} /> Avisos automáticos do OpenCord. Esta conversa não recebe respostas.
        </div>
      ) : canSend ? (
        <Composer
          target={target}
          targetKey={key}
          placeholder={channel ? `Conversar em #${title}` : `Mensagem para ${title}`}
          canAttach={hasPermission(perms, Permission.ATTACH_FILES)}
          serverId={channel?.serverId}
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
  /** responder no privado (ADR-0042): mensagem de canal citada nesta DM */
  privateReplyToId?: string,
) {
  const store = useMessages.getState();
  store.addPending(key, requestId, {
    body,
    createdAt: new Date().toISOString(),
    ...(replyToId ? { replyToId } : {}),
    ...(privateReplyToId ? { privateReplyToId } : {}),
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
        ...(privateReplyToId ? { privateReplyToId } : {}),
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      });
    } else {
      const m = await api().request<Message>('POST', `${path(target)}/messages`, {
        requestId,
        body,
        ...(replyToId ? { replyToId } : {}),
        ...(privateReplyToId ? { privateReplyToId } : {}),
        ...(attachmentIds?.length ? { attachmentIds } : {}),
      });
      store.upsert(m);
    }
    store.resolvePending(key, requestId);
    if (target.channelId) noteSent(target.channelId);
  } catch (e) {
    // modo lento (ADR-0052): a caixa mostra a espera; a mensagem fica como "falhou" para reenviar depois
    if (target.channelId && noteRefused(target.channelId, describeError(e))) {
      store.resolvePending(key, requestId, true);
      useUi.getState().toast('info', describeError(e));
      return;
    }
    store.resolvePending(key, requestId, true);
    // retida/bloqueada pela moderação por IA (ADR-0036): o motivo já vem na mensagem
    if (e instanceof ApiError && e.status === 422) useUi.getState().toast('info', describeError(e));
    else useUi.getState().toast('error', `Mensagem não enviada: ${describeError(e)}`);
  }
}

function retry(key: TargetKey, target: ChatTarget, requestId: string) {
  const p = useMessages.getState().get(key).pending[requestId];
  if (p) void sendMessage(key, target, requestId, p.body, p.replyToId, p.attachmentIds, p.privateReplyToId);
}

/** Linhas cinzas no formato das mensagens enquanto a conversa carrega (variação fixa para não "piscar"). */
const SKELETON: { lines: number[]; media?: boolean }[] = [
  { lines: [72, 38] },
  { lines: [55] },
  { lines: [64, 80, 30] },
  { lines: [42], media: true },
  { lines: [86, 50] },
  { lines: [34] },
  { lines: [60, 45] },
];
function MessageSkeleton({ rows }: { rows: number }) {
  return (
    <ol className="msg-skeleton" aria-busy="true" aria-label="Carregando mensagens">
      {SKELETON.slice(0, rows).map((r, i) => (
        <li key={i} aria-hidden>
          <span className="sk sk-avatar" />
          <span className="sk-lines">
            <span className="sk sk-name" />
            {r.lines.map((w, j) => (
              <span key={j} className="sk sk-line" style={{ width: `${w}%` }} />
            ))}
            {r.media && <span className="sk sk-media" />}
          </span>
        </li>
      ))}
    </ol>
  );
}
