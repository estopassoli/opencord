import type { ChannelKind } from '@opencord/contracts';
import type { IconName } from '@opencord/ui';

/** Ícone e nome de cada tipo de canal (texto, voz e quadro kanban, ADR-0017). */
export const CHANNEL_ICON: Record<ChannelKind, IconName> = { text: 'hashtag', voice: 'speaker', board: 'kanban' };
export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  text: 'Canal de texto',
  voice: 'Canal de voz',
  board: 'Quadro kanban',
};
/** ordem na lista dentro de uma categoria: texto, quadros, voz */
export const CHANNEL_ORDER: Record<ChannelKind, number> = { text: 0, board: 1, voice: 2 };
