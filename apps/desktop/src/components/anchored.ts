import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Posição fixa (viewport) de um painel ancorado abaixo e à direita de um botão. O painel vai num portal no <body>:
 * dentro do cabeçalho da conversa ele era cortado (overflow: hidden) e o `.content` (container-type) faria o fixo
 * ser relativo a ele, não à janela.
 */
export function useAnchoredPanel(open: boolean, anchor: RefObject<HTMLElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      setStyle({
        position: 'fixed',
        top: Math.round(r.bottom + 8),
        right: Math.max(8, Math.round(window.innerWidth - r.right)),
        maxHeight: Math.max(240, window.innerHeight - r.bottom - 24),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor]);
  return style;
}
