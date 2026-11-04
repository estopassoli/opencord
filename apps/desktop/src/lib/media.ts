import { useSyncExternalStore } from 'react';

/**
 * Mesma quebra do CSS (styles/mobile.css): uma área por vez, gavetas laterais.
 * Inclui o celular deitado (pouca altura + toque), onde o layout de colunas não cabe.
 */
export const MOBILE_QUERY = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';

function subscribe(cb: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/**
 * Teclado virtual (tela de toque sem mouse): Enter pula linha e só o botão envia, como nos apps de mensagem do celular
 * (card "corrigir o pular linha do teclado", 2026-11-04). Com mouse/teclado físico, Enter envia e Shift+Enter pula.
 */
export const TOUCH_KEYBOARD_QUERY = '(hover: none) and (pointer: coarse)';

/** lido na hora da tecla: não precisa re-renderizar */
export const enterSends = () =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : !window.matchMedia(TOUCH_KEYBOARD_QUERY).matches;

export function useTouchKeyboard(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(TOUCH_KEYBOARD_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(TOUCH_KEYBOARD_QUERY).matches,
    () => false,
  );
}
