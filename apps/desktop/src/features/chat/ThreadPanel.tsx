/**
 * Thread leve: painel lateral com a mensagem raiz e as respostas diretas a ela (as que já estão na conversa mais as
 * antigas, buscadas na API), e uma caixa para responder sem sair do fluxo do canal. Não é um canal à parte: as
 * respostas continuam aparecendo na conversa, com "Respondendo a…".
 */
import type { Message } from '@opencord/contracts';
import { Avatar, Icon, TextArea } from '@opencord/ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAliases } from '../../lib/names';
import { mergeMessages, useData, useMessages, type TargetKey } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { sendMessage, type ChatTarget } from './ChatView';
import { jumpTo } from './PinnedMessages';
import { renderRich } from './rich';

const targetOfKey = (key: TargetKey): ChatTarget =>
  key.startsWith('c:') ? { channelId: key.slice(2) } : { conversationId: key.slice(2) };

export function ThreadPanel({ thread }: { thread: { key: TargetKey; rootId: string } }) {
  const { key, rootId } = thread;
  const target = useMemo(() => targetOfKey(key), [key]);
  const timeline = useMessages((s) => s.timelines[key]?.messages);
  const aliases = useAliases();
  const detail = useData((s) =>
    target.channelId
      ? Object.values(s.details).find((d) => d.channels.some((c) => c.id === target.channelId))
      : undefined,
  );
  const conv = useData((s) =>
    target.conversationId ? s.conversations.find((c) => c.id === target.conversationId) : undefined,
  );
  const [fetched, setFetched] = useState<Message[] | null>(null);
  const [root, setRoot] = useState<Message | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);

  const nameOf = (id: string) => {
    const m = detail?.members.find((x) => x.user.id === id);
    const u = conv?.members.find((x) => x.id === id);
    return aliases?.[id] ?? m?.nickname ?? m?.user.displayName ?? u?.displayName ?? 'alguém';
  };

  useEffect(() => {
    setFetched(null);
    setError(null);
    void api()
      .request<Message[]>('GET', `/messages/${rootId}/replies`)
      .then(setFetched, (e: unknown) => setError(describeError(e)));
  }, [rootId]);

  // raiz: da conversa carregada; se não estiver, aparece pelo "Respondendo a" da primeira resposta
  const loadedRoot = timeline?.find((m) => m.id === rootId) ?? null;
  useEffect(() => {
    if (loadedRoot) setRoot(loadedRoot);
  }, [loadedRoot]);

  const replies = useMemo(() => {
    const live = (timeline ?? []).filter((m) => m.replyTo?.id === rootId);
    return mergeMessages(fetched ?? [], live);
  }, [fetched, timeline, rootId]);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    void sendMessage(key, target, crypto.randomUUID(), body, rootId);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') useUi.getState().closeThread();
  };

  const Row = ({ m, isRoot }: { m: Message; isRoot?: boolean }) => (
    <article className="thread-msg" data-root={isRoot ? 'true' : undefined} data-msg-id={isRoot ? undefined : m.id}>
      <Avatar id={m.author.id} name={m.author.displayName} size={28} />
      <div className="thread-main">
        <div className="pin-meta">
          <strong className="truncate">{nameOf(m.author.id)}</strong>
          <time className="msg-time" dateTime={m.createdAt}>
            {new Date(m.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
          </time>
        </div>
        {m.deleted ? (
          <p className="muted small">mensagem apagada</p>
        ) : (
          <div className="pin-body">{renderRich(m.body, nameOf)}</div>
        )}
        {m.attachments.length > 0 && (
          <div className="muted small">{m.attachments.map((a) => a.originalName).join(', ')}</div>
        )}
      </div>
    </article>
  );

  return (
    <aside className="members thread-panel" aria-label="Thread">
      <header className="thread-head">
        <Icon name="chats" size={18} />
        <h3>Thread</h3>
        <span className="muted small">{replies.length === 1 ? '1 resposta' : `${replies.length} respostas`}</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label="Ir para a mensagem na conversa"
          data-tip="Ver na conversa"
          onClick={() => {
            if (!jumpTo(rootId)) useUi.getState().toast('info', 'Role a conversa para cima para chegar nela.');
          }}
        >
          <Icon name="spotlight" size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="Fechar thread"
          data-tip="Fechar"
          onClick={() => useUi.getState().closeThread()}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="thread-list" ref={list}>
        {root ? <Row m={root} isRoot /> : <p className="muted small">Mensagem original fora da parte carregada.</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {replies.map((m) => (
          <Row key={m.id} m={m} />
        ))}
        {fetched && replies.length === 0 && <p className="muted small">Ninguém respondeu ainda.</p>}
      </div>
      <div className="thread-composer">
        <TextArea
          bare
          rows={1}
          value={draft}
          placeholder="Responder na thread…"
          aria-label="Responder na thread"
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <button
          className="icon-btn"
          aria-label="Enviar resposta"
          data-tip="Enviar (Enter)"
          onClick={send}
          disabled={!draft.trim()}
        >
          <Icon name="send" />
        </button>
      </div>
    </aside>
  );
}
