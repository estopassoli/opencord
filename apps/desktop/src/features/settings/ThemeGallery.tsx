/**
 * Galeria de temas (Aparência → Tema): cartões com uma prévia (lista, conversa, brilho da aurora e a cor de
 * destaque) em dois grupos, escuros e claros. Um radiogroup: setas trocam, Enter/Espaço escolhem.
 */
import { useId, useRef } from 'react';
import { THEMES, type ThemeDef, type ThemeId } from '../../lib/themes';

export function ThemeGallery({ value, onChange }: { value: ThemeId; onChange: (t: ThemeDef) => void }) {
  const id = useId();
  const refs = useRef<Map<ThemeId, HTMLButtonElement>>(new Map());
  const idx = Math.max(
    0,
    THEMES.findIndex((t) => t.id === value),
  );
  const move = (to: number) => {
    const t = THEMES[(to + THEMES.length) % THEMES.length];
    if (!t) return;
    onChange(t);
    refs.current.get(t.id)?.focus();
  };
  const groups: { label: string; scheme: ThemeDef['scheme'] }[] = [
    { label: 'Escuros', scheme: 'dark' },
    { label: 'Claros', scheme: 'light' },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="theme-gallery"
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
      {groups.map((g) => (
        <div key={g.scheme} className="theme-group">
          <span className="oc-label" id={`${id}-${g.scheme}`}>
            {g.label}
          </span>
          <div className="theme-grid" role="presentation" aria-labelledby={`${id}-${g.scheme}`}>
            {THEMES.filter((t) => t.scheme === g.scheme).map((t) => {
              const accent = t.patch.accent ?? 'var(--brand)';
              const text = t.scheme === 'dark' ? '#eef0f3' : '#15171a';
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    if (el) refs.current.set(t.id, el);
                    else refs.current.delete(t.id);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={t.id === value}
                  tabIndex={t.id === value ? 0 : -1}
                  className="theme-card"
                  onClick={() => onChange(t)}
                >
                  <span
                    className="theme-preview"
                    aria-hidden
                    style={{
                      ['--p-rail' as string]: t.preview.rail,
                      ['--p-chat' as string]: t.preview.chat,
                      ['--p-glow' as string]: t.preview.glow,
                      ['--p-accent' as string]: accent,
                      ['--p-text' as string]: text,
                    }}
                  >
                    <span className="theme-preview-rail" />
                    <span className="theme-preview-chat">
                      <span className="theme-preview-line" />
                      <span className="theme-preview-line short" />
                      <span className="theme-preview-btn" />
                    </span>
                  </span>
                  <span className="theme-card-text">
                    <span className="theme-card-name">{t.name}</span>
                    <span className="oc-hint">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
