/**
 * Salas privadas (ADR-0040): canal privado (o @everyone não vê) e sala temporária trancada (o @everyone não entra),
 * com dona, convite, limite de vagas, remover e "pedir para entrar".
 */
import { hasPermission, Permission, type Channel, type ServerDetail } from '@opencord/contracts';
import { Avatar, Button, Checkbox, TextField } from '@opencord/ui';
import { useMemo, useState } from 'react';
import { askText } from '../../components/AskDialog';
import type { MenuEntry } from '../../components/ContextMenu';
import { Dialog } from '../../components/Dialog';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

/** Canal privado: o @everyone não vê (a API calcula; quem não gerencia cargos não recebe os overrides). */
export const isPrivateChannel = (_detail: ServerDetail, c: Channel) => c.private;

/** Sala trancada: o @everyone não entra. */
export const isLockedRoom = (_detail: ServerDetail, c: Channel) => c.temporary && c.locked;

/** Eu mando nesta sala (dona ou quem gerencia canais). */
export const canManageRoom = (detail: ServerDetail, c: Channel, me: string | undefined) =>
  c.temporary && (c.ownerId === me || hasPermission(detail.myPermissions, Permission.MANAGE_CHANNELS));

const fail = (e: unknown) => useUi.getState().toast('error', describeError(e));
const patchRoom = (id: string, body: Record<string, unknown>) =>
  api()
    .request<Channel>('PATCH', `/rooms/${id}`, body)
    .then((c) => useData.getState().upsertChannel(c))
    .catch(fail);

/** Clique numa sala trancada em que não entro: pede para a dona. */
export async function knockRoom(c: Channel) {
  try {
    await api().request('POST', `/rooms/${c.id}/knock`);
    useUi.getState().toast('info', `Pedido enviado. Você entra assim que liberarem ${c.name}.`);
  } catch (e) {
    fail(e);
  }
}

