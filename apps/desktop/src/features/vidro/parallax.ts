/**
 * Luz do layout Vidro: a posição do ponteiro vira um par (-1..1) suavizado a cada quadro, nas variáveis CSS --mx e
 * --my; só o ângulo do reflexo nas bordas dos painéis acompanha (sem parallax, a pedido do mantenedor). Com "reduzir
 * movimento" o par fica em zero.
 */
import { create } from 'zustand';

export const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

export const useReducedMotion = create<{ reduced: boolean }>(() => ({
  reduced: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
}));

export function startParallax(el: HTMLElement): () => void {
  const onMove = (e: PointerEvent) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const onLeave = () => {
    pointer.tx = 0;
    pointer.ty = 0;
  };
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const onMq = () => useReducedMotion.setState({ reduced: mq.matches });
  mq.addEventListener('change', onMq);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('mouseleave', onLeave);
  let frame = 0;
  let lastX = NaN;
  let lastY = NaN;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const reduced = useReducedMotion.getState().reduced;
    const tx = reduced ? 0 : pointer.tx;
    const ty = reduced ? 0 : pointer.ty;
    pointer.x += (tx - pointer.x) * 0.06;
    pointer.y += (ty - pointer.y) * 0.06;
    const x = Math.round(pointer.x * 1000) / 1000;
    const y = Math.round(pointer.y * 1000) / 1000;
    if (x === lastX && y === lastY) return;
    lastX = x;
    lastY = y;
    el.style.setProperty('--mx', String(x));
    el.style.setProperty('--my', String(y));
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    mq.removeEventListener('change', onMq);
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseleave', onLeave);
  };
}
