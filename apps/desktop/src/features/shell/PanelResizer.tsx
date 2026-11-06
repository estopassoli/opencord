/**
 * Alça para arrastar a largura da lista de canais ou da lista de membros. Durante o arrasto só a variável CSS da casca
 * muda (sem re-render); ao soltar, a largura vai para as configurações da conta. Teclado: setas (Shift = passo maior);
 * duplo clique volta ao padrão do layout.
 */
import type { UserSettings } from '@opencord/contracts';
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { updateSettings } from '../../store/settings';

const PANELS = {
  channels: { cssVar: '--sidebar-width', key: 'sidebarWidth', min: 300, max: 480, panel: '.sidebar', label: 'canais' },
  members: { cssVar: '--members-width', key: 'membersWidth', min: 200, max: 420, panel: '.members', label: 'membros' },
} as const;

export type ResizablePanel = keyof typeof PANELS;

const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)));

export function PanelResizer({ panel, width }: { panel: ResizablePanel; width: number | undefined }) {
  const p = PANELS[panel];
  const drag = useRef<{ x: number; w: number; cur: number } | null>(null);
  // a lista de canais cresce para a direita; a de membros, para a esquerda
  const dir = panel === 'channels' ? 1 : -1;

  const shellOf = (el: Element) => el.closest<HTMLElement>('.shell, .vidro-shell');
  // sem largura salva, o tamanho é o do layout (muda com a janela): mede o painel
  const current = (el: Element) =>
    width ?? Math.round(shellOf(el)?.querySelector(p.panel)?.getBoundingClientRect().width ?? p.min);
  const save = (w: number | undefined) =>
    updateSettings((s): UserSettings => ({ ...s, [p.key]: w === undefined ? undefined : clamp(w, p.min, p.max) }));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const w = current(e.currentTarget);
    drag.current = { x: e.clientX, w, cur: w };
    document.documentElement.dataset.resizing = 'true';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.cur = clamp(d.w + (e.clientX - d.x) * dir, p.min, p.max);
    shellOf(e.currentTarget)?.style.setProperty(p.cssVar, `${d.cur}px`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    delete document.documentElement.dataset.resizing;
    if (d.cur !== d.w) save(d.cur);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const w = current(e.currentTarget);
    if (e.key === 'ArrowRight') save(w + step * dir);
    else if (e.key === 'ArrowLeft') save(w - step * dir);
    else if (e.key === 'Home') save(p.min);
    else if (e.key === 'End') save(p.max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="panel-resizer"
      data-panel={panel}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Largura da lista de ${p.label}`}
      aria-valuemin={p.min}
      aria-valuemax={p.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={() => save(panel === 'channels' ? p.min : undefined)}
      onKeyDown={onKeyDown}
    />
  );
}

/** largura salva (com os limites); undefined = a do layout */
export function panelWidth(panel: ResizablePanel, settings: UserSettings | null | undefined) {
  const p = PANELS[panel];
  const v = settings?.[p.key];
  return typeof v === 'number' ? clamp(v, p.min, p.max) : undefined;
}
