/**
 * Kit de controles do OpenCord (substitui controles nativos do navegador): visual do tema,
 * navegação completa por teclado e semântica ARIA (listbox, slider, switch, checkbox, radiogroup).
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon.js';

/**
 * Destino de portais: um <dialog> modal fica na "top layer" do navegador, acima de qualquer elemento do <body>.
 * Popovers abertos a partir de um diálogo precisam ser renderizados DENTRO dele, senão ficam por trás e sem clique.
 */
export function portalTarget(anchor?: Element | null): Element {
  return anchor?.closest('dialog[open]') ?? document.querySelector('dialog[open]') ?? document.body;
}

const cx = (...c: unknown[]) => c.filter((x): x is string => typeof x === 'string' && x.length > 0).join(' ');

// ---------------------------------------------------------------------------
// Field: rótulo + dica + erro, compartilhado pelos controles
// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  error,
  htmlFor,
  labelId,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('oc-field', className)}>
      {label && (
        <label className="oc-label" htmlFor={htmlFor} id={labelId}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <small className="oc-hint">{hint}</small>}
      {error && (
        <small className="oc-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: 'sm' | 'md' | 'lg';
    icon?: IconName;
    block?: boolean;
  }
>(function Button(
  { variant = 'primary', size = 'md', icon, block, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('oc-btn', `oc-btn-${variant}`, `oc-btn-${size}`, block && 'oc-btn-block', className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// TextField / TextArea
// ---------------------------------------------------------------------------
type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  leadingIcon?: IconName;
  fieldClassName?: string;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, leadingIcon, fieldClassName, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={fieldClassName}>
      <div className={cx('oc-input-wrap', leadingIcon && 'oc-input-has-icon', error && 'oc-invalid')}>
        {leadingIcon && <Icon name={leadingIcon} size={18} className="oc-input-icon" />}
        <input
          ref={ref}
          id={inputId}
          className={cx('oc-input', className)}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      </div>
    </Field>
  );
});

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  bare?: boolean;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, bare, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const areaId = id ?? auto;
  const area = (
    <textarea
      ref={ref}
      id={areaId}
      className={cx(bare ? 'oc-textarea-bare' : 'oc-textarea', className)}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
  if (bare) return area;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={areaId}>
      {area}
    </Field>
  );
});

// ---------------------------------------------------------------------------
// Select (combobox somente-leitura + listbox em portal)
// ---------------------------------------------------------------------------
export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  hint,
  placeholder = 'Selecionar…',
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: readonly SelectOption<T>[];
  label?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}) {
  const auto = useId();
  const triggerId = id ?? `${auto}-trigger`;
  const labelId = `${auto}-label`;
  const listId = `${auto}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const enabledIndex = useCallback(
    (from: number, dir: 1 | -1) => {
      for (let i = 1; i <= options.length; i++) {
        const idx = (from + dir * i + options.length) % options.length;
        if (!options[idx]?.disabled) return idx;
      }
      return from;
    },
    [options],
  );

  const openList = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : enabledIndex(-1, 1));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const choose = (idx: number) => {
    const o = options[idx];
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const desired = Math.min(320, options.length * 40 + 8);
    const up = below < Math.min(desired, 200) && above > below;
    const maxHeight = Math.max(120, Math.min(320, up ? above : below));
    setPos({
      left: r.left,
      width: r.width,
      top: up ? r.top - Math.min(desired, maxHeight) - 4 : r.bottom + 4,
      maxHeight,
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false);
    };
    const onResize = () => close(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [open]);

  const typeahead = (ch: string) => {
    const now = Date.now();
    typed.current = {
      text: now - typed.current.at < 600 ? typed.current.text + ch.toLowerCase() : ch.toLowerCase(),
      at: now,
    };
    const idx = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
    if (idx >= 0) {
      if (open) setActive(idx);
      else onChange(options[idx]?.value as T);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) typeahead(e.key);
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      close(e.key === 'Escape');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => enabledIndex(a, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => enabledIndex(a, -1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(enabledIndex(-1, 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(enabledIndex(options.length, -1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) typeahead(e.key);
  };

  return (
    <Field label={label} hint={hint} htmlFor={triggerId} labelId={labelId} className={className}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        role="combobox"
        className="oc-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-labelledby={label ? `${labelId} ${triggerId}` : undefined}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
      >
        <span className={cx('oc-select-value', !selected && 'oc-placeholder')}>{selected?.label ?? placeholder}</span>
        <Icon name="chevron-down" size={16} className={cx('oc-select-chevron', open && 'oc-rotated')} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            className="oc-listbox"
            aria-labelledby={label ? labelId : undefined}
            aria-label={label ? undefined : ariaLabel}
            style={
              pos
                ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }
                : { visibility: 'hidden' }
            }
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={cx('oc-option', i === active && 'oc-option-active')}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span className="oc-option-text">
                  <span className="oc-option-label">{o.label}</span>
                  {o.description && <span className="oc-option-desc">{o.description}</span>}
                </span>
                {o.value === value && <Icon name="check" size={16} active />}
              </li>
            ))}
          </ul>,
          portalTarget(trigger.current),
        )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Slider (role="slider"): arrastar, clicar na trilha, setas, PageUp/Down, Home/End
// ---------------------------------------------------------------------------
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  hint,
  format = (v) => String(v),
  marker,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: ReactNode;
  hint?: ReactNode;
  format?: (v: number) => string;
  /** posição de um marcador extra na trilha (ex.: nível atual do microfone) */
  marker?: number;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const pct = ((value - min) / (max - min)) * 100;
  const fromPointer = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return value;
    return clamp(min + ((clientX - r.left) / r.width) * (max - min));
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onChange(fromPointer(e.clientX));
    (e.currentTarget.querySelector('[role="slider"]') as HTMLElement | null)?.focus();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    onChange(fromPointer(e.clientX));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = (max - min) / 10;
    const map: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    };
    const next = map[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onChange(clamp(next));
  };
  return (
    <Field
      label={
        label ? (
          <span id={labelId}>
            {label}: {format(value)}
          </span>
        ) : undefined
      }
      hint={hint}
    >
      <div
        className={cx('oc-slider', disabled && 'oc-disabled')}
        ref={track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <div className="oc-slider-track">
          <div className="oc-slider-fill" style={{ width: `${pct}%` }} />
          {marker !== undefined && (
            <div className="oc-slider-marker" style={{ left: `${((marker - min) / (max - min)) * 100}%` }} />
          )}
        </div>
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          className="oc-slider-thumb"
          style={{ left: `${pct}%` }}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={format(value)}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-disabled={disabled || undefined}
          onKeyDown={onKey}
        />
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Switch (role="switch")
// ---------------------------------------------------------------------------
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="oc-switch-row">
      <span className="oc-switch-text">
        <span id={`${id}-l`} className="oc-switch-label">
          {label}
        </span>
        {description && (
          <span id={`${id}-d`} className="oc-hint">
            {description}
          </span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        className="oc-switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="oc-switch-thumb">{checked && <Icon name="check" size={12} active />}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkbox (role="checkbox")
// ---------------------------------------------------------------------------
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx('oc-check-row', disabled && 'oc-disabled')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        className="oc-checkbox"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {checked && <Icon name="check" size={14} active />}
      </button>
      <span className="oc-check-text" onClick={() => !disabled && onChange(!checked)}>
        <span id={`${id}-l`}>{label}</span>
        {description && (
          <span id={`${id}-d`} className="oc-hint">
            {description}
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RadioGroup (role="radiogroup", roving tabindex com setas)
// ---------------------------------------------------------------------------
export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  hideLabel,
  variant = 'list',
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; description?: string; icon?: IconName }[];
  label: ReactNode;
  /** esconde o rótulo visualmente (ex.: já há um título de seção igual), mantendo-o para leitores de tela */
  hideLabel?: boolean;
  variant?: 'list' | 'cards';
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const move = (to: number) => {
    const n = (to + options.length) % options.length;
    const o = options[n];
    if (!o) return;
    onChange(o.value);
    refs.current[n]?.focus();
  };
  return (
    <div className="oc-field">
      <span className={hideLabel ? 'oc-visually-hidden' : 'oc-label'} id={`${id}-l`}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-l`}
        className={cx('oc-radiogroup', `oc-radiogroup-${variant}`)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            move(idx + 1);
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            move(idx - 1);
          }
        }}
      >
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            className="oc-radio"
            onClick={() => onChange(o.value)}
          >
            <span className="oc-radio-dot" aria-hidden />
            {o.icon && <Icon name={o.icon} size={18} />}
            <span className="oc-radio-text">
              <span>{o.label}</span>
              {o.description && <span className="oc-hint">{o.description}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ColorSwatches (paleta própria; "Padrão" = sem cor)
// ---------------------------------------------------------------------------
/** Paleta própria do OpenCord para cargos (contraste ≥ 3:1 sobre as superfícies escuras). */
export const ROLE_COLORS = [
  '#5fd3c6',
  '#3fb27f',
  '#8fd14f',
  '#e8c547',
  '#e8a33d',
  '#f07a4a',
  '#ff7a7f',
  '#e86fb4',
  '#b98cf2',
  '#8a9cff',
  '#6cc7ff',
  '#a7b0bf',
] as const;

export function ColorSwatches({
  value,
  onChange,
  label,
  colors = ROLE_COLORS,
  defaultColor,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  label: ReactNode;
  /** paleta exibida após a opção "Padrão" */
  colors?: readonly string[];
  /** cor exibida na opção "Padrão" (sem ela, a opção aparece neutra) */
  defaultColor?: string;
}) {
  const id = useId();
  const all: (string | null)[] = [null, ...colors];
  const idx = Math.max(
    0,
    all.findIndex((c) => c?.toLowerCase() === value?.toLowerCase()),
  );
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const n = (to + all.length) % all.length;
    onChange(all[n] ?? null);
    refs.current[n]?.focus();
  };
  return (
    <div className="oc-field">
      <span className="oc-label" id={`${id}-l`}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-l`}
        className="oc-swatches"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            move(idx + 1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            move(idx - 1);
          }
        }}
      >
        {all.map((c, i) => (
          <button
            key={c ?? 'none'}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === idx}
            aria-label={c ? `Cor ${c}` : 'Cor padrão'}
            tabIndex={i === idx ? 0 : -1}
            className={cx('oc-swatch', !c && !defaultColor && 'oc-swatch-default')}
            style={c || defaultColor ? { background: c ?? defaultColor } : undefined}
            onClick={() => onChange(c)}
          >
            {i === idx && <Icon name="check" size={14} active />}
          </button>
        ))}
      </div>
    </div>
  );
}
