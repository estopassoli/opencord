import { hasPermission, Permission, type Message } from '@opencord/contracts';
import { Avatar, Icon, TextArea } from '@opencord/ui';
import { memo, useEffect, useState, type KeyboardEvent } from 'react';
import { useSession, api, describeError } from '../../store/session';
import { useUi, type MediaItem } from '../../store/ui';
import { keyOf, useMessages, type TargetKey } from '../../store/data';
import { openContextMenu } from '../../components/ContextMenu';
import { ProfileButton } from '../shell/ProfileButton';
import { renderRich } from './rich';
import type { ChatTarget } from './ChatView';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

interface Props {
  message: Message;
  grouped: boolean;
  meId: string;
  perms: number;
  target: ChatTarget;
  nameOf: (id: string) => string;
  mentionsMe: boolean;
}

/** Abre o visualizador com as imagens já carregadas da conversa, começando pela clicada. */
function openMediaFor(key: TargetKey, attachmentId: string) {
  const items: MediaItem[] = useMessages
    .getState()
    .get(key)
    .messages.flatMap((msg) =>
      msg.attachments
        .filter((a) => a.mime.startsWith('image/'))
        .map((a) => ({
          id: a.id,
          url: a.url,
          name: a.originalName,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
          width: a.width,
          height: a.height,
          authorId: msg.author.id,
          authorName: msg.author.displayName,
          createdAt: msg.createdAt,
        })),
    );
  const index = items.findIndex((x) => x.id === attachmentId);
  if (index >= 0) useUi.getState().openMedia(items, index);
}

