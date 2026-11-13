import { Button, Slider } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { isAnimatedGif } from '../lib/gif-crop';
import type { CropRect } from '../lib/images';

/** lado da área de recorte quadrada; a retangular (banner) usa a largura maior */
const SQUARE = 320;
const WIDE = 432;

/**
 * Recorte antes do envio (foto de perfil, banner, imagem do servidor): arraste para posicionar, zoom pela barra, pela
 * roda do mouse ou pelas setas/+/-. A prévia já mostra a forma final (círculo, quadrado arredondado ou a faixa do
 * banner). GIF animado continua animado na prévia e no resultado. `onConfirm` pode demorar (GIF é refeito quadro a
 * quadro): enquanto isso o diálogo mostra o progresso e não fecha; se der erro, continua aberto para tentar de novo.
 */
export function ImageCropDialog({
  file,
  title,
  shape,
  aspect = 1,
  onCancel,
  onConfirm,
}: {
  file: File;
  title: string;
  shape: 'circle' | 'rounded' | 'rect';
  /** largura ÷ altura do recorte */
  aspect?: number;
  onCancel: () => void;
  onConfirm: (crop: CropRect, onProgress: (fraction: number) => void) => void | Promise<void>;
}) {
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [viewW] = useState(() =>
    Math.max(200, Math.min(aspect > 1 ? WIDE : SQUARE, (typeof window !== 'undefined' ? window.innerWidth : 480) - 80)),
  );
  const viewH = Math.round(viewW / aspect);

  /** escala que cobre a área inteira com zoom 1 */
  const baseScale = (w: number, h: number) => Math.max(viewW / w, viewH / h);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const w = el.naturalWidth;
      const h = el.naturalHeight;
      setImg({ url, w, h });
      const s = baseScale(w, h);
      setOff({ x: (viewW - w * s) / 2, y: (viewH - h * s) / 2 });
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
    // a área não muda depois de aberto
  }, [file]);

  // GIF parado vira imagem comum; só o animado ganha o aviso
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    let live = true;
    void isAnimatedGif(file).then((a) => live && setAnimated(a));
    return () => {
      live = false;
    };
  }, [file]);

  const scale = img ? baseScale(img.w, img.h) * zoom : 1;
  const clamp = (o: { x: number; y: number }, sc = scale) =>
    img
      ? {
          x: Math.min(0, Math.max(viewW - img.w * sc, o.x)),
          y: Math.min(0, Math.max(viewH - img.h * sc, o.y)),
        }
      : o;

  /** zoom mantendo o centro do recorte no lugar */
  const setZoomKeep = (z: number) => {
    if (!img || busy !== null) return;
    const nz = Math.min(4, Math.max(1, z));
    const cx = (viewW / 2 - off.x) / scale;
    const cy = (viewH / 2 - off.y) / scale;
    const ns = baseScale(img.w, img.h) * nz;
    setZoom(nz);
    setOff(clamp({ x: viewW / 2 - cx * ns, y: viewH / 2 - cy * ns }, ns));
  };

  const confirm = async () => {
    if (!img || busy !== null) return;
    const crop: CropRect = {
      x: Math.max(0, -off.x / scale),
      y: Math.max(0, -off.y / scale),
      w: Math.min(img.w, viewW / scale),
      h: Math.min(img.h, viewH / scale),
    };
    setBusy(0);
    try {
      await onConfirm(crop, (f) => setBusy(f));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    if (busy === null) onCancel();
  };

  return (
    <Dialog
      title={title}
      onClose={cancel}
      actions={
        <>
          <Button variant="ghost" onClick={cancel} disabled={busy !== null}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} disabled={!img || busy !== null}>
            {busy === null ? 'Aplicar' : animated ? `Preparando o GIF… ${Math.round(busy * 100)}%` : 'Preparando…'}
          </Button>
        </>
      }
    >
      <div className="cropper" style={{ width: viewW }}>
        <div
          className="cropper-view"
          data-shape={shape}
          style={{ width: viewW, height: viewH }}
          tabIndex={0}
          role="application"
          aria-label="Área de recorte: arraste ou use as setas para posicionar, + e − para o zoom"
          aria-busy={busy !== null || undefined}
          onPointerDown={(e) => {
            if (busy !== null) return;
            drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => setZoomKeep(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
          onKeyDown={(e) => {
            if (busy !== null) return;
            const step = 10;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [step, 0],
              ArrowRight: [-step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            };
            const m = moves[e.key];
            if (m) setOff(clamp({ x: off.x + m[0], y: off.y + m[1] }));
            else if (e.key === '+' || e.key === '=') setZoomKeep(zoom * 1.1);
            else if (e.key === '-') setZoomKeep(zoom / 1.1);
            else return;
            e.preventDefault();
          }}
        >
          {img && (
            <img
              src={img.url}
              alt=""
              draggable={false}
              style={{ width: img.w * scale, height: img.h * scale, transform: `translate(${off.x}px, ${off.y}px)` }}
            />
          )}
          <span className="cropper-mask" aria-hidden="true" />
        </div>
        <Slider
          label="Zoom"
          min={100}
          max={400}
          step={5}
          format={(v) => `${v}%`}
          value={Math.round(zoom * 100)}
          onChange={(v) => setZoomKeep(v / 100)}
        />
        {animated && <p className="muted small cropper-note">O GIF continua animado depois do recorte.</p>}
      </div>
    </Dialog>
  );
}
