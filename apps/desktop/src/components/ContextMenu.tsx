import { Icon, portalTarget, Slider, type IconName } from '@opencord/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  /** item marcável (caixa à direita); o menu continua fechando ao selecionar */
  checked?: boolean;
  /** linha secundária abaixo do rótulo */
  hint?: string;
  onSelect: () => void;
}
/** controle deslizante dentro do menu (ex.: volume do usuário); não fecha o menu ao mudar */
export interface MenuSlider {
  kind: 'slider';
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}
export type MenuEntry = MenuItem | MenuSlider | 'separator';

const NAV = '[role^="menuitem"]:not([disabled]), [role="slider"]';

function SliderEntry({ item }: { item: MenuSlider }) {
  const [v, setV] = useState(item.value);
  return (
    <div className="context-slider">
      <Slider
        label={item.label}
        min={item.min}
        max={item.max}
        step={item.step}
        value={v}
        format={item.format}
        onChange={(n) => {
          setV(n);
          item.onChange(n);
        }}
      />
    </div>
  );
}

interface MenuState {
  open: { x: number; y: number; items: MenuEntry[]; label: string } | null;
  show(x: number, y: number, items: MenuEntry[], label: string): void;
  close(): void;
}

export const useContextMenu = create<MenuState>()((set) => ({
  open: null,
  show: (x, y, items, label) => set({ open: { x, y, items, label } }),
  close: () => set({ open: null }),
}));

/** Abre o menu na posição do clique direito (ou do elemento, se aberto pelo teclado: Shift+F10 / tecla Menu). */
export function openContextMenu(e: React.MouseEvent | React.KeyboardEvent, items: MenuEntry[], label: string) {
  const visible = items.filter((i) => i !== 'separator');
  if (!visible.length) return;
  e.preventDefault();
  if ('clientX' in e && e.clientX) {
    useContextMenu.getState().show(e.clientX, e.clientY, items, label);
  } else {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useContextMenu.getState().show(r.left + 16, r.top + r.height / 2, items, label);
  }
}

/** Menu de contexto global: setas/Home/End navegam, Enter seleciona, Esc ou clique fora fecham. */
export function ContextMenuHost() {
  const open = useContextMenu((s) => s.open);
  const close = useContextMenu((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const restoreFocus = useRef<Element | null>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(open.x, window.innerWidth - r.width - 8),
      top: Math.min(open.y, window.innerHeight - r.height - 8),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement;
    const raf = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(NAV)?.focus());
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onScroll = () => close();
    // Esc fecha mesmo se o foco não estiver no menu (ex.: o clique direito deixou o foco na mensagem)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onScroll);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onEsc, true);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onScroll);
      window.removeEventListener('resize', onScroll);
      if (restoreFocus.current instanceof HTMLElement) restoreFocus.current.focus();
    };
  }, [open, close]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    // captura: setas verticais navegam mesmo com o foco no controle deslizante (que fica com ←/→)
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(NAV) ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items.at(-1)?.focus();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={open.label}
      style={pos ? { left: pos.left, top: pos.top } : { left: open.x, top: open.y, visibility: 'hidden' }}
      onKeyDownCapture={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {open.items.map((it, idx) =>
        it === 'separator' ? (
          <div key={`sep-${idx}`} role="separator" className="context-sep" />
        ) : 'kind' in it ? (
          <SliderEntry key={it.label} item={it} />
        ) : (
          <button
            key={it.label}
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            className={it.danger ? 'context-item context-danger' : 'context-item'}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.onSelect();
            }}
          >
            <span className="context-label">
              {it.label}
              {it.hint && <small>{it.hint}</small>}
            </span>
            {it.checked !== undefined ? (
              <span className="context-check" aria-hidden="true">
                {it.checked && <Icon name="check" size={14} />}
              </span>
            ) : (
              it.icon && <Icon name={it.icon} size={18} />
            )}
          </button>
        ),
      )}
    </div>,
    portalTarget(),
  );
}
