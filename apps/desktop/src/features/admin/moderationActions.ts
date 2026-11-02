/**
 * Ações de moderação (ADR-0034) compartilhadas pelo menu de contexto da pessoa e pelo cartão de perfil:
 * castigo (`PATCH /servers/:id/members/:userId { timeoutUntil }`) e abrir o diálogo de banir.
 */
import { hasPermission, Permission, type Member, type ServerDetail } from '@opencord/contracts';
import type { MenuEntry } from '../../components/ContextMenu';
import { fmtTimeoutUntil, isTimedOut, TIMEOUT_CHOICES, timeoutUntilIso } from '../../lib/moderation';
import { useData } from '../../store/data';
import { api, describeError } from '../../store/session';
import { useUi } from '../../store/ui';

const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

/** quem pode ser moderado: nem eu, nem o dono, nem o super admin (a API recusa; nem oferecemos) */
export function moderationTargets(
  detail: ServerDetail | undefined,
  myId: string | undefined,
  member: Member | undefined,
): { canBan: boolean; canTimeout: boolean } {
  if (!detail || !member) return { canBan: false, canTimeout: false };
  const shielded = detail.ownerId === member.user.id || Boolean(member.user.isInstanceAdmin);
  if (shielded || member.user.id === myId) return { canBan: false, canTimeout: false };
  return {
    canBan: hasPermission(detail.myPermissions, Permission.BAN_MEMBERS),
    canTimeout: hasPermission(detail.myPermissions, Permission.MODERATE_MEMBERS),
  };
}

export async function applyTimeout(serverId: string, userId: string, ms: number | null): Promise<void> {
  try {
    const updated = await api().request<Member>('PATCH', `/servers/${serverId}/members/${userId}`, {
      timeoutUntil: ms === null ? null : timeoutUntilIso(ms),
    });
    useData.getState().upsertMember(serverId, updated);
    useUi
      .getState()
      .toast(
        'success',
        ms === null
          ? 'Castigo retirado.'
          : `Em castigo até ${fmtTimeoutUntil(updated.timeoutUntil ?? timeoutUntilIso(ms))}.`,
      );
  } catch (e) {
    toastError(e);
  }
}

/** itens do submenu "Castigo": durações e, se já está de castigo, "Tirar castigo" */
export function timeoutMenuItems(serverId: string, member: Member): MenuEntry[] {
  const items: MenuEntry[] = TIMEOUT_CHOICES.map((c) => ({
    label: c.label,
    onSelect: () => void applyTimeout(serverId, member.user.id, c.ms),
  }));
  if (isTimedOut(member.timeoutUntil)) {
    items.push('separator', {
      label: 'Tirar castigo',
      hint: `Até ${fmtTimeoutUntil(member.timeoutUntil as string)}`,
      onSelect: () => void applyTimeout(serverId, member.user.id, null),
    });
  }
  return items;
}

export function openBanDialog(serverId: string, userId: string): void {
  useUi.getState().openModal({ kind: 'ban', serverId, userId });
}
