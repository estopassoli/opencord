/**
 * Zoom na transmissão: a roda do mouse aproxima/afasta mirando no ponto sob o cursor; com zoom, arrastar movimenta a
 * imagem (sem sair das bordas). Voltando a 100% (roda, duplo clique ou o botão), tudo volta ao normal: o clique do
 * card torna a funcionar como antes. Com zoom, cliques no vídeo não alternam o destaque.
 */
import { Icon } from '@opencord/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const MAX = 8;
const STEP = 1.15;

type View = { s: number; x: number; y: number };
const ID: View = { s: 1, x: 0, y: 0 };

/** mantém a imagem cobrindo o quadro: o canto não entra para dentro */
export function clampView(v: View, w: number, h: number): View {
  if (v.s <= 1) return ID;
  return { s: v.s, x: Math.min(0, Math.max(w - w * v.s, v.x)), y: Math.min(0, Math.max(h - h * v.s, v.y)) };
}

/** novo zoom mirando no ponto (px, py) do quadro: o que está sob o cursor fica sob o cursor */
export function zoomAt(v: View, factor: number, px: number, py: number, w: number, h: number): View {
  const s = Math.min(MAX, Math.max(1, v.s * factor));
  const cx = (px - v.x) / v.s;
  const cy = (py - v.y) / v.s;
  return clampView({ s, x: px - cx * s, y: py - cy * s }, w, h);
}

export function ZoomPan({ enabled, resetKey, children }: { enabled: boolean; resetKey: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(ID);
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const zoomed = view.s > 1;

  // outra transmissão ou zoom desligado: volta ao normal
  useEffect(() => setView(ID), [resetKey, enabled]);

  // roda do mouse: listener nativo (passive: false) para não rolar a página junto
  useEffect(() => {
    const el = box.current;
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? STEP : 1 / STEP;
      setView((v) => zoomAt(v, factor, e.clientX - r.left, e.clientY - r.top, r.width, r.height));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [enabled]);

  const reset = useCallback(() => setView(ID), []);

  return (
    <div
      ref={box}
      className="zoom-pan"
      data-zoomed={zoomed ? 'true' : undefined}
      onPointerDown={(e) => {
        if (!zoomed || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        const r = e.currentTarget.getBoundingClientRect();
        setView((v) => clampView({ s: v.s, x: d.vx + dx, y: d.vy + dy }, r.width, r.height));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      // com zoom, clicar/arrastar no vídeo não alterna o destaque do card
      onClickCapture={(e) => {
        if (zoomed) e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        if (!zoomed) return;
        e.stopPropagation();
        reset();
      }}
    >
      <div
        className="zoom-layer"
        style={zoomed ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` } : undefined}
      >
        {children}
      </div>
      {zoomed && (
        <div className="zoom-chip" onClick={(e) => e.stopPropagation()}>
          <span>{Math.round(view.s * 100)}%</span>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="Tirar o zoom"
            data-tip="Tirar o zoom"
            onClick={reset}
          >
            <Icon name="minimize" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