export const MessageItem = memo(function MessageItem({
  message: m,
  grouped,
  meId,
  perms,
  target,
  nameOf,
  mentionsMe,
}: Props) {
  // edição controlada pelo store: permite "seta para cima" no composer abrir a edição da última mensagem
  const editing = useUi((st) => st.editing === m.id);
  const setEditing = (on: boolean) => useUi.getState().setEditing(on ? m.id : null);
  const [draft, setDraft] = useState(m.body);
  useEffect(() => {
    if (editing) setDraft(m.body);
  }, [editing, m.body]);
  const [picker, setPicker] = useState(false);
  const mine = m.author.id === meId;
  const canDelete = mine || hasPermission(perms, Permission.MANAGE_MESSAGES);
  const canReact = hasPermission(perms, Permission.ADD_REACTIONS);
  const time = new Date(m.createdAt);
  const serverId = useUi((s) => (s.view.kind === 'server' ? s.view.serverId : undefined));

  const react = (emoji: string, on: boolean) => {
    const rt = useSession.getState().realtime;
    setPicker(false);
    const p = rt?.connected
      ? rt.command('chat:reaction:set', { messageId: m.id, emoji, on })
      : api().request(on ? 'PUT' : 'DELETE', `/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`);
    void p.catch((e: unknown) => useUi.getState().toast('error', describeError(e)));
  };

  const saveEdit = async () => {
    const body = draft.trim();
    setEditing(false);
    if (!body || body === m.body) return;
    try {
      await api().request('PATCH', `/messages/${m.id}`, { body });
    } catch (e) {
      useUi.getState().toast('error', describeError(e));
    }
  };

  const remove = () => {
    if (!confirm('Excluir esta mensagem?')) return;
    void api()
      .request('DELETE', `/messages/${m.id}`)
      .catch((e: unknown) => useUi.getState().toast('error', describeError(e)));
  };

  const editKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
      setDraft(m.body);
    }
  };

  const onContextMenu = (e: React.MouseEvent | React.KeyboardEvent) =>
    openContextMenu(
      e,
      [
        ...(canReact
          ? QUICK_REACTIONS.slice(0, 3).map((em) => ({ label: `Reagir com ${em}`, onSelect: () => react(em, true) }))
          : []),
        ...(canReact ? (['separator'] as const) : []),
        {
          label: 'Responder',
          icon: 'reply' as const,
          onSelect: () => useUi.getState().setReplyTo(keyOf(target), m.id),
        },
        ...(mine ? [{ label: 'Editar mensagem', icon: 'edit' as const, onSelect: () => setEditing(true) }] : []),
        {
          label: 'Copiar texto',
          icon: 'copy' as const,
          disabled: !m.body,
          onSelect: () => void navigator.clipboard.writeText(m.body),
        },
        ...(canDelete
          ? ([
              'separator',
              { label: 'Excluir mensagem', icon: 'trash' as const, danger: true, onSelect: remove },
            ] as const)
          : []),
      ],
      'Ações da mensagem',
    );

  if (m.deleted) {
    return (
      <article className={grouped ? 'msg msg-grouped msg-deleted' : 'msg msg-deleted'}>
        <div className="msg-body muted">Mensagem excluída.</div>
      </article>
    );
  }

  return (
    <article
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) onContextMenu(e);
      }}
      tabIndex={-1}
      className={grouped ? 'msg msg-grouped' : 'msg'}
      data-mention={mentionsMe ? 'true' : undefined}
      aria-label={`${m.author.displayName}, ${time.toLocaleString()}`}
    >
      {m.replyTo && (
        <div className="msg-reply">
          <Icon name="reply" size={14} />
          {m.replyTo.deleted ? (
            <em className="muted">mensagem excluída</em>
          ) : (
            <>
              <strong>{m.replyTo.author?.displayName}</strong> <span className="truncate">{m.replyTo.bodyPreview}</span>
            </>
          )}
        </div>
      )}
      {!grouped && (
        <div className="msg-avatar">
          <ProfileButton userId={m.author.id} {...(serverId ? { serverId } : {})} className="avatar-btn">
            <Avatar id={m.author.id} name={m.author.displayName} size={40} />
          </ProfileButton>
        </div>
      )}
      {!grouped && (
        <header className="msg-head">
          <strong className="msg-author">
            {nameOf(m.author.id) === 'alguém' ? m.author.displayName : nameOf(m.author.id)}
          </strong>
          <time dateTime={m.createdAt} className="msg-time">
            {time.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
          </time>
        </header>
      )}
      {grouped && (
        <time dateTime={m.createdAt} className="msg-time-hover" aria-hidden>
          {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </time>
      )}
      {editing ? (
        <div className="msg-edit">
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={editKeys}
            autoFocus
            maxLength={4000}
            aria-label="Editar mensagem"
          />
          <span className="small muted">Enter para salvar · Esc para cancelar</span>
        </div>
      ) : (
        <div className="msg-body">
          {renderRich(m.body, nameOf)}
          {m.editedAt && (
            <span className="msg-edited" title={new Date(m.editedAt).toLocaleString()}>
              {' '}
              (editada)
            </span>
          )}
        </div>
      )}
      {m.attachments.length > 0 && (
        <div className="msg-attachments">
          {m.attachments.map((a) =>
            a.mime.startsWith('image/') ? (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="attachment-image"
                aria-label={`Abrir imagem ${a.originalName}`}
                onClick={(e) => {
                  // clique comum abre o visualizador com todas as imagens da conversa; ctrl/cmd segue o link
                  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  openMediaFor(keyOf(target), a.id);
                }}
              >
                <img
                  src={a.url}
                  alt={a.originalName}
                  loading="lazy"
                  width={a.width ?? undefined}
                  height={a.height ?? undefined}
                />
              </a>
            ) : a.mime.startsWith('video/') ? (
              <video key={a.id} src={a.url} controls className="attachment-video" preload="metadata" />
            ) : (
              <a key={a.id} href={a.url} className="attachment-file" target="_blank" rel="noreferrer">
                <Icon name="download" size={18} />
                <span className="truncate">{a.originalName}</span>
                <span className="muted small">{Math.max(1, Math.round(a.sizeBytes / 1024))} KB</span>
              </a>
            ),
          )}
        </div>
      )}
      {m.reactions.length > 0 && (
        <div className="reactions" role="group" aria-label="Reações">
          {m.reactions.map((r) => (
            <button
              key={r.emoji}
              className="reaction"
              aria-pressed={r.me}
              disabled={!canReact && !r.me}
              onClick={() => react(r.emoji, !r.me)}
              title={r.userIds.map(nameOf).join(', ')}
            >
              <span>{r.emoji}</span> <span>{r.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="msg-actions" role="toolbar" aria-label="Ações da mensagem">
        {canReact && (
          <div className="popover-anchor">
            <button
              className="icon-btn icon-btn-sm"
              aria-label="Adicionar reação"
              aria-expanded={picker}
              onClick={() => setPicker((p) => !p)}
            >
              <Icon name="emoji" size={18} />
            </button>
            {picker && (
              <div className="emoji-picker" role="menu">
                {QUICK_REACTIONS.map((e) => (
                  <button key={e} role="menuitem" onClick={() => react(e, true)} aria-label={`Reagir com ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          className="icon-btn icon-btn-sm"
          aria-label="Responder"
          onClick={() => useUi.getState().setReplyTo(keyOf(target), m.id)}
        >
          <Icon name="reply" size={18} />
        </button>
        {mine && (
          <button className="icon-btn icon-btn-sm" aria-label="Editar" onClick={() => setEditing(true)}>
            <Icon name="edit" size={18} />
          </button>
        )}
        {canDelete && (
          <button className="icon-btn icon-btn-sm icon-btn-danger" aria-label="Excluir" onClick={remove}>
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>
    </article>
  );
});
