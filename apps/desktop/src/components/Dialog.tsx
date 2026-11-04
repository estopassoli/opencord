import { Icon } from '@opencord/ui';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Diálogo modal acessível baseado em <dialog> nativo (foco preso, Esc fecha). Vai num portal no <body>: montado
 * dentro de uma região com container-type ou transform (área de conteúdo, barra de título) ele deixava de ser
 * centralizado na janela.
 */
export function Dialog({
  title,
  onClose,
  children,
  wide,
  fullscreen,
  actions,
  bare,
  hideClose,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Ocupa a janela inteira (telas de configurações), com botão de fechar e dica "Esc" à direita. */
  fullscreen?: boolean;
  actions?: ReactNode;
  /** Sem cabeçalho/rodapé visíveis (o título fica só para leitores de tela); Esc ou clique fora fecham. */
  bare?: boolean;
  /** tela cheia sem o botão de fechar padrão (quem usa desenha o próprio; Esc continua fechando) */
  hideClose?: boolean;
  /** classe extra no <dialog> */
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    return () => d?.close?.();
  }, []);

  const base = fullscreen ? 'dialog dialog-fullscreen' : wide ? 'dialog dialog-wide' : 'dialog';
  const cls = className ? `${base} ${className}` : base;

  return createPortal(
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
          {!hideClose && (
            <div className="fullscreen-close">
              <button className="close-circle" aria-label="Fechar (Esc)" onClick={onClose}>
                <Icon name="close" size={18} />
              </button>
              <span aria-hidden>ESC</span>
            </div>
          )}
        </div>
      ) : bare ? (
        <div className="dialog-body dialog-bare">
          <h2 id={titleId} className="oc-visually-hidden">
            {title}
          </h2>
          {children}
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
    </dialog>,
    document.body,
  );
}
