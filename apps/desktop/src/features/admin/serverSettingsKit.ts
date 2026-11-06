import type { Role } from '@opencord/contracts';
import { describeError } from '../../store/session';
import { useUi } from '../../store/ui';

// Utilitários compartilhados pelas abas das configurações do servidor.

export const toastError = (e: unknown) => useUi.getState().toast('error', describeError(e));

export const sortRoles = (roles: Role[]) =>
  [...roles].sort((a, b) => (a.isEveryone !== b.isEveryone ? (a.isEveryone ? 1 : -1) : b.position - a.position));
