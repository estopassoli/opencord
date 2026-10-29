import { useUi } from '../../store/ui';

export function ConnectionBanner() {
  const c = useUi((s) => s.connection);
  if (c === 'connected') return null;
  const text =
    c === 'connecting'
      ? 'Conectando…'
      : c === 'reconnecting'
        ? 'Conexão perdida. Reconectando…'
        : 'Desconectado do servidor.';
  return (
    <div className={`conn-banner conn-${c}`} role="status" aria-live="polite">
      {text}
    </div>
  );
}
