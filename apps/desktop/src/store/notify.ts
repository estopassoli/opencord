import type { ServerEvents } from '@opencord/contracts';
import { bridge } from '../lib/bridge';
import { useData } from './data';
import { useUi } from './ui';

/** Notificação nativa respeitando DND, preferência do usuário e foco (não notifica o que já está na tela). */
export function notify(n: ServerEvents['notification:created']) {
  const s = useData.getState().settings;
  if (!s?.notifications.desktop || s.notifications.dnd || useData.getState().myStatus === 'dnd') return;
  const view = useUi.getState().view;
  const visible =
    document.hasFocus() &&
    ((n.channelId && view.kind === 'server' && view.channelId === n.channelId) ||
      (n.conversationId && view.kind === 'dm' && view.conversationId === n.conversationId));
  if (visible) return;
  const route =
    n.channelId && n.serverId
      ? `/server/${n.serverId}/${n.channelId}`
      : n.conversationId
        ? `/dm/${n.conversationId}`
        : '/home';
  if (bridge) {
    void bridge.notify({ title: n.title, body: n.body, route, silent: !s.notifications.sounds });
    void bridge.flashFrame();
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(n.title, { body: n.body });
  }
}

/** Navega para uma rota de notificação (`/server/:s/:c`, `/dm/:id`). */
export function openRoute(route: string) {
  const [, kind, a, b] = route.split('/');
  if (kind === 'server' && a) useUi.getState().go({ kind: 'server', serverId: a, channelId: b ?? null });
  else if (kind === 'dm' && a) useUi.getState().go({ kind: 'dm', conversationId: a });
  else useUi.getState().go({ kind: 'home', tab: 'friends' });
}
