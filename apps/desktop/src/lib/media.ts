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
