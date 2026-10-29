import { Icon } from '@opencord/ui';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Diálogo modal acessível baseado em <dialog> nativo (foco preso, Esc fecha). */
export function Dialog({
  title,
  onClose,
  children,
  wide,
  fullscreen,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Ocupa a janela inteira (telas de configurações), com botão de fechar e dica "Esc" à direita. */
  fullscreen?: boolean;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    return () => d?.close?.();
  }, []);

  const cls = fullscreen ? 'dialog dialog-fullscreen' : wide ? 'dialog dialog-wide' : 'dialog';

  return (
    <dialog
      ref={ref}
      className={cls}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (!fullscreen && e.target === e.currentTarget) onClose();
      }}
    >
      {fullscreen ? (
        <div className="fullscreen-body">
          <h2 id={titleId} className="oc-visually-hidden">
            {title}
          </h2>
          {children}
          <div className="fullscreen-close">
            <button className="close-circle" aria-label="Fechar (Esc)" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
            <span aria-hidden>ESC</span>
          </div>
        </div>
      ) : (
        <div className="dialog-body">
          <header className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <button className="icon-btn" aria-label="Fechar" onClick={onClose}>
              <Icon name="close" />
            </button>
          </header>
          <div className="dialog-content">{children}</div>
          {actions && <footer className="dialog-actions">{actions}</footer>}
        </div>
      )}
    </dialog>
  );
}
