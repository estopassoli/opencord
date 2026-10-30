import { Avatar, Icon } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { openContextMenu, type MenuEntry } from '../../components/ContextMenu';
import { Tooltip } from '../../components/Tooltip';
import { bridge } from '../../lib/bridge';
import { useUi, type MediaItem } from '../../store/ui';

const ZOOMS = [1, 1.5, 2, 3, 4];

const sizeLabel = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

async function fetchBlob(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`erro ${res.status}`);
  return res.blob();
}

/** Copia a imagem como PNG (a área de transferência só aceita PNG de forma confiável). */
async function copyImage(url: string) {
  const bmp = await createImageBitmap(await fetchBlob(url));
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')?.drawImage(bmp, 0, 0);
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!png) throw new Error('falha ao converter');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

async function download(item: MediaItem) {
  const href = URL.createObjectURL(await fetchBlob(item.url));
  const a = document.createElement('a');
  a.href = href;
  a.download = item.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Visualizador de mídia das conversas: imagem grande sobre fundo escuro, quem enviou e quando, zoom (roda do mouse,
 * clique ou botões; arrasta para mover), girar, baixar, abrir no navegador e "⋯" (copiar imagem/link, detalhes).
 * ← → passam pelas imagens da conversa; Esc fecha.
 */
export function MediaViewer() {
  const media = useUi((s) => s.media);
  if (!media) return null;
  return createPortal(<Viewer items={media.items} start={media.index} />, document.body);
}

function Viewer({ items, start }: { items: MediaItem[]; start: number }) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = items[index]!;
  const close = () => useUi.getState().closeMedia();
  const toast = (ok: string) => useUi.getState().toast('success', ok);
  const fail = () => useUi.getState().toast('error', 'Não foi possível concluir.');

  // trocar de imagem volta ao enquadramento normal
  useEffect(() => {
    setZoom(1);
    setRot(0);
    setPan({ x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(items.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      else if (e.key === '+' || e.key === '=') setZoom((z) => ZOOMS.find((v) => v > z) ?? z);
      else if (e.key === '-') setZoom((z) => [...ZOOMS].reverse().find((v) => v < z) ?? z);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [items.length]);

  useEffect(() => {
    if (zoom === 1) setPan({ x: 0, y: 0 });
  }, [zoom]);

  const zoomIn = () => setZoom((z) => ZOOMS.find((v) => v > z) ?? z);
  const openExternal = () =>
    bridge ? void bridge.openExternal(item.url) : window.open(item.url, '_blank', 'noopener');
  const more = (e: React.MouseEvent) => {
    const items: MenuEntry[] = [
      {
        label: 'Copiar imagem',
        icon: 'copy',
        onSelect: () => void copyImage(item.url).then(() => toast('Imagem copiada.'), fail),
      },
      {
        label: 'Copiar link',
        icon: 'link',
        onSelect: () => void navigator.clipboard.writeText(item.url).then(() => toast('Link copiado.'), fail),
      },
      'separator',
      { label: `Arquivo: ${item.name}`, icon: 'folder', disabled: true, onSelect: () => undefined },
      {
        label: `${item.width && item.height ? `${item.width}×${item.height} · ` : ''}${sizeLabel(item.sizeBytes)}`,
        icon: 'eye',
        disabled: true,
        onSelect: () => undefined,
      },
    ];
    openContextMenu(e, items, 'Mais opções da imagem');
  };

  return (
    <div
      className="media-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Imagem ${index + 1} de ${items.length}: ${item.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onWheel={(e) => {
        if (e.deltaY < 0) zoomIn();
        else setZoom((z) => [...ZOOMS].reverse().find((v) => v < z) ?? z);
      }}
    >
      <header className="media-top">
        <div className="media-author">
          <Avatar id={item.authorId} name={item.authorName} size={32} />
          <span>
            <strong className="truncate">{item.authorName}</strong>
            <span className="muted small">{new Date(item.createdAt).toLocaleString()}</span>
          </span>
        </div>
        <div className="media-tools" role="toolbar" aria-label="Ações da imagem">
          <Tooltip label={zoom > 1 ? 'Tamanho normal' : 'Ampliar'}>
            <button
              className="media-btn"
              aria-label={zoom > 1 ? 'Tamanho normal' : 'Ampliar'}
              aria-pressed={zoom > 1}
              onClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
            >
              <Icon name="search" size={18} />
            </button>
          </Tooltip>
          <Tooltip label="Girar">
            <button className="media-btn" aria-label="Girar" onClick={() => setRot((r) => (r + 90) % 360)}>
              <Icon name="refresh" size={18} />
            </button>
          </Tooltip>
          <Tooltip label="Baixar">
            <button className="media-btn" aria-label="Baixar" onClick={() => void download(item).catch(fail)}>
              <Icon name="download" size={18} />
            </button>
          </Tooltip>
          <Tooltip label="Abrir no navegador">
            <button className="media-btn" aria-label="Abrir no navegador" onClick={openExternal}>
              <Icon name="popout" size={18} />
            </button>
          </Tooltip>
          <Tooltip label="Mais">
            <button className="media-btn" aria-label="Mais opções" aria-haspopup="menu" onClick={more}>
              <Icon name="more" size={18} />
            </button>
          </Tooltip>
          <span className="media-sep" aria-hidden="true" />
          <Tooltip label="Fechar (Esc)">
            <button ref={closeRef} className="media-btn" aria-label="Fechar" onClick={close}>
              <Icon name="close" size={18} />
            </button>
          </Tooltip>
        </div>
      </header>

      {index > 0 && (
        <button className="media-nav media-prev" aria-label="Imagem anterior" onClick={() => setIndex(index - 1)}>
          <Icon name="chevron-right" size={24} />
        </button>
      )}
      {index < items.length - 1 && (
        <button className="media-nav media-next" aria-label="Próxima imagem" onClick={() => setIndex(index + 1)}>
          <Icon name="chevron-right" size={24} />
        </button>
      )}

      <img
        key={item.id}
        className="media-img"
        src={item.url}
        alt={item.name}
        draggable={false}
        data-zoomed={zoom > 1 ? 'true' : undefined}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rot}deg)` }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || zoom === 1) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          setPan({ x: d.px + dx, y: d.py + dy });
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          // clique sem arrastar alterna o zoom
          if (d && !d.moved) setZoom((z) => (z > 1 ? 1 : 2));
        }}
      />

      {items.length > 1 && (
        <span className="media-count muted small">
          {index + 1} de {items.length}
        </span>
      )}
    </div>
  );
}
