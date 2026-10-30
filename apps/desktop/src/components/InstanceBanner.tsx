import { Icon } from '@opencord/ui';
import { useState } from 'react';
import { useData } from '../store/data';

const KEY = 'oc:announcement-dismissed';

function dismissed(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Aviso do super admin para todo mundo (ADR-0020). Dispensar vale até o texto mudar. */
export function InstanceBanner() {
  const a = useData((s) => s.instance?.announcement ?? null);
  const [hidden, setHidden] = useState(dismissed);
  if (!a || hidden === a.text) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, a.text);
    } catch {
      /* sem armazenamento: some só nesta sessão */
    }
    setHidden(a.text);
  };
  return (
    <div className="instance-banner" data-tone={a.tone} role="status">
      <Icon name={a.tone === 'warning' ? 'warning' : a.tone === 'success' ? 'check' : 'bell'} size={16} />
      <span>{a.text}</span>
      <button className="icon-btn icon-btn-sm" aria-label="Dispensar aviso" data-tip="Dispensar" onClick={dismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
