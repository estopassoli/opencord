import { hasPermission, Permission, type Conversation } from '@opencord/contracts';
import { Avatar, Button, Icon, portalTarget, Slider, STATUS_LABEL } from '@opencord/ui';
import { useEffect, useId, useRef, useState, type ReactNode, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { useData } from '../../store/data';
import { updateSettings } from '../../store/settings';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

/** Itens do menu de contexto de um membro (botão direito na lista de membros/avatar). */
function memberMenu(userId: string, serverId: string | undefined, openProfile: () => void): MenuEntry[] {
  const d = useData.getState();
  const me = d.me?.id;
  const detail = serverId ? d.details[serverId] : undefined;
  const user =
    detail?.members.find((m) => m.user.id === userId)?.user ?? d.friends.find((f) => f.user.id === userId)?.user;
  if (!user) return [];
  const isMe = userId === me;
  const canKick = Boolean(
    detail && hasPermission(detail.myPermissions, Permission.KICK_MEMBERS) && !isMe && detail.ownerId !== userId,
  );
  const items: MenuEntry[] = [{ label: 'Perfil', icon: 'users', onSelect: openProfile }];
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
          .catch((e: unknown) => useUi.getState().toast('error', describeError(e))),
    });
    if (!d.friends.some((f) => f.user.id === userId)) {
      items.push({
        label: 'Adicionar amigo',
        icon: 'user-plus',
        onSelect: () =>
          void api()
            .request('POST', '/friends/requests', { username: user.username })
            .then(() => useUi.getState().toast('success', 'Pedido de amizade enviado.'))
            .catch((e: unknown) => useUi.getState().toast('error', describeError(e))),
      });
    }
  }
  if (canKick && serverId) {
    items.push('separator', {
      label: `Expulsar ${user.displayName}`,
      icon: 'user-minus',
      danger: true,
      onSelect: () => {
        if (confirm(`Expulsar ${user.displayName} do servidor?`))
          void api()
            .request('DELETE', `/servers/${serverId}/members/${userId}`)
            .catch((e: unknown) => useUi.getState().toast('error', describeError(e)));
      },
    });
  }
  items.push('separator', {
    label: 'Copiar ID',
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
      aria-label={`Perfil de ${user.displayName}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      <div className="profile-head">
        <Avatar id={user.id} name={user.displayName} size={56} status={isMe ? undefined : presence} />
        <div>
          <strong>{member?.nickname ?? user.displayName}</strong>
          <div className="muted">@{user.username}</div>
          {!isMe && <div className="muted small">{STATUS_LABEL[presence]}</div>}
        </div>
      </div>
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
      {!isMe && (
        <div className="profile-actions">
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
