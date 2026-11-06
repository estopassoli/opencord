import type { Message, ServerEvents } from '@opencord/contracts';
import { bridge } from '../lib/bridge';
import { effectiveLevel, matchKeyword, serverDefaultOf } from '../lib/notifyPrefs';
import { playSound } from '../lib/sounds';
import { streamerHides } from '../lib/streamer';
import { useData } from './data';
import { useUi } from './ui';

/** Notificação nativa respeitando DND, preferência do usuário e foco (não notifica o que já está na tela). */
export function notify(n: ServerEvents['notification:created']) {
  // chamada privada (ADR-0038): toca e oferece atender, mesmo com o app em foco
  if (n.kind === 'call' && n.conversationId) {
    const conversationId = n.conversationId;
    playSound('join');
    useUi.getState().toast('info', n.title, {
      label: 'Atender',
      run: () => {
        useUi.getState().go({ kind: 'dm', conversationId });
        void import('./voice').then(({ useVoice }) => useVoice.getState().joinConversation(conversationId));
      },
    });
  }
  // salas trancadas (ADR-0040): convite com "Entrar" e pedido com "Deixar entrar"
  if (n.kind === 'room_invite' || n.kind === 'room_knock') {
    playSound('join');
    void import('../features/shell/rooms').then(({ handleRoomNotification }) => handleRoomNotification(n));
  }
  // mensagem comum (servidor com notificação padrão "todas"): a própria não avisa
  if (n.kind === 'message' && n.userId === useData.getState().me?.id) return;
  const s = useData.getState().settings;
  if (!s || s.notifications.dnd || useData.getState().myStatus === 'dnd') return;
  // servidor/canal silenciado ou com outro nível só para mim (o canal vale por cima do servidor)
  if ((n.kind === 'mention' || n.kind === 'message') && n.channelId) {
    const serverId = n.serverId ?? null;
    const level = effectiveLevel(s, serverId, n.channelId, serverDefaultOf(serverId));
    if (level === 'none' || (n.kind === 'message' && level !== 'all')) return;
  }
  const view = useUi.getState().view;
  const visible =
    document.hasFocus() &&
    ((n.channelId && view.kind === 'server' && view.channelId === n.channelId) ||
      (n.conversationId && view.kind === 'dm' && view.conversationId === n.conversationId));
  if (visible) return;
  // som próprio (respeita volume/Sons); a notificação nativa vai silenciosa para não tocar dois sons
  const hide = streamerHides();
  if (!hide.sounds) playSound('message');
  if (!s.notifications.desktop) return;
  // modo streamer: a notificação aparece, mas sem o texto da mensagem
  const body = hide.notificationContent ? 'Nova mensagem' : n.body;
  const route =
    n.channelId && n.serverId
      ? `/server/${n.serverId}/${n.channelId}`
      : n.conversationId
        ? `/dm/${n.conversationId}`
        : '/home';
  if (bridge) {
    void bridge.notify({ title: n.title, body, route, silent: true });
    void bridge.flashFrame();
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(n.title, { body, silent: true });
  }
}

/**
 * Avisos que o próprio app gera a partir das mensagens que chegam (o servidor só manda menções e, com o padrão
 * "todas", mensagens comuns): "todas as mensagens" escolhido só por mim num servidor que está em "só menções", e as
 * palavras-chave. Menção a mim ou a todos já vem do servidor.
 */
export function messageNotify(msg: Message) {
  const s = useData.getState().settings;
  const me = useData.getState().me?.id;
  if (!s || !msg.channelId || msg.author.id === me || msg.deleted) return;
  if ((me && msg.mentions.includes(me)) || /(^|\s)@(everyone|here)\b/.test(msg.body)) return;
  const channelId = msg.channelId;
  const serverId =
    Object.values(useData.getState().details).find((d) => d.channels.some((c) => c.id === channelId))?.id ?? null;
  const def = serverDefaultOf(serverId);
  const level = effectiveLevel(s, serverId, channelId, def);
  if (level === 'none') return;
  const title = msg.author.displayName;
  const body = msg.body.slice(0, 140) || '[anexo]';
  const base = { title, body, channelId, ...(serverId ? { serverId } : {}), userId: msg.author.id };
  // o servidor já avisa toda mensagem quando o padrão dele é "todas"
  if (level === 'all') {
    if (def === 'mentions') notify({ kind: 'message', ...base });
    return;
  }
  const word = matchKeyword(msg.body, s.notifications.keywords);
  if (word) notify({ kind: 'mention', ...base, title: `${title} falou "${word}"` });
}

/** Navega para uma rota de notificação (`/server/:s/:c`, `/dm/:id`). */
export function openRoute(route: string) {
  const [, kind, a, b] = route.split('/');
  if (kind === 'server' && a) useUi.getState().go({ kind: 'server', serverId: a, channelId: b ?? null });
  else if (kind === 'dm' && a) useUi.getState().go({ kind: 'dm', conversationId: a });
  else useUi.getState().go({ kind: 'home', tab: 'friends' });
}
