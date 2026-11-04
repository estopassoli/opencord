import { askConfirm } from '../../components/AskDialog';
import { hasPermission, Permission, type Message } from '@opencord/contracts';
import { Avatar, Button, Icon, TextArea } from '@opencord/ui';
import { memo, useEffect, useState, type KeyboardEvent } from 'react';
import { useSession, api, describeError } from '../../store/session';
import { useUi, type MediaItem } from '../../store/ui';
import { keyOf, normalizeMessage, useData, useMessages, type TargetKey } from '../../store/data';
import { openContextMenu } from '../../components/ContextMenu';
import { ProfileButton } from '../shell/ProfileButton';
import { renderRich } from './rich';
import { InviteEmbed, inviteCodesIn } from './InviteEmbed';
import { VoiceNote } from './VoiceNote';
import { PollCard } from './Poll';
import { EmbedCards } from './Embeds';
import { ComponentRows } from './Components';
import { ReactionRoleChips, ReactionRolesDialog } from './ReactionRoles';
import type { ChatTarget } from './ChatView';
import { nameFor } from '../../lib/names';
import { enterSends, useTouchKeyboard } from '../../lib/media';
import { messageAppsMenu } from './messageApps';
import { ChatImage } from './ChatImage';
import { UserBadges } from '../../components/UserBadges';
import { canReplyPrivately, openQuotedMessage, startPrivateReply } from './privateReply';

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
  message: raw,
  grouped,
  meId,
  perms,
  target,
  nameOf,
  mentionsMe,
}: Props) {
  // API mais antiga que o app pode não mandar os campos novos (ver normalizeMessage)
  const m = normalizeMessage(raw);
  // edição controlada pelo store: permite "seta para cima" no composer abrir a edição da última mensagem
  const editing = useUi((st) => st.editing === m.id);
  const setEditing = (on: boolean) => useUi.getState().setEditing(on ? m.id : null);
  const [draft, setDraft] = useState(m.body);
  useEffect(() => {
    if (editing) setDraft(m.body);
  }, [editing, m.body]);
  const [picker, setPicker] = useState(false);
  const touchKeyboard = useTouchKeyboard();
  const [rrOpen, setRrOpen] = useState(false);
  const mine = m.author.id === meId;
  const canDelete = mine || hasPermission(perms, Permission.MANAGE_MESSAGES);
  // enquete não se edita (ADR-0018)
  const canEdit = mine && !m.poll;
  const canReact = hasPermission(perms, Permission.ADD_REACTIONS);
  // na DM qualquer participante fixa; no canal, quem gerencia mensagens
  const canPin = Boolean(target.conversationId) || hasPermission(perms, Permission.MANAGE_MESSAGES);
  const time = new Date(m.createdAt);
  const serverId = useUi((s) => (s.view.kind === 'server' ? s.view.serverId : undefined));
  // cargos por reação (ADR-0019): quem gerencia cargos configura, em mensagens de canal
  const canRoles = useData((s) =>
    Boolean(
      target.channelId && serverId && hasPermission(s.details[serverId]?.myPermissions ?? 0, Permission.MANAGE_ROLES),
    ),
  );

  const channelName = useData((s) =>
    serverId && target.channelId
      ? (s.details[serverId]?.channels.find((c) => c.id === target.channelId)?.name ?? '')
      : '',
  );
  const privateOk = canReplyPrivately(m, meId);
  const replyPrivately = () => void startPrivateReply(m, nameOf(m.author.id), channelName);

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

  const remove = async () => {
    if (
      !(await askConfirm('A mensagem some para todo mundo.', {
        title: 'Excluir mensagem',
        confirmLabel: 'Excluir',
        danger: true,
      }))
    )
      return;
    void api()
      .request('DELETE', `/messages/${m.id}`)
      .catch((e: unknown) => useUi.getState().toast('error', describeError(e)));
  };

  const togglePin = () =>
    void api()
      .request(m.pinnedAt ? 'DELETE' : 'PUT', `/messages/${m.id}/pin`)
      .catch((e: unknown) => useUi.getState().toast('error', describeError(e)));

  const editKeys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && enterSends()) {
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
        ...(privateOk ? [{ label: 'Responder no privado', icon: 'mail' as const, onSelect: replyPrivately }] : []),
        ...(!m.deleted
          ? [
              {
                label: m.replyCount ? `Abrir thread (${m.replyCount})` : 'Abrir thread',
                icon: 'chats' as const,
                onSelect: () => useUi.getState().openThread(keyOf(target), m.id),
              },
            ]
          : []),
        ...(canEdit ? [{ label: 'Editar mensagem', icon: 'edit' as const, onSelect: () => setEditing(true) }] : []),
        ...(canPin
          ? [
              {
                label: m.pinnedAt ? 'Desafixar mensagem' : 'Fixar mensagem',
                icon: m.pinnedAt ? ('pin-off' as const) : ('pin' as const),
                onSelect: togglePin,
              },
            ]
          : []),
        ...(canRoles
          ? [
              {
                label: m.reactionRoles.length ? 'Editar cargos por reação' : 'Cargos por reação…',
                icon: 'tag' as const,
                onSelect: () => setRrOpen(true),
              },
            ]
          : []),
        ...(!m.deleted ? messageAppsMenu(serverId, m.id) : []),
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
      data-msg-id={m.id}
      data-pinned={m.pinnedAt ? 'true' : undefined}
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
              <strong>{m.replyTo.author ? nameOf(m.replyTo.author.id) : null}</strong>{' '}
              <span className="truncate">{m.replyTo.bodyPreview}</span>
            </>
          )}
        </div>
      )}
      {m.privateReplyTo && (
        <button
          type="button"
          className="msg-reply msg-private-reply"
          aria-label={`Ver a mensagem respondida em #${m.privateReplyTo.channelName}`}
          onClick={() => {
            const q = m.privateReplyTo!;
            if (!q.deleted) openQuotedMessage(q.serverId, q.channelId, q.id);
          }}
        >
          <Icon name="mail" size={14} />
          <span className="muted">Respondeu no privado em</span>
          <span className="msg-private-where truncate">
            #{m.privateReplyTo.channelName} · {m.privateReplyTo.serverName}
          </span>
          {m.privateReplyTo.deleted ? (
            <em className="muted">mensagem excluída</em>
          ) : (
            <>
              <strong>
                {m.privateReplyTo.author
                  ? nameFor(m.privateReplyTo.author.id, m.privateReplyTo.author.displayName)
                  : null}
              </strong>
              <span className="truncate">{m.privateReplyTo.bodyPreview || 'Anexo'}</span>
            </>
          )}
        </button>
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
            {nameOf(m.author.id) === 'alguém' ? nameFor(m.author.id, m.author.displayName) : nameOf(m.author.id)}
            {m.author.verified && (
              <span className="creator-badge" data-tip="Perfil verificado">
                <Icon name="verified" size={14} active label="Verificado" />
              </span>
            )}
            <UserBadges userId={m.author.id} fallback={m.author.badges} />
            {m.author.bot && (
              <span className="bot-badge" data-tip="Aplicativo">
                APP
              </span>
            )}
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
          {touchKeyboard ? (
            <span className="msg-edit-actions">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => void saveEdit()}>
                Salvar
              </Button>
            </span>
          ) : (
            <span className="small muted">Enter para salvar · Esc para cancelar</span>
          )}
        </div>
      ) : m.body || m.poll || m.pinnedAt || m.editedAt ? (
        // mensagem só com embeds/componentes (corpo vazio) não mostra o texto vazio
        <div className="msg-body">
          {m.pinnedAt && (
            <span className="msg-pin" data-tip="Mensagem fixada">
              <Icon name="pin" size={14} label="Mensagem fixada" />
            </span>
          )}
          {m.poll ? (
            <PollCard
              poll={m.poll}
              messageId={m.id}
              targetKey={keyOf(target)}
              canClose={mine || (Boolean(target.channelId) && hasPermission(perms, Permission.MANAGE_MESSAGES))}
            />
          ) : (
            renderRich(m.body, nameOf)
          )}
          {m.editedAt && (
            <span className="msg-edited" data-tip={new Date(m.editedAt).toLocaleString()}>
              {' '}
              (editada)
            </span>
          )}
        </div>
      ) : null}
      {inviteCodesIn(m.body).map((code) => (
        <InviteEmbed key={code} code={code} />
      ))}
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
                <ChatImage
                  src={a.url}
                  alt={a.originalName}
                  width={a.width}
                  height={a.height}
                  maxWidth={400}
                  maxHeight={320}
                />
              </a>
            ) : a.mime.startsWith('video/') ? (
              <video key={a.id} src={a.url} controls className="attachment-video" preload="metadata" />
            ) : a.mime.startsWith('audio/') ? (
              <VoiceNote key={a.id} attachment={a} />
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
      {/* bots v2 (ADR-0034): cartões ricos e botões/menus abaixo do texto e dos anexos */}
      {m.embeds.length > 0 && (
        <EmbedCards
          embeds={m.embeds}
          nameOf={nameOf}
          author={{ id: m.author.id, name: nameOf(m.author.id), createdAt: m.createdAt }}
        />
      )}
      {m.components.length > 0 && (
        <ComponentRows rows={m.components} source={{ messageId: m.id }} serverId={serverId} nameOf={nameOf} />
      )}
      {m.reactionRoles.length > 0 && (
        <ReactionRoleChips message={m} serverId={serverId} canReact={canReact} react={react} />
      )}
      {rrOpen && serverId && <ReactionRolesDialog message={m} serverId={serverId} onClose={() => setRrOpen(false)} />}
      {m.replyCount > 0 && !m.deleted && (
        <button className="msg-thread" onClick={() => useUi.getState().openThread(keyOf(target), m.id)}>
          <Icon name="chats" size={14} />
          {m.replyCount === 1 ? '1 resposta' : `${m.replyCount} respostas`} · ver thread
        </button>
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
              data-tip={r.userIds.map(nameOf).join(', ')}
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
        {privateOk && (
          <button
            className="icon-btn icon-btn-sm"
            aria-label="Responder no privado"
            data-tip="Responder no privado"
            onClick={replyPrivately}
          >
            <Icon name="mail" size={18} />
          </button>
        )}
        {canEdit && (
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
