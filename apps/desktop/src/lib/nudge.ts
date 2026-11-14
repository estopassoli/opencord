/**
 * "Chamar atenção" (ADR-0064), como nos mensageiros antigos: alguém clica com o botão direito em mim, o servidor
 * manda `user:nudge` e o app treme (a janela e a interface), toca um aviso próprio e, em segundo plano, notifica e
 * pisca na barra de tarefas.
 *
 * - Desligado em Configurações → Notificações: o servidor já recusa; aqui também ignora (evento atrasado).
 * - Não perturbe: só o aviso na tela, sem tremer nem tocar.
 * - Reduzir animações: não treme; o som e o aviso continuam.
 * - Modo streamer escondendo sons: não toca.
 * - Várias chamadas juntas (de pessoas diferentes): uma a cada 2,5 s.
 */
import type { ServerEvents } from '@opencord/contracts';
import { bridge } from './bridge';
import { playNudge } from './sounds';
import { streamerHides } from './streamer';
import { useData } from '../store/data';
import { useUi } from '../store/ui';

const SHAKE_MS = 650;
const MIN_GAP_MS = 2500;
let lastAt = 0;

/** a pessoa pediu menos movimento (nas configurações do app ou do sistema)? */
export function prefersLessMotion(): boolean {
  const m = document.documentElement.dataset.motion;
  if (m === 'reduced') return true;
  if (m === 'full') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** treme a interface (CSS) e, no app desktop, a própria janela */
export function shakeApp() {
  if (prefersLessMotion()) return;
  const root = document.documentElement;
  delete root.dataset.nudge;
  // força o recomeço da animação se já estava tremendo
  void root.offsetWidth;
  root.dataset.nudge = 'true';
  setTimeout(() => delete root.dataset.nudge, SHAKE_MS);
  void bridge?.shakeWindow?.().catch(() => undefined);
}

export function receiveNudge(e: ServerEvents['user:nudge'], now = Date.now()): 'ignored' | 'quiet' | 'shown' {
  const d = useData.getState();
  const n = d.settings?.notifications;
  if (!n || n.nudges === false) return 'ignored';
  if (now - lastAt < MIN_GAP_MS) return 'ignored';
  lastAt = now;
  const name = e.fromName || 'Alguém';
  const ui = useUi.getState();
  if (n.dnd || d.myStatus === 'dnd') {
    ui.toast('info', `${name} chamou sua atenção.`);
    return 'quiet';
  }
  shakeApp();
  if (!streamerHides().sounds) playNudge(n.soundVolume);
  ui.toast('info', `${name} está chamando sua atenção!`);
  if (!document.hasFocus()) {
    if (bridge) {
      if (n.desktop)
        void bridge.notify({ title: 'Chamar atenção', body: `${name} está chamando sua atenção!`, silent: true });
      void bridge.flashFrame();
    } else if (n.desktop && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Chamar atenção', { body: `${name} está chamando sua atenção!`, silent: true });
    }
  }
  return 'shown';
}

/** para os testes: zera o intervalo entre chamadas */
export function resetNudgeGap() {
  lastAt = 0;
}
