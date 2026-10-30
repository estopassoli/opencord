import { Button, Slider } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import type { CropRect } from '../lib/images';

const VIEW = 320;

/**
 * Recorte quadrado antes do envio (foto de perfil ou imagem do servidor): arraste para posicionar, zoom pela barra,
 * pela roda do mouse ou pelas setas/+/-. A prévia já mostra a forma final (círculo ou quadrado arredondado).
 */
export function ImageCropDialog({
  file,
  title,
  shape,
  onCancel,
  onConfirm,
}: {
  file: File;
  title: string;
  shape: 'circle' | 'rounded';
  onCancel: () => void;
  onConfirm: (crop: CropRect) => void;
}) {
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      setImg({ url, w: el.naturalWidth, h: el.naturalHeight });
      const s = VIEW / Math.min(el.naturalWidth, el.naturalHeight);
      setOff({ x: (VIEW - el.naturalWidth * s) / 2, y: (VIEW - el.naturalHeight * s) / 2 });
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const scale = img ? (VIEW / Math.min(img.w, img.h)) * zoom : 1;
  const clamp = (o: { x: number; y: number }, sc = scale) =>
    img
      ? {
          x: Math.min(0, Math.max(VIEW - img.w * sc, o.x)),
          y: Math.min(0, Math.max(VIEW - img.h * sc, o.y)),
        }
      : o;

  /** zoom mantendo o centro do recorte no lugar */
  const setZoomKeep = (z: number) => {
    if (!img) return;
    const nz = Math.min(4, Math.max(1, z));
    const s0 = VIEW / Math.min(img.w, img.h);
    const cx = (VIEW / 2 - off.x) / scale;
    const cy = (VIEW / 2 - off.y) / scale;
    const ns = s0 * nz;
    setZoom(nz);
    setOff(clamp({ x: VIEW / 2 - cx * ns, y: VIEW / 2 - cy * ns }, ns));
  };

  const confirm = () => {
    if (!img) return;
    onConfirm({ x: -off.x / scale, y: -off.y / scale, size: VIEW / scale });
  };

  return (
    <Dialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={!img}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="cropper">
        <div
          className="cropper-view"
          data-shape={shape}
          style={{ width: VIEW, height: VIEW }}
          tabIndex={0}
          role="application"
          aria-label="Área de recorte: arraste ou use as setas para posicionar, + e − para o zoom"
          onPointerDown={(e) => {
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
      </div>
    </Dialog>
  );
}
