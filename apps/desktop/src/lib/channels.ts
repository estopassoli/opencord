import type { ChannelKind } from '@opencord/contracts';
import type { IconName } from '@opencord/ui';

/** Ícone e nome de cada tipo de canal (texto, voz, quadro kanban ADR-0017 e fórum ADR-0052). */
export const CHANNEL_ICON: Record<ChannelKind, IconName> = {
  text: 'hashtag',
  voice: 'speaker',
  board: 'kanban',
  forum: 'chats',
};
export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  text: 'Canal de texto',
  voice: 'Canal de voz',
  board: 'Quadro kanban',
  forum: 'Fórum',
};
/** ordem na lista dentro de uma categoria: texto, fóruns, quadros, voz */
export const CHANNEL_ORDER: Record<ChannelKind, number> = { text: 0, forum: 1, board: 2, voice: 3 };
