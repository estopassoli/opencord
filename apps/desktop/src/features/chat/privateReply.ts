/**
 * Responder no privado (ADR-0042): abre a DM com o autor de uma mensagem de canal já com a citação pronta no composer,
 * e o caminho de volta da citação para a mensagem original no canal.
 */
import type { Conversation, Message } from '@opencord/contracts';
import { describeError, api } from '../../store/session';
import { keyOf, useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { jumpTo } from './PinnedMessages';

/** dá para responder no privado: mensagem de canal de outra pessoa (não bot nem webhook) */
export const canReplyPrivately = (m: Message, meId: string) =>
  Boolean(m.channelId) && !m.deleted && !m.author.bot && m.author.id !== meId;

export async function startPrivateReply(m: Message, authorName: string, channelName: string) {
  try {
    const c = await api().request<Conversation>('POST', '/conversations', { userIds: [m.author.id] });
    useData.getState().upsertConversation(c);
    const key = keyOf({ conversationId: c.id });
    const ui = useUi.getState();
    ui.setReplyTo(key, null);
    ui.setPrivateReply(key, {
      messageId: m.id,
      authorName,
      bodyPreview: m.body.slice(0, 200) || (m.attachments.length ? 'Anexo' : ''),
      channelName,
    });
    ui.go({ kind: 'dm', conversationId: c.id });
  } catch (e) {
    useUi.getState().toast('error', describeError(e));
  }
}

/** abre o canal da mensagem citada e rola até ela quando a conversa carregar */
export function openQuotedMessage(serverId: string, channelId: string, messageId: string) {
  useUi.getState().go({ kind: 'server', serverId, channelId });
  let tries = 0;
  const tick = () => {
    if (jumpTo(messageId)) return;
    if (++tries < 20) setTimeout(tick, 150);
    else useUi.getState().toast('info', 'Abri o canal; role para cima se a mensagem for antiga.');
  };
  setTimeout(tick, 100);
}
