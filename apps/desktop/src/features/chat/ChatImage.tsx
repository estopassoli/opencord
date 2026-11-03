/**
 * Imagem do chat sem "pulo": o espaço já nasce no tamanho final (dimensões do anexo) com um skeleton animado, e a
 * imagem aparece suave quando termina de carregar. Sem dimensões (imagem externa de embed) reserva uma caixa padrão
 * até carregar. Falha vira um aviso discreto em vez do ícone de imagem quebrada.
 */
import { Icon } from '@opencord/ui';
import { useCallback, useState, type CSSProperties } from 'react';

type Props = {
  src: string;
  alt: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  /** caixa máxima em que a imagem é encaixada (px) */
  maxWidth: number;
  maxHeight: number;
  referrerPolicy?: 'no-referrer';
};

/** tamanho exibido: encaixa nas bordas máximas mantendo a proporção, sem ampliar imagem pequena */
export function fitBox(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function ChatImage({ src, alt, width, height, maxWidth, maxHeight, referrerPolicy }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  // imagem já em cache pode terminar antes do React ligar o onLoad
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete) setState(img.naturalWidth > 0 ? 'ready' : 'failed');
  }, []);
  const known = Boolean(width && height);
  const box = known ? fitBox(width!, height!, maxWidth, maxHeight) : null;
  const style: CSSProperties = box
    ? { width: box.width, aspectRatio: `${width} / ${height}` }
    : { maxWidth: `min(${maxWidth}px, 100%)` };

  if (state === 'failed')
    return (
      <span className="chat-img chat-img-failed" style={box ? style : undefined}>
        <Icon name="image" size={20} />
        <span className="small">Não foi possível carregar a imagem</span>
      </span>
    );
  return (
    <span
      className="chat-img"
      data-state={state}
      data-sized={known ? 'true' : undefined}
      style={style}
      aria-busy={state === 'loading' || undefined}
    >
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy={referrerPolicy}
        style={known ? undefined : { maxHeight }}
        onLoad={() => setState('ready')}
        onError={() => setState('failed')}
      />
    </span>
  );
}
