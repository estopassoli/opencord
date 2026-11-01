/**
 * Ausente automático: sem teclado nem mouse no computador por 10 minutos, o status vira "ausente" sozinho (só se o
 * escolhido for "online"); ao mexer de novo, volta. O tempo parado vem do processo principal (powerMonitor), a cada
 * 30 s. A preferência fica neste computador (ligada por padrão).
 */
import { bridge } from './bridge';
import { api } from '../store/session';
import { useData } from '../store/data';

const KEY = 'oc:auto-idle';
export const AUTO_IDLE_AFTER_S = 10 * 60;

export function autoIdleEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}
export function setAutoIdleEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* sem armazenamento: fica o padrão */
  }
  if (!on) comeBack();
}

function comeBack() {
  if (!useData.getState().autoAway) return;
  useData.setState({ autoAway: false, myStatus: 'online' });
  void api()
    .request('PUT', '/me/presence', { status: 'online' })
    .catch(() => undefined);
}

export function startAutoIdle(): () => void {
  if (!bridge) return () => undefined;
  return bridge.on('idle', (idleSeconds) => {
    const { myStatus, autoAway, me } = useData.getState();
    if (!me) return;
    if (idleSeconds >= AUTO_IDLE_AFTER_S) {
      if (!autoIdleEnabled() || autoAway || myStatus !== 'online') return;
      useData.setState({ autoAway: true, myStatus: 'idle' });
      void api()
        .request('PUT', '/me/presence', { status: 'idle' })
        .catch(() => undefined);
    } else comeBack();
  });
}
