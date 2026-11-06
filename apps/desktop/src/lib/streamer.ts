/**
 * Modo streamer: enquanto transmito, esconde o que não pode aparecer na live (e-mail, links de convite, texto das
 * notificações) e, se eu quiser, desliga os sons de aviso. Ligado à mão ou automático: com Go Live ou com
 * OBS/Streamlabs aberto (o processo principal avisa pelo detector de jogos).
 */
import { create } from 'zustand';
import { bridge } from './bridge';
import { useData } from '../store/data';

interface StreamerStore {
  /** OBS/Streamlabs/XSplit aberto agora */
  streamApp: boolean;
  active: boolean;
}

export const useStreamer = create<StreamerStore>()(() => ({ streamApp: false, active: false }));

const settings = () => useData.getState().settings?.streamer;
/** estou em Go Live (atualizado pelo store de voz, importado sob demanda para não criar ciclo) */
let live = false;

function compute() {
  const s = settings();
  const mode = s?.mode ?? 'auto';
  const active = mode === 'on' || (mode === 'auto' && (live || useStreamer.getState().streamApp));
  if (active !== useStreamer.getState().active) useStreamer.setState({ active });
}

/** o que esconder agora (tudo falso fora do modo streamer) */
export function streamerHides() {
  const s = settings();
  const on = useStreamer.getState().active;
  return {
    email: on && (s?.hideEmail ?? true),
    invites: on && (s?.hideInvites ?? true),
    notificationContent: on && (s?.hideNotificationContent ?? true),
    sounds: on && (s?.muteSounds ?? false),
  };
}

/** "er•••@g•••.com" */
export function maskEmail(email: string) {
  const [user = '', domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${user.slice(0, 2)}•••@${domain.slice(0, 1)}•••${tld}`;
}

/** link ou código de convite sem o código ("opencord.pro/i/•••••") */
export function maskInvite(value: string) {
  const i = value.lastIndexOf('/');
  return `${i >= 0 ? value.slice(0, i + 1) : ''}•••••`;
}

/** hook: re-renderiza quando o modo liga/desliga ou as opções mudam */
export function useStreamerHides() {
  useStreamer((s) => s.active);
  useData((s) => s.settings?.streamer);
  return streamerHides();
}

let started = false;
export function startStreamer() {
  if (started) return;
  started = true;
  bridge?.on('streaming-app', (open) => {
    useStreamer.setState({ streamApp: open });
    compute();
  });
  void import('../store/voice').then(({ useVoice }) => {
    const sync = () => {
      live = useVoice.getState().stream.status === 'live';
      compute();
    };
    useVoice.subscribe((s, prev) => {
      if (s.stream.status !== prev.stream.status) sync();
    });
    sync();
  });
  useData.subscribe((s, prev) => {
    if (s.settings?.streamer !== prev.settings?.streamer) compute();
  });
  compute();
}
