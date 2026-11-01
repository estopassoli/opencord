/**
 * Lembretes de evento (ADR-0028): 15 minutos antes, quem confirmou ("vou" ou "talvez") recebe notificação e aviso no
 * app; na hora, um aviso com "Entrar na chamada" quando o evento tem canal de voz. Cada lembrete sai uma vez por
 * evento neste computador.
 */
import { bridge } from './bridge';
import { useData } from '../store/data';
import { useUi } from '../store/ui';
import { useVoice } from '../store/voice';
import { whenLabel } from './when';

const KEY = 'oc:event-reminders';
const BEFORE_MS = 15 * 60_000;

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function mark(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* sem armazenamento: pode repetir após reabrir */
  }
}

export function checkEventReminders(now = Date.now()) {
  const { events, details } = useData.getState();
  const done = seen();
  let changed = false;
  for (const [serverId, list] of Object.entries(events)) {
    for (const e of list) {
      if (!e.me) continue;
      const start = new Date(e.startsAt).getTime();
      const soonKey = `${e.id}:soon`;
      const nowKey = `${e.id}:now`;
      if (start - now <= BEFORE_MS && start - now > 0 && !done.has(soonKey)) {
        done.add(soonKey);
        changed = true;
        const text = `"${e.title}" começa em ${Math.max(1, Math.round((start - now) / 60_000))} min (${whenLabel(e.startsAt)}).`;
        useUi.getState().toast('info', text);
        void bridge?.notify({ title: 'Evento daqui a pouco', body: text }).catch(() => undefined);
      } else if (start <= now && now - start < 10 * 60_000 && !done.has(nowKey)) {
        done.add(nowKey);
        changed = true;
        const channel = details[serverId]?.channels.find((c) => c.id === e.channelId);
        useUi
          .getState()
          .toast(
            'info',
            `"${e.title}" começou.`,
            channel
              ? { label: 'Entrar na chamada', run: () => void useVoice.getState().join(channel.id, serverId) }
              : undefined,
          );
        void bridge?.notify({ title: 'Evento começou', body: e.title }).catch(() => undefined);
      }
    }
  }
  if (changed) mark(done);
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startEventReminders() {
  if (timer) return;
  timer = setInterval(() => checkEventReminders(), 60_000);
  checkEventReminders();
}
