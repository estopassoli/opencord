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
  /** bolinha de cor antes do rótulo (ex.: cor do cargo) */
  color?: string | null;
  /** não fecha o menu ao selecionar (marcar vários itens seguidos); a caixa reflete o clique na hora */
  keepOpen?: boolean;
  onSelect: () => void;
}
/** item que abre um submenu ao lado (mouse, Enter ou →; ← volta) */
export interface MenuSub {
  kind: 'submenu';
  label: string;
  icon?: IconName;
  items: MenuEntry[];
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
export type MenuEntry = MenuItem | MenuSlider | MenuSub | 'separator';

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

function ItemButton({ it, close }: { it: MenuItem; close: () => void }) {
  // itens que não fecham o menu mostram a marcação nova na hora (o menu é um retrato do estado ao abrir)
  const [checked, setChecked] = useState(it.checked);
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      className={it.danger ? 'context-item context-danger' : 'context-item'}
      disabled={it.disabled}
      onClick={() => {
        if (it.keepOpen) {
          if (checked !== undefined) setChecked(!checked);
        } else close();
        it.onSelect();
      }}
    >
      <span className="context-label">
        <span className="context-label-row">
          {it.color !== undefined && (
            <span className="context-dot" style={{ background: it.color ?? 'var(--text-muted)' }} aria-hidden="true" />
          )}
          {it.label}
        </span>
        {it.hint && <small>{it.hint}</small>}
      </span>
      {checked !== undefined ? (
        <span className="context-check" aria-hidden="true">
          {checked && <Icon name="check" size={14} />}
        </span>
      ) : (
        it.icon && <Icon name={it.icon} size={18} />
      )}
    </button>
  );
}

function Entries({ items, close }: { items: MenuEntry[]; close: () => void }) {
  return (
    <>
      {items.map((it, idx) =>
        it === 'separator' ? (
          <div key={`sep-${idx}`} role="separator" className="context-sep" />
        ) : 'kind' in it ? (
          it.kind === 'slider' ? (
            <SliderEntry key={it.label} item={it} />
          ) : (
            <SubEntry key={it.label} sub={it} close={close} />
          )
        ) : (
          <ItemButton key={it.label} it={it} close={close} />
        ),
      )}
    </>
  );
}

/** tempo para alcançar o submenu antes de ele fechar */
const SUBMENU_CLOSE_MS = 300;

function SubEntry({ sub, close }: { sub: MenuSub; close: () => void }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'right' | 'left'>('right');
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // fechar com atraso: atravessar o espaço até o submenu (ou passar o mouse na diagonal por outro item) não fecha;
  // voltar a qualquer parte do item/submenu cancela
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), SUBMENU_CLOSE_MS);
  };
  useEffect(() => cancelClose, []);
  useLayoutEffect(() => {
    if (!open || !panel.current || !wrap.current) return;
    const w = panel.current.offsetWidth;
    setSide(wrap.current.getBoundingClientRect().right + w + 8 > window.innerWidth ? 'left' : 'right');
  }, [open]);
  const openAndFocus = () => {
    setOpen(true);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(NAV)?.focus());
  };
  return (
    <div
      className="context-sub"
      ref={wrap}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={closeSoon}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="context-item"
        onClick={openAndFocus}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            openAndFocus();
          }
        }}
      >
        <span className="context-label">{sub.label}</span>
        <Icon name="chevron-right" size={16} />
      </button>
      {open && (
        <div ref={panel} className="context-menu context-submenu" data-side={side} role="menu" aria-label={sub.label}>
          <Entries items={sub.items} close={close} />
        </div>
      )}
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
    // captura: setas verticais navegam mesmo com o foco no controle deslizante (que fica com ←/→);
    // dentro de um submenu, só entre os itens dele
    const scope = (document.activeElement as HTMLElement | null)?.closest('[role="menu"]') ?? ref.current;
    const items = [...(scope?.querySelectorAll<HTMLElement>(NAV) ?? [])].filter(
      (el) => el.closest('[role="menu"]') === scope,
    );
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
      <Entries items={open.items} close={close} />
    </div>,
    portalTarget(),
  );
}
