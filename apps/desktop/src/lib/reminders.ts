/**
 * Lembretes de mensagem ("me lembre disto"): ficam nas configurações da conta (valem em qualquer aparelho) e, na
 * hora, viram notificação e aviso com um atalho para a mensagem. Cada lembrete sai uma vez e some da lista.
 */
import { REMINDERS_MAX, type Message, type MessageReminder } from '@opencord/contracts';
import { jumpTo } from '../features/chat/PinnedMessages';
import { useData } from '../store/data';
import { updateSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { bridge } from './bridge';
import { playSound } from './sounds';
import { streamerHides } from './streamer';

const TICK_MS = 15_000;

export const REMIND_OPTIONS: { label: string; at: () => number }[] = [
  { label: 'Daqui a 20 minutos', at: () => Date.now() + 20 * 60_000 },
  { label: 'Daqui a 1 hora', at: () => Date.now() + 60 * 60_000 },
  { label: 'Daqui a 3 horas', at: () => Date.now() + 3 * 60 * 60_000 },
  { label: 'Amanhã às 9h', at: () => tomorrowAt(9) },
];

export function tomorrowAt(hour: number, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** lembretes em ordem, sem passar do limite (o mais distante sai primeiro) */
export function addReminder(list: readonly MessageReminder[], r: MessageReminder): MessageReminder[] {
  return [...list.filter((x) => x.id !== r.id), r].sort((a, b) => a.at - b.at).slice(0, REMINDERS_MAX);
}

export function remindMe(m: Message, at: number, authorName: string) {
  const serverId = m.channelId
    ? (Object.values(useData.getState().details).find((d) => d.channels.some((c) => c.id === m.channelId))?.id ??
      null)
    : null;
  const r: MessageReminder = {
    id: `${m.id}:${at}`,
    at,
    messageId: m.id,
    channelId: m.channelId ?? null,
    serverId,
    conversationId: m.conversationId ?? null,
    author: authorName.slice(0, 64),
    excerpt: m.body.slice(0, 200),
  };
  const s = useData.getState().settings;
  if (s && s.reminders.length >= REMINDERS_MAX && at > s.reminders.at(-1)!.at) {
    useUi.getState().toast('error', `Você já tem ${REMINDERS_MAX} lembretes; apague algum antes.`);
    return;
  }
  updateSettings((cur) => ({ ...cur, reminders: addReminder(cur.reminders, r) }));
  const when = new Date(at).toLocaleString('pt-BR', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  useUi.getState().toast('success', `Vou te lembrar ${when}.`);
}

export const removeReminder = (id: string) =>
  updateSettings((cur) => ({ ...cur, reminders: cur.reminders.filter((r) => r.id !== id) }));

/** abre a conversa da mensagem e rola até ela (se já estiver carregada) */
export function openReminder(r: MessageReminder) {
  const ui = useUi.getState();
  if (r.channelId && r.serverId) ui.go({ kind: 'server', serverId: r.serverId, channelId: r.channelId });
  else if (r.conversationId) ui.go({ kind: 'dm', conversationId: r.conversationId });
  let tries = 0;
  const t = setInterval(() => {
    if (jumpTo(r.messageId) || ++tries > 10) clearInterval(t);
  }, 300);
}

function fire(r: MessageReminder) {
  const hide = streamerHides();
  const body = hide.notificationContent ? 'Toque para ver a mensagem.' : r.excerpt || '[anexo]';
  const title = r.author ? `Lembrete: mensagem de ${r.author}` : 'Lembrete de mensagem';
  if (!hide.sounds) playSound('message');
  useUi.getState().toast('info', `${title}${hide.notificationContent ? '' : ` — ${r.excerpt.slice(0, 80)}`}`, {
    label: 'Ver mensagem',
    run: () => openReminder(r),
  });
  const route = r.channelId && r.serverId ? `/server/${r.serverId}/${r.channelId}` : `/dm/${r.conversationId}`;
  void bridge?.notify({ title, body, route, silent: true }).catch(() => undefined);
}

/** dispara os vencidos; um lembrete que venceu com o app fechado sai na próxima abertura */
export function dueReminders(list: readonly MessageReminder[], now = Date.now()) {
  return list.filter((r) => r.at <= now);
}

let started = false;
export function startReminders() {
  if (started) return;
  started = true;
  const tick = () => {
    const s = useData.getState().settings;
    if (!s?.reminders.length) return;
    const due = dueReminders(s.reminders);
    if (!due.length) return;
    const ids = new Set(due.map((r) => r.id));
    updateSettings((cur) => ({ ...cur, reminders: cur.reminders.filter((r) => !ids.has(r.id)) }));
    due.forEach(fire);
  };
  setInterval(tick, TICK_MS);
  tick();
}
