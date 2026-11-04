/**
 * Fechar conversa (card "apagar os cards de conversas em mensagens diretas", 2026-11-04): tira a DM só da minha
 * lista, sem apagar nada. Volta sozinha quando chega mensagem mais nova que a do momento em que fechei (ids das
 * mensagens são uuid v7: crescem com o tempo, então comparar as strings basta).
 */
import type { Conversation, UnreadState } from '@opencord/contracts';
import { useData } from '../store/data';
import { updateSettings } from '../store/settings';

const MAX_CLOSED = 300;

/** id da mensagem mais nova que o app conhece da conversa ('' se nenhuma) */
export const latestMessageId = (c: Conversation, unread: UnreadState | undefined): string => {
  const a = c.lastMessageId ?? '';
  const b = unread?.lastMessageId ?? '';
  return a > b ? a : b;
};

export const isClosed = (
  closed: Record<string, string> | undefined,
  c: Conversation,
  unread: UnreadState | undefined,
): boolean => {
  const at = closed?.[c.id];
  return at !== undefined && latestMessageId(c, unread) <= at;
};

export function closeConversation(c: Conversation, unread: UnreadState | undefined) {
  updateSettings((s) => {
    const entries = Object.entries({ ...s.closedConversations, [c.id]: latestMessageId(c, unread) });
    return {
      ...s,
      closedConversations: Object.fromEntries(entries.slice(-MAX_CLOSED)),
      // fechada não fica fixada no topo
      pinnedConversations: s.pinnedConversations.filter((id) => id !== c.id),
    };
  });
}

export function reopenConversation(conversationId: string) {
  // sem nada a mudar não salva (updateSettings sempre manda para o servidor)
  if (!(conversationId in (useData.getState().settings?.closedConversations ?? {}))) return;
  updateSettings((s) => {
    const { [conversationId]: _, ...rest } = s.closedConversations;
    return { ...s, closedConversations: rest };
  });
}
