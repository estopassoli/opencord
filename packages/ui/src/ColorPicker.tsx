/**
 * Seletor de cor do kit: campo com a amostra e o hex; ao focar/clicar abre um painel com o quadrado de saturação e
 * brilho e a barra de matiz (mouse, toque e teclado), mais atalhos de cores prontas. Sem o <input type="color"> do
 * sistema, que muda de cara em cada plataforma.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Field, portalTarget } from './forms.js';

type Hsv = { h: number; s: number; v: number };

const HEX = /^#?([0-9a-f]{6})$/i;
const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));

export function hexToHsv(hex: string): Hsv | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
  };
  const to = (c: number) =>
    Math.round(clamp(c) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

export function ColorPicker({
  label,
  value,
  onChange,
  presets,
  placeholder = '#rrggbb',
  hint,
}: {
  label: ReactNode;
  /** #rrggbb ou null (sem cor) */
  value: string | null;
  onChange: (hex: string) => void;
  /** cores prontas mostradas embaixo do painel */
  presets?: readonly string[];
  placeholder?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  // matiz guardado à parte: com saturação 0 ou brilho 0 o hex não diz qual era
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value ?? '') ?? { h: 30, s: 0.6, v: 0.9 });
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });

  useEffect(() => {
    setText(value ?? '');
    const next = value ? hexToHsv(value) : null;
    if (next)
      setHsv((cur) => (hsvToHex(next) === hsvToHex(cur) ? cur : { ...next, h: next.s && next.v ? next.h : cur.h }));
  }, [value]);

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next);
      const hex = hsvToHex(next);
      setText(hex);
      onChange(hex);
    },
    [onChange],
  );

  // painel em portal, abaixo do campo (ou acima, se não couber)
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      const h = panel.current?.offsetHeight ?? 280;
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      setPos({
        position: 'fixed',
        left: Math.round(Math.min(r.left, window.innerWidth - 248)),
        top: Math.round(below ? r.bottom + 6 : Math.max(8, r.top - 6 - h)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrap.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const dragTo = (el: HTMLElement, e: PointerEvent, apply: (x: number, y: number) => void) => {
    const r = el.getBoundingClientRect();
    apply(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  const drag = (apply: (x: number, y: number) => void) => ({
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragTo(e.currentTarget, e, apply);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) dragTo(e.currentTarget, e, apply);
    },
  });

  const svKeys = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    emit({ ...hsv, s: clamp(hsv.s + d[0]!), v: clamp(hsv.v + d[1]!) });
  };
  const hueKeys = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 2;
    const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    emit({ ...hsv, h: (hsv.h + d + 360) % 360 });
  };

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const current = HEX.test(text) ? (text.startsWith('#') ? text : `#${text}`) : (value ?? null);

  return (
    <Field label={label} hint={hint} htmlFor={id} className="oc-color-field">
      <div ref={wrap} className="oc-color-input" data-open={open ? 'true' : undefined}>
        <button
          type="button"
          className="oc-color-swatch"
          style={{ background: current ?? 'transparent' }}
          data-empty={current ? undefined : 'true'}
          aria-label="Abrir seletor de cor"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
        <input
          id={id}
          className="oc-color-hex"
          value={text}
          placeholder={placeholder}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            const next = hexToHsv(v);
            if (next) {
              setHsv((cur) => ({ ...next, h: next.s && next.v ? next.h : cur.h }));
              onChange(hsvToHex(next));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
      </div>
      {open &&
        createPortal(
          <div ref={panel} className="oc-color-panel" style={pos} role="dialog" aria-label="Seletor de cor">
            <div
              className="oc-color-sv"
              style={{ background: hueColor }}
              role="slider"
              tabIndex={0}
              aria-label="Saturação e brilho"
              aria-valuetext={`saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
              onKeyDown={svKeys}
              {...drag((x, y) => emit({ ...hsv, s: x, v: 1 - y }))}
            >
              <span
                className="oc-color-thumb"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
              />
            </div>
            <div
              className="oc-color-hue"
              role="slider"
              tabIndex={0}
              aria-label="Matiz"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              onKeyDown={hueKeys}
              {...drag((x) => emit({ ...hsv, h: x * 360 }))}
            >
              <span className="oc-color-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }} />
            </div>
            {presets && presets.length > 0 && (
              <div className="oc-color-presets" role="group" aria-label="Cores prontas">
                {presets.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="oc-color-preset"
                    style={{ background: c }}
                    aria-label={c}
                    aria-pressed={current?.toLowerCase() === c.toLowerCase()}
                    onClick={() => {
                      const next = hexToHsv(c);
                      if (next) emit(next);
                    }}
                  />
                ))}
              </div>
            )}
          </div>,
          portalTarget(wrap.current),
        )}
    </Field>
  );
}
