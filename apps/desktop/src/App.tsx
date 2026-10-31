import { useEffect } from 'react';
import { AvatarProvider } from './components/AvatarProvider';
import { ErrorBoundary, reportError } from './components/ErrorBoundary';
import { Toasts } from './components/Toasts';
import { GlobalTips } from './components/GlobalTips';
import { AuthScreen } from './features/auth/AuthScreen';
import { AppShell } from './features/shell/AppShell';
import { bridge } from './lib/bridge';
import { openRoute } from './store/notify';
import { useSession } from './store/session';
import { useUi } from './store/ui';
import { clearPendingInvite, pendingInvite } from './lib/invite';
import { useVoice } from './store/voice';

export function App() {
  const status = useSession((s) => s.status);

  // link de convite (/invite/<código>, capturado em main.tsx): abre assim que a pessoa entrar
  useEffect(() => {
    if (status !== 'authenticated') return;
    const code = pendingInvite();
    if (!code) return;
    clearPendingInvite();
    useUi.getState().openModal({ kind: 'join-invite', code });
  }, [status]);

  // erros fora do React (eventos, promessas) também vão para o crash-log.txt
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError('window', e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportError('promise', e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    void useSession.getState().restore();
    if (!bridge) return;
    const offs = [
      bridge.on('shortcut', (a) => {
        const v = useVoice.getState();
        if (a === 'toggleMute') void v.toggleMute();
        else if (a === 'toggleDeafen') void v.toggleDeafen();
        else if (a === 'pushToTalkToggle') v.setPtt(!v.pttActive);
        else if (a === 'saveClip') void import('./store/clips').then(({ saveClip }) => saveClip());
      }),
      bridge.on('tray-action', (a) => {
        const v = useVoice.getState();
        if (a === 'toggleMute') void v.toggleMute();
        else if (a === 'toggleDeafen') void v.toggleDeafen();
        else if (a === 'disconnect') void v.leave();
      }),
      bridge.on('notification-click', (route) => openRoute(route)),
      bridge.on('power-resume', () => useSession.getState().realtime?.reconnectNow()),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  return (
    <ErrorBoundary>
      {status === 'loading' ? (
        <div className="splash" role="status" aria-live="polite">
          <span className="splash-mark" aria-hidden />
          Carregando…
        </div>
      ) : status === 'anonymous' ? (
        <AuthScreen />
      ) : (
        <AvatarProvider>
          <AppShell />
        </AvatarProvider>
      )}
      <Toasts />
      <GlobalTips />
    </ErrorBoundary>
  );
}
