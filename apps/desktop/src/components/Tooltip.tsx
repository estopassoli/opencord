import { cloneElement, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { portalTarget } from '@opencord/ui';

type Side = 'right' | 'top' | 'bottom';

interface TriggerProps {
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  'aria-describedby'?: string;
}

/**
 * Tooltip em portal (não é cortado por contêineres com rolagem). Abre no hover e no foco por teclado,
 * com pequeno atraso; o conteúdo é associado via aria-describedby.
 */
export function Tooltip({
  label,
  side = 'top',
  children,
}: {
  label: ReactNode;
  side?: Side;
  children: ReactElement<TriggerProps>;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const id = useId();

  const anchorEl = useRef<Element | null>(null);
  const show = (el: Element) => {
    anchorEl.current = el;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchor(el.getBoundingClientRect()), 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setAnchor(null);
    setPos(null);
  };

  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const t = tip.current.getBoundingClientRect();
    const gap = 8;
    let left = side === 'right' ? anchor.right + gap : anchor.left + anchor.width / 2 - t.width / 2;
    let top =
      side === 'right'
        ? anchor.top + anchor.height / 2 - t.height / 2
        : side === 'top'
          ? anchor.top - t.height - gap
          : anchor.bottom + gap;
    left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - t.height - 4));
    setPos({ left, top });
  }, [anchor, side]);

  const p = children.props;
  const trigger = cloneElement(children, {
    onMouseEnter: (e: React.MouseEvent) => {
      p.onMouseEnter?.(e);
      show(e.currentTarget);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      p.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      p.onFocus?.(e);
      if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget);
    },
    onBlur: (e: React.FocusEvent) => {
      p.onBlur?.(e);
      hide();
    },
    'aria-describedby': anchor ? id : p['aria-describedby'],
  });

  return (
    <>
      {trigger}
      {anchor &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className={`tooltip tooltip-${side}`}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          >
            {label}
          </div>,
          portalTarget(anchorEl.current),
        )}
    </>
  );
}
