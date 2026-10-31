import { hasPermission, Permission, type Conversation } from '@opencord/contracts';
import { Avatar, Button, Icon, portalTarget, Slider, STATUS_LABEL } from '@opencord/ui';
import { useEffect, useId, useRef, useState, type ReactNode, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { keyOf, useData, type TargetKey } from '../../store/data';
import { updateSettings } from '../../store/settings';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';
import { StreamPreviewCard, watchStream } from '../../components/StreamPreview';
import { moveTargets, moveToVoice } from './voiceMove';
import { PlayingNow } from './Playing';

/** Conversa aberta agora (canal de texto ou DM), onde "Mencionar" insere a menção. */
function currentChatKey(): TargetKey | null {
  const v = useUi.getState().view;
  if (v.kind === 'dm') return keyOf({ conversationId: v.conversationId });
  if (v.kind !== 'server' || !v.channelId) return null;
  const ch = useData.getState().details[v.serverId]?.channels.find((c) => c.id === v.channelId);
  return ch?.kind === 'text' ? keyOf({ channelId: ch.id }) : null;
}

const apiError = (e: unknown) => useUi.getState().toast('error', describeError(e));

/** Itens do menu de contexto de um membro (botão direito na lista de membros, avatar ou pessoa na voz). */
export function memberMenu(userId: string, serverId: string | undefined, openProfile: () => void): MenuEntry[] {
  const d = useData.getState();
  const me = d.me?.id;
  const detail = serverId ? d.details[serverId] : undefined;
  const user =
    detail?.members.find((m) => m.user.id === userId)?.user ?? d.friends.find((f) => f.user.id === userId)?.user;
  if (!user) return [];
  const isMe = userId === me;
  const perms = detail?.myPermissions;
  const canKick = Boolean(
    detail && perms && hasPermission(perms, Permission.KICK_MEMBERS) && !isMe && detail.ownerId !== userId,
  );
  const voice = d.voiceStates[userId];
  const v = useVoice.getState();
  // volume/silenciar local só fazem sentido com os dois na mesma chamada
  const sameCall = Boolean(
    voice && !isMe && v.machine.status !== 'disconnected' && v.machine.channelId === voice.channelId,
  );
  const chatKey = currentChatKey();

  const items: MenuEntry[] = [{ label: 'Perfil', icon: 'users', onSelect: openProfile }];
  if (!isMe)
    items.push({
      label: d.settings?.friendNicknames[userId] ? 'Editar apelido de amigo' : 'Adicionar apelido de amigo',
      icon: 'edit',
      hint: 'Só você vê',
      onSelect: () => useUi.getState().openModal({ kind: 'friend-nickname', userId }),
    });
  if (chatKey) {
    items.push({
      label: 'Mencionar',
      icon: 'at-symbol',
      onSelect: () => {
        const ui = useUi.getState();
        const cur = ui.drafts[chatKey] ?? '';
        ui.setDraft(chatKey, `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}<@${userId}> `);
      },
    });
  }
  if (!isMe) {
    items.push({
      label: 'Mensagem',
      icon: 'chat',
      onSelect: () =>
        void api()
          .request<Conversation>('POST', '/conversations', { userIds: [userId] })
          .then((c) => {
            useData.getState().upsertConversation(c);
            useUi.getState().go({ kind: 'dm', conversationId: c.id });
          })
          .catch(apiError),
    });
    if (!d.friends.some((f) => f.user.id === userId)) {
      items.push({
        label: 'Adicionar amigo',
        icon: 'user-plus',
        onSelect: () =>
          void api()
            .request('POST', '/friends/requests', { username: user.username })
            .then(() => useUi.getState().toast('success', 'Pedido de amizade enviado.'))
            .catch(apiError),
      });
    }
  }
  if (sameCall) {
    items.push(
      'separator',
      {
        kind: 'slider',
        label: 'Volume do usuário',
        value: d.settings?.perUserVolume[userId] ?? 1,
        min: 0,
        max: 2,
        step: 0.05,
        format: (x) => `${Math.round(x * 100)}%`,
        onChange: (x) => {
          useVoice.getState().setUserVolume(userId, x);
          updateSettings((s) => ({ ...s, perUserVolume: { ...s.perUserVolume, [userId]: x } }));
        },
      },
      {
        label: 'Silenciar',
        hint: 'Só para você',
        checked: Boolean(v.localMuted[userId]),
        onSelect: () => useVoice.getState().setUserMuted(userId, !v.localMuted[userId]),
      },
    );
  }
  const mod: MenuEntry[] = [];
  // Cargos ›: marcar/desmarcar vários sem fechar; a API valida a hierarquia (só cargos abaixo do seu)
  if (detail && perms && hasPermission(perms, Permission.MANAGE_ROLES)) {
    const owner = detail.ownerId === me;
    const mine = detail.members.find((m) => m.user.id === me)?.roleIds ?? [];
    const myTop = owner
      ? Infinity
      : Math.max(0, ...detail.roles.filter((r) => mine.includes(r.id)).map((r) => r.position));
    const roles = detail.roles.filter((r) => !r.isEveryone).sort((a, b) => b.position - a.position);
    if (roles.length) {
      mod.push({
        kind: 'submenu',
        label: 'Cargos',
        items: roles.map((r) => ({
          label: r.name,
          color: r.color,
          checked: detail.members.find((m) => m.user.id === userId)?.roleIds.includes(r.id) ?? false,
          disabled: r.position >= myTop,
          keepOpen: true,
          onSelect: () => {
            // estado mais recente (outro clique pode ter mudado a lista desde que o menu abriu)
            const cur = useData.getState().details[serverId!]?.members.find((m) => m.user.id === userId)?.roleIds ?? [];
            const next = cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id];
            useData
              .getState()
              .upsertMember(serverId!, { ...detail.members.find((m) => m.user.id === userId)!, roleIds: next });
            void api()
              .request('PUT', `/servers/${serverId}/members/${userId}/roles`, { roleIds: next })
              .catch((e: unknown) => {
                useData.getState().upsertMember(serverId!, {
                  ...detail.members.find((m) => m.user.id === userId)!,
                  roleIds: cur,
                });
                apiError(e);
              });
          },
        })),
      });
    }
  }
  if (voice && !isMe && perms && hasPermission(perms, Permission.MUTE_MEMBERS))
    mod.push({
      label: 'Silenciar voz no servidor',
      danger: true,
      checked: voice.serverMute,
      onSelect: () =>
        void api().request('PUT', `/voice/members/${userId}/server-mute`, { muted: !voice.serverMute }).catch(apiError),
    });
  // Mover para ›: o mesmo que arrastar na lista de canais, pelo teclado
  const targets = voice && !isMe && serverId ? moveTargets(serverId, voice.channelId) : [];
  if (targets.length)
    mod.push({
      kind: 'submenu',
      label: 'Mover para',
      items: targets.map((c) => ({
        label: c.name,
        icon: 'speaker',
        onSelect: () => moveToVoice(userId, serverId!, c.id),
      })),
    });
  if (voice && !isMe && perms && hasPermission(perms, Permission.MOVE_MEMBERS))
    mod.push({
      label: 'Desconectar',
      danger: true,
      onSelect: () => void api().request('DELETE', `/voice/members/${userId}`).catch(apiError),
    });
  if (canKick && serverId)
    mod.push({
      label: `Expulsar ${user.displayName}`,
      icon: 'user-minus',
      danger: true,
      onSelect: () => {
        if (confirm(`Expulsar ${user.displayName} do servidor?`))
          void api().request('DELETE', `/servers/${serverId}/members/${userId}`).catch(apiError);
      },
    });
  if (mod.length) items.push('separator', ...mod);
  items.push('separator', {
    label: 'Copiar ID do usuário',
    icon: 'copy',
    onSelect: () => void navigator.clipboard.writeText(userId),
  });
  return items;
}

