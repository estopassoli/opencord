import { ProfileBadges } from '../../components/UserBadges';
import { ProfileCardHead, profileThemeVars } from '../../components/ProfileCardView';
import { ProfileClips } from '../../components/ProfileClips';
import { EMPTY_APPEARANCE, useProfiles } from '../../store/profiles';
import { askConfirm, askText } from '../../components/AskDialog';
import { hasPermission, Permission, type Conversation, type Member } from '@opencord/contracts';
import { Button, Icon, portalTarget, Slider, STATUS_LABEL } from '@opencord/ui';
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
import { removeFromRoomItem } from './rooms';
import { PlayingNow } from './Playing';
import { userAppsMenu } from '../chat/messageApps';
import { moderationTargets, openBanDialog, timeoutMenuItems } from '../admin/moderationActions';

const KICK = { title: 'Expulsar do servidor', confirmLabel: 'Expulsar', danger: true };

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
  const member = detail?.members.find((m) => m.user.id === userId);
  const user = member?.user ?? d.friends.find((f) => f.user.id === userId)?.user;
  if (!user) return [];
  const isMe = userId === me;
  const perms = detail?.myPermissions;
  // dono e super admin (ADR-0013) ficam fora de expulsar/desconectar/mover: a API recusa, então nem oferecemos
  const shielded = detail?.ownerId === userId || Boolean(user.isInstanceAdmin);
  const canKick = Boolean(detail && perms && hasPermission(perms, Permission.KICK_MEMBERS) && !isMe && !shielded);
  const voice = d.voiceStates[userId];
  const v = useVoice.getState();
  // volume/silenciar local só fazem sentido com os dois na mesma chamada
  const sameCall = Boolean(
    voice && !isMe && v.machine.status !== 'disconnected' && v.machine.channelId === voice.channelId,
  );
  const chatKey = currentChatKey();

  const items: MenuEntry[] = [{ label: 'Perfil', icon: 'users', onSelect: openProfile }];
  // o próprio perfil: atalho para o editor (Configurações → Perfil)
  if (isMe)
    items.push({
      label: 'Editar perfil',
      icon: 'edit',
      onSelect: () => useUi.getState().openModal({ kind: 'settings', tab: 'profile' }),
    });
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
  // eu mesmo: microfone/áudio da chamada e apelido neste servidor
  if (isMe && voice && v.machine.status !== 'disconnected')
    items.push(
      'separator',
      { label: 'Silenciar', checked: v.selfMute, onSelect: () => void useVoice.getState().toggleMute() },
      { label: 'Desativar áudio', checked: v.selfDeaf, onSelect: () => void useVoice.getState().toggleDeafen() },
    );
  if (isMe && serverId && member)
    items.push({
      label: 'Apelido neste servidor',
      icon: 'edit',
      onSelect: async () => {
        const text = await askText('Só vale neste servidor. Deixe em branco para usar o seu nome.', {
          title: 'Apelido neste servidor',
          label: 'Apelido',
          placeholder: member.nickname ?? user.displayName,
          confirmLabel: 'Salvar',
        });
        if (text === null) return;
        void api()
          .request<Member>('PATCH', `/servers/${serverId}/members/me`, { nickname: text.trim() || null })
          .then((m) => useData.getState().upsertMember(serverId, { ...member, ...m }))
          .catch(apiError);
      },
    });
  // Apps ›: comandos de contexto dos bots do servidor (ADR-0034)
  items.push(...userAppsMenu(serverId, userId));
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
  const targets = voice && !isMe && !shielded && serverId ? moveTargets(serverId, voice.channelId) : [];
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
  // dona da sala (ADR-0040) tira gente da própria sala, mesmo sem cargo de moderação
  const roomKick = removeFromRoomItem(userId, serverId);
  if (roomKick) mod.push(roomKick);
  if (voice && !isMe && !shielded && perms && hasPermission(perms, Permission.MOVE_MEMBERS))
    mod.push({
      label: 'Desconectar',
      danger: true,
      onSelect: () => void api().request('DELETE', `/voice/members/${userId}`).catch(apiError),
    });
  // castigo e banimento (ADR-0034): mesma proteção de dono/super admin/eu mesmo; a API confere a hierarquia
  const moderation = moderationTargets(detail, me, member);
  if (moderation.canTimeout && serverId && member)
    mod.push({ kind: 'submenu', label: 'Castigo', icon: 'clock', items: timeoutMenuItems(serverId, member) });
  if (canKick && serverId)
    mod.push({
      label: `Expulsar ${user.displayName}`,
      icon: 'user-minus',
      danger: true,
      onSelect: async () => {
        if (await askConfirm(`${user.displayName} sai do servidor (pode voltar com um convite).`, KICK))
          void api().request('DELETE', `/servers/${serverId}/members/${userId}`).catch(apiError);
      },
    });
  if (moderation.canBan && serverId)
    mod.push({ label: 'Banir…', icon: 'block', danger: true, onSelect: () => openBanDialog(serverId, userId) });
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
  const shielded = detail?.ownerId === userId || Boolean(user?.isInstanceAdmin);
  const canKick = detail && hasPermission(detail.myPermissions, Permission.KICK_MEMBERS) && !isMe && !shielded;
  const canMute =
    detail && hasPermission(detail.myPermissions, Permission.MUTE_MEMBERS) && voiceState && !isMe && !shielded;
  const moderation = moderationTargets(detail, me?.id, member);
  const canRoles = Boolean(detail && hasPermission(detail.myPermissions, Permission.MANAGE_ROLES));
  const voiceChannel = voiceState ? detail?.channels.find((c) => c.id === voiceState.channelId) : undefined;
  const myCall = useVoice((s) => (s.machine.status === 'disconnected' ? null : s.machine.channelId));
  // bio, banner e cores (ADR-0048): carrega ao abrir o cartão
  const appearance = useProfiles((s) => s.byId[userId]) ?? EMPTY_APPEARANCE;
  const clips = useProfiles((s) => s.clipsById[userId]);
  useEffect(() => {
    void useProfiles.getState().load(userId);
  }, [userId]);
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
      data-themed={appearance.colors ? 'true' : undefined}
      style={{
        ...(pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' as const }),
        ...profileThemeVars(appearance.colors),
      }}
    >
      <ProfileCardHead
        user={user}
        appearance={appearance}
        status={isMe ? undefined : presence}
        name={alias ?? member?.nickname ?? user.displayName}
        subtitle={
          <>
            <div>
              {alias && <span data-tip="Apelido que só você vê">{user.displayName} · </span>}@{user.username}
            </div>
            {!isMe && <div className="small">{STATUS_LABEL[presence]}</div>}
          </>
        }
      />
      <ProfileBadges userId={userId} fallback={user.badges} verified={user.verified || undefined} />
      <ProfileClips clips={clips} owner={user} />
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
          {canRoles && (
            <button
              type="button"
              className="role-chip role-chip-add"
              aria-label="Cargos"
              data-tip="Dar ou tirar cargos"
              onClick={(e) => {
                const cargos = memberMenu(userId, serverId, () => undefined).find(
                  (x) => typeof x === 'object' && 'kind' in x && x.kind === 'submenu' && x.label === 'Cargos',
                );
                if (cargos && typeof cargos === 'object' && 'items' in cargos)
                  openContextMenu(e, cargos.items, 'Cargos');
              }}
            >
              <Icon name="plus" size={12} />
            </button>
          )}
        </div>
      )}
      {voiceChannel && serverId && (
        <div className="profile-voice">
          <span className="muted small">Em voz</span>
          <div className="profile-voice-name">
            <Icon name="speaker" size={16} />
            <strong className="truncate">{voiceChannel.name}</strong>
          </div>
          {detail && <span className="muted small truncate">em {detail.name}</span>}
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
      {isMe && (
        <div className="profile-actions">
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              useUi.getState().openModal({ kind: 'settings', tab: 'profile' });
            }}
          >
            <Icon name="edit" size={16} /> Editar perfil
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
          {moderation.canTimeout && serverId && member && (
            <Button
              variant="secondary"
              aria-haspopup="menu"
              onClick={(e) => openContextMenu(e, timeoutMenuItems(serverId, member), 'Castigo')}
            >
              <Icon name="clock" size={16} /> Castigo
            </Button>
          )}
          {canKick && serverId && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await askConfirm(`${user.displayName} sai do servidor (pode voltar com um convite).`, KICK))
                  run(() => api().request('DELETE', `/servers/${serverId}/members/${userId}`), 'Membro expulso.');
              }}
            >
              <Icon name="user-minus" size={16} /> Expulsar
            </Button>
          )}
          {moderation.canBan && serverId && (
            <Button
              variant="danger"
              onClick={() => {
                onClose();
                openBanDialog(serverId, userId);
              }}
            >
              <Icon name="block" size={16} /> Banir…
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