/** Criador de salas: cria uma sala já trancada e entra nela. */
export async function createLockedRoom(hub: Channel) {
  const me = useData.getState().me;
  const name = await askText('Só quem você convidar entra. Você pode destrancar depois.', {
    title: 'Criar sala trancada',
    label: 'Nome da sala',
    placeholder: `Sala de ${me?.displayName ?? 'você'}`,
    confirmLabel: 'Criar e entrar',
  });
  if (name === null) return;
  try {
    const room = await api().request<Channel>('POST', `/channels/${hub.id}/rooms`, {
      locked: true,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    useData.getState().upsertChannel(room);
    useUi.getState().go({ kind: 'server', serverId: hub.serverId, channelId: room.id });
    await useVoice.getState().join(room.id, hub.serverId);
  } catch (e) {
    fail(e);
  }
}

/** Itens do menu de contexto de uma sala para quem manda nela. */
export function roomMenuItems(detail: ServerDetail, c: Channel, me: string | undefined): MenuEntry[] {
  if (!canManageRoom(detail, c, me)) return [];
  const locked = isLockedRoom(detail, c);
  return [
    'separator',
    {
      label: locked ? 'Destrancar sala' : 'Trancar sala',
      icon: 'lock',
      hint: locked ? 'Qualquer pessoa do canal entra' : 'Só quem está dentro e quem você convidar',
      onSelect: () => void patchRoom(c.id, { locked: !locked }),
    },
    {
      label: 'Convidar pessoas…',
      icon: 'user-plus',
      onSelect: () => useUi.getState().openModal({ kind: 'room-invite', serverId: c.serverId, channelId: c.id }),
    },
    {
      kind: 'submenu',
      label: 'Limite de vagas',
      icon: 'users',
      items: [null, 2, 3, 4, 5, 6, 8, 10].map((n) => ({
        label: n === null ? 'Sem limite' : `${n} pessoas`,
        checked: (c.userLimit ?? null) === n,
        onSelect: () => void patchRoom(c.id, { userLimit: n }),
      })),
    },
    {
      label: 'Renomear sala…',
      icon: 'edit',
      onSelect: async () => {
        const name = await askText('', {
          title: 'Renomear sala',
          label: 'Nome',
          placeholder: c.name,
          confirmLabel: 'Salvar',
        });
        if (name?.trim()) void patchRoom(c.id, { name: name.trim() });
      },
    },
  ];
}

/** Item "Remover da sala" no menu de quem está numa sala que eu mando. */
export function removeFromRoomItem(userId: string, serverId: string | undefined): MenuEntry | null {
  const d = useData.getState();
  const me = d.me?.id;
  const v = d.voiceStates[userId];
  if (!serverId || !v || userId === me) return null;
  const detail = d.details[serverId];
  const c = detail?.channels.find((x) => x.id === v.channelId);
  if (!detail || !c || !canManageRoom(detail, c, me) || c.ownerId === userId) return null;
  return {
    label: 'Remover da sala',
    icon: 'user-minus',
    danger: true,
    hint: 'Sai da sala e perde o convite',
    onSelect: () => void api().request('DELETE', `/rooms/${c.id}/members/${userId}`).catch(fail),
  };
}

/** Aviso de convite / pedido de entrada (notificação room_invite / room_knock). */
export function handleRoomNotification(n: {
  kind: string;
  title: string;
  channelId?: string;
  serverId?: string;
  userId?: string;
}) {
  const { channelId, serverId, userId } = n;
  if (!channelId || !serverId) return;
  if (n.kind === 'room_invite')
    useUi.getState().toast('info', n.title, {
      label: 'Entrar',
      run: () => {
        useUi.getState().go({ kind: 'server', serverId, channelId });
        void useVoice.getState().join(channelId, serverId);
      },
    });
  else if (n.kind === 'room_knock' && userId)
    useUi.getState().toast('info', n.title, {
      label: 'Deixar entrar',
      run: () =>
        void api()
          .request<Channel>('POST', `/rooms/${channelId}/invite`, { userIds: [userId] })
          .then((c) => useData.getState().upsertChannel(c))
          .catch(fail),
    });
}

/** Lista de membros com caixas (convite de sala e canal privado). */
export function MemberChecklist({
  detail,
  picked,
  onToggle,
  exclude = [],
}: {
  detail: ServerDetail;
  picked: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  exclude?: string[];
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = useMemo(
    () =>
      detail.members
        .filter((m) => !m.user.bot && !m.hidden && !exclude.includes(m.user.id))
        .filter(
          (m) =>
            !q ||
            (m.nickname ?? m.user.displayName).toLowerCase().includes(q) ||
            m.user.username.toLowerCase().includes(q),
        )
        .sort((a, b) =>
          (a.nickname ?? a.user.displayName).localeCompare(b.nickname ?? b.user.displayName, 'pt-BR', {
            sensitivity: 'base',
          }),
        )
        .slice(0, 100),
    [detail.members, q, exclude],
  );
  return (
    <div className="member-checklist">
      <TextField label="Buscar pessoas" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={64} />
      <ul aria-label="Pessoas">
        {list.map((m) => (
          <li key={m.user.id}>
            <Avatar id={m.user.id} name={m.user.displayName} size={24} />
            <Checkbox
              checked={picked.has(m.user.id)}
              onChange={(on) => onToggle(m.user.id, on)}
              label={m.nickname ?? m.user.displayName}
            />
          </li>
        ))}
        {!list.length && <li className="muted small">Ninguém encontrado.</li>}
      </ul>
    </div>
  );
}

/** Convidar pessoas para uma sala trancada. */
export function RoomInviteDialog({
  serverId,
  channelId,
  onClose,
}: {
  serverId: string;
  channelId: string;
  onClose: () => void;
}) {
  const detail = useData((s) => s.details[serverId]);
  const me = useData((s) => s.me?.id);
  const room = detail?.channels.find((c) => c.id === channelId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!detail || !room) return null;
  const already = room.overrides
    .filter((o) => o.subjectType === 'member' && o.allow & Permission.CONNECT)
    .map((o) => o.subjectId);
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await api().request<Channel>('POST', `/rooms/${channelId}/invite`, { userIds: [...picked] });
      useData.getState().upsertChannel(c);
      useUi.getState().toast('success', picked.size === 1 ? 'Convite enviado.' : `${picked.size} convites enviados.`);
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Convidar para ${room.name}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || !picked.size} onClick={() => void send()}>
            Convidar{picked.size ? ` (${picked.size})` : ''}
          </Button>
        </>
      }
    >
      <p className="muted small">
        Quem você convidar recebe um aviso com "Entrar" e passa a poder entrar na sala trancada.
      </p>
      <MemberChecklist detail={detail} picked={picked} onToggle={toggle} exclude={[...already, ...(me ? [me] : [])]} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