/** Botão que abre um popover de perfil (mensagem, amizade, volume individual, moderação). */
export function ProfileButton({
  userId,
  serverId,
  className,
  children,
}: {
  userId: string;
  serverId?: string;
  className?: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = anchor !== null;
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    setAnchor(next && ref.current ? ref.current.getBoundingClientRect() : null);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setAnchor(null);
        return;
      }
      // o cartão é renderizado em portal: cliques dentro dele não fecham
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !cardRef.current?.contains(t)) setAnchor(null);
    };
    const dismiss = () => setAnchor(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) =>
          openContextMenu(
            e,
            memberMenu(userId, serverId, () => setOpen(true)),
            'Ações do membro',
          )
        }
      >
        {children}
      </button>
      {anchor &&
        createPortal(
          <ProfileCard
            id={popId}
            userId={userId}
            serverId={serverId}
            anchor={anchor}
            cardRef={cardRef}
            onClose={() => setAnchor(null)}
          />,
          portalTarget(ref.current),
        )}
    </div>
  );
}

/**
 * Cartão de perfil em portal com posição fixa: não é cortado por listas com rolagem nem fica atrás do chat.
 * Abre ao lado do elemento clicado (à esquerda se não couber à direita) e sempre dentro da janela.
 */
function ProfileCard({
  id,
  userId,
  serverId,
  anchor,
  cardRef,
  onClose,
}: {
  id: string;
  userId: string;
  serverId?: string | undefined;
  anchor: DOMRect;
  cardRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 8;
    const fitsRight = anchor.right + gap + w <= window.innerWidth - 8;
    const left = fitsRight ? anchor.right + gap : Math.max(8, anchor.left - gap - w);
    const top = Math.min(Math.max(8, anchor.top), window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor, cardRef]);
  const me = useData((s) => s.me);
  // apelido que eu dei (só eu vejo): vira o nome principal; o nome real fica embaixo
  const alias = useData((s) => s.settings?.friendNicknames[userId]);
  const detail = useData((s) => (serverId ? s.details[serverId] : undefined));
  const friends = useData((s) => s.friends);
  const presence = useData((s) => s.presence[userId] ?? 'offline');
  const volume = useData((s) => s.settings?.perUserVolume[userId] ?? 1);
  const voiceState = useData((s) => s.voiceStates[userId]);
  const member = detail?.members.find((m) => m.user.id === userId);
  const friendUser = friends.find((f) => f.user.id === userId)?.user;
  const user = member?.user ?? friendUser;
  const isMe = me?.id === userId;
  const friendship = friends.find((f) => f.user.id === userId);
  const canKick =
    detail && hasPermission(detail.myPermissions, Permission.KICK_MEMBERS) && !isMe && detail.ownerId !== userId;
  const canMute = detail && hasPermission(detail.myPermissions, Permission.MUTE_MEMBERS) && voiceState && !isMe;
  const voiceChannel = voiceState ? detail?.channels.find((c) => c.id === voiceState.channelId) : undefined;
  const myCall = useVoice((s) => (s.machine.status === 'disconnected' ? null : s.machine.channelId));
  if (!user) return null;

  const run = (fn: () => Promise<unknown>, ok?: string) =>
    void fn().then(
      () => {
        if (ok) useUi.getState().toast('success', ok);
        onClose();
      },
      (e: unknown) => useUi.getState().toast('error', describeError(e)),
    );

  return (
    <div
      ref={cardRef}
      id={id}
      className="profile-card"
      role="dialog"
      aria-label={`Perfil de ${alias ?? user.displayName}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      <div className="profile-head">
        <Avatar id={user.id} name={user.displayName} size={56} status={isMe ? undefined : presence} />
        <div>
          <strong>{alias ?? member?.nickname ?? user.displayName}</strong>
          <div className="muted">
            {alias && <span data-tip="Apelido que só você vê">{user.displayName} · </span>}@{user.username}
          </div>
          {!isMe && <div className="muted small">{STATUS_LABEL[presence]}</div>}
        </div>
      </div>
      <PlayingNow userId={userId} />
      {member && detail && (
        <div className="profile-roles">
          {member.roleIds.map((rid) => {
            const r = detail.roles.find((x) => x.id === rid);
            return r ? (
              <span key={rid} className="role-chip" style={{ borderColor: r.color ?? undefined }}>
                {r.name}
              </span>
            ) : null;
          })}
        </div>
      )}
      {voiceChannel && serverId && (
        <div className="profile-voice">
          <span className="muted small">Em voz</span>
          <div className="profile-voice-name">
            <Icon name="speaker" size={16} />
            <strong className="truncate">{voiceChannel.name}</strong>
          </div>
          {voiceState?.streaming && !isMe && (
            <StreamPreviewCard
              userId={userId}
              previewAt={voiceState.previewAt ?? null}
              name={alias ?? member?.nickname ?? user.displayName}
              showName={false}
              onWatch={() => {
                void watchStream(serverId, voiceChannel.id, userId, myCall === voiceChannel.id);
                onClose();
              }}
            />
          )}
          <Button
            variant="secondary"
            onClick={() => {
              useUi.getState().go({ kind: 'server', serverId, channelId: voiceChannel.id });
              if (myCall !== voiceChannel.id) void useVoice.getState().join(voiceChannel.id, serverId);
              onClose();
            }}
          >
            {myCall === voiceChannel.id ? 'Abrir chamada de voz' : 'Entrar na chamada'}
          </Button>
        </div>
      )}
      {!isMe && (
        <div className="profile-actions">
          <Button variant="secondary" onClick={() => useUi.getState().openModal({ kind: 'profile', userId })}>
            <Icon name="user" size={16} /> Perfil completo
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              run(async () => {
                const c = await api().request<Conversation>('POST', '/conversations', { userIds: [userId] });
                useData.getState().upsertConversation(c);
                useUi.getState().go({ kind: 'dm', conversationId: c.id });
              })
            }
          >
            <Icon name="chat" size={16} /> Mensagem
          </Button>
          {!friendship && (
            <Button
              variant="secondary"
              onClick={() =>
                run(
                  () => api().request('POST', '/friends/requests', { username: user.username }),
                  'Pedido de amizade enviado.',
                )
              }
            >
              <Icon name="user-plus" size={16} /> Adicionar amigo
            </Button>
          )}
          {voiceState && (
            <Slider
              label="Volume do usuário"
              min={0}
              max={2}
              step={0.05}
              value={volume}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => {
                useVoice.getState().setUserVolume(userId, v);
                updateSettings((s) => ({ ...s, perUserVolume: { ...s.perUserVolume, [userId]: v } }));
              }}
            />
          )}
          {canMute && (
            <Button
              variant="secondary"
              onClick={() =>
                run(() =>
                  api().request('PUT', `/voice/members/${userId}/server-mute`, { muted: !voiceState.serverMute }),
                )
              }
            >
              <Icon name="microphone" size={16} slashed={!voiceState.serverMute} />{' '}
              {voiceState.serverMute ? 'Remover silêncio' : 'Silenciar no servidor'}
            </Button>
          )}
          {canKick && serverId && (
            <Button
              variant="danger"
              onClick={() => {
                if (confirm(`Expulsar ${user.displayName} do servidor?`))
                  run(() => api().request('DELETE', `/servers/${serverId}/members/${userId}`), 'Membro expulso.');
              }}
            >
              <Icon name="user-minus" size={16} /> Expulsar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
