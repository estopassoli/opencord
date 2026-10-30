import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { portalTarget } from '@opencord/ui';

/**
 * Tooltip do app para qualquer elemento com `data-tip` (em vez do atributo `title`, que mostraria o tooltip nativo
 * do sistema). Abre no hover e no foco por teclado, com o mesmo visual do componente Tooltip; acima do elemento,
 * ou abaixo se não couber. Montado uma vez por janela (a janela separada da live também tem o seu).
 */
export function GlobalTips({ doc = document }: { doc?: Document }) {
  const [tip, setTip] = useState<{ el: Element; text: string } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const find = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-tip]') : null);
    const open = (el: Element | null) => {
      if (timer.current) clearTimeout(timer.current);
      const text = el?.getAttribute('data-tip');
      if (!el || !text) return setTip(null);
      timer.current = setTimeout(() => setTip({ el, text }), 120);
    };
    const close = () => {
      if (timer.current) clearTimeout(timer.current);
      setTip(null);
    };
    const over = (e: Event) => open(find(e.target));
    const out = (e: Event) => {
      const to = find((e as MouseEvent).relatedTarget);
      if (!to) close();
    };
    doc.addEventListener('pointerover', over);
    doc.addEventListener('pointerout', out);
    doc.addEventListener('focusin', over);
    doc.addEventListener('focusout', close);
    doc.addEventListener('pointerdown', close, true);
    doc.addEventListener('scroll', close, true);
    doc.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    return () => {
      doc.removeEventListener('pointerover', over);
      doc.removeEventListener('pointerout', out);
      doc.removeEventListener('focusin', over);
      doc.removeEventListener('focusout', close);
      doc.removeEventListener('pointerdown', close, true);
      doc.removeEventListener('scroll', close, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [doc]);

  useLayoutEffect(() => {
    if (!tip || !box.current) return setPos(null);
    const a = tip.el.getBoundingClientRect();
    const t = box.current.getBoundingClientRect();
    const win = doc.defaultView ?? window;
    const gap = 8;
    const below = a.top - t.height - gap < 4;
    const top = below ? a.bottom + gap : a.top - t.height - gap;
    const left = Math.max(4, Math.min(a.left + a.width / 2 - t.width / 2, win.innerWidth - t.width - 4));
    setPos({ left, top, below });
  }, [tip, doc]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className={`tooltip tooltip-${pos?.below ? 'bottom' : 'top'}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {tip.text}
    </div>,
    portalTarget(tip.el),
  );
}
