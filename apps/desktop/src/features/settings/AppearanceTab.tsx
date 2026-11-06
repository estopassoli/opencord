import type { UserSettings } from '@opencord/contracts';
import { Button, ColorSwatches, Select, Slider, Switch, TextField, type SelectOption } from '@opencord/ui';
import { useEffect, useRef, useState } from 'react';
import {
  familyFromFileName,
  FONT_ACCEPT,
  FontImportError,
  importFont,
  removeImportedFont,
  useImportedFonts,
} from '../../lib/fonts';
import { isFontAvailable } from '../../lib/theme';
import { currentTheme, themeById } from '../../lib/themes';
import { useLayout } from '../../lib/layout';
import { updateSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { ThemeGallery } from './ThemeGallery';
import { Section } from './Section';

// ---------------------------------------------------------------------------
// Aparência e notificações
// ---------------------------------------------------------------------------

function setAppearance(patch: Partial<UserSettings['appearance']>) {
  updateSettings((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }));
}

const REDUCED_MOTION_OPTIONS: readonly SelectOption<UserSettings['appearance']['reducedMotion']>[] = [
  { value: 'system', label: 'Seguir o sistema' },
  { value: 'on', label: 'Sempre reduzir' },
  { value: 'off', label: 'Nunca reduzir' },
];

/** Paleta própria de destaques (a primeira é a cor da logo). */
export const ACCENTS = [
  '#4d56fd',
  '#7c5cff',
  '#b44dff',
  '#e0559b',
  '#ef4f4f',
  '#f08a24',
  '#d9a514',
  '#3fb27f',
  '#14a3a3',
  '#2d8cff',
  '#8a94a6',
] as const;
export const DEFAULT_ACCENT = ACCENTS[0];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_NAME_RE = /^[\p{L}\p{N} ._-]*$/u;

const FONT_PRESETS: readonly SelectOption<string>[] = [
  { value: '', label: 'Padrão (Inter)' },
  { value: 'Segoe UI Variable Text', label: 'Segoe UI Variable' },
  { value: 'Segoe UI', label: 'Segoe UI' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Consolas', label: 'Consolas' },
  { value: '__custom', label: 'Outra fonte instalada…' },
];

const DEFAULT_APPEARANCE: Pick<
  UserSettings['appearance'],
  'accent' | 'surface' | 'palette' | 'radiusScale' | 'fontFamily' | 'fontScale' | 'compact'
> = {
  accent: DEFAULT_ACCENT,
  surface: 'default',
  palette: 'default',
  radiusScale: 1,
  fontFamily: '',
  fontScale: 1,
  compact: true,
};

export function AppearanceTab({ settings }: { settings: UserSettings }) {
  const a = settings.appearance;
  const layout = useLayout((l) => l.layout);
  const [hex, setHex] = useState(a.accent);
  useEffect(() => setHex(a.accent), [a.accent]);
  const imported = useImportedFonts((st) => st.families);
  const fontOptions: readonly SelectOption<string>[] = [
    ...FONT_PRESETS.slice(0, -1),
    ...imported.map((f) => ({ value: f, label: `${f} (importada)` })),
    FONT_PRESETS[FONT_PRESETS.length - 1]!,
  ];
  const isPreset = fontOptions.some((f) => f.value === a.fontFamily && f.value !== '__custom');
  const [customFont, setCustomFont] = useState(!isPreset);
  const [fontDraft, setFontDraft] = useState(isPreset ? '' : a.fontFamily);
  const fontMissing = a.fontFamily !== '' && !isFontAvailable(a.fontFamily);
  return (
    <>
      <Section
        title="Tema"
        description="Escuros e claros, cada um com a sua cor de destaque; dá para trocar a cor abaixo."
      >
        <ThemeGallery
          value={currentTheme(a)}
          onChange={(t) => {
            // a cor de destaque só troca junto se a pessoa não a personalizou (ainda é a sugerida pelo tema atual)
            const suggested = themeById(currentTheme(a)).patch.accent ?? DEFAULT_ACCENT;
            const custom = a.accent.toLowerCase() !== suggested.toLowerCase();
            const { accent, ...rest } = t.patch;
            setAppearance(custom ? rest : { ...rest, accent: accent ?? DEFAULT_ACCENT });
          }}
        />
      </Section>
      <Section title="Visual">
        <Switch
          label="Glassmorfismo (visual Vidro)"
          description="Desligado, volta o visual clássico. Ctrl+Alt+L também alterna."
          checked={layout === 'vidro'}
          onChange={(v) => useLayout.getState().setLayout(v ? 'vidro' : 'classico')}
        />
      </Section>
      <Section title="Cores" description="A cor de destaque aparece em botões, seleções, menções e indicadores.">
        <ColorSwatches
          label="Cor de destaque"
          colors={ACCENTS.slice(1)}
          defaultColor={DEFAULT_ACCENT}
          value={a.accent.toLowerCase() === DEFAULT_ACCENT ? null : a.accent}
          onChange={(v) => setAppearance({ accent: v ?? DEFAULT_ACCENT })}
        />
        <TextField
          label="Código da cor"
          hint="Formato #RRGGBB. O texto sobre a cor é ajustado automaticamente para manter a leitura."
          value={hex}
          maxLength={7}
          spellCheck={false}
          error={HEX_RE.test(hex) ? undefined : 'Use o formato #RRGGBB.'}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setHex(v);
            if (HEX_RE.test(v)) setAppearance({ accent: v.toLowerCase() });
          }}
        />
      </Section>
      <Section title="Formas">
        <Slider
          label="Cantos arredondados"
          min={0}
          max={2}
          step={0.25}
          format={(v) => (v === 0 ? 'Retos' : `${Math.round(v * 100)}%`)}
          value={a.radiusScale}
          onChange={(v) => setAppearance({ radiusScale: v })}
        />
      </Section>
      <Section title="Texto">
        <Select
          label="Fonte"
          value={customFont ? '__custom' : a.fontFamily}
          options={fontOptions}
          onChange={(v) => {
            if (v === '__custom') {
              setCustomFont(true);
              return;
            }
            setCustomFont(false);
            setAppearance({ fontFamily: v });
          }}
        />
        {customFont && (
          <TextField
            label="Nome da fonte"
            hint="Qualquer fonte instalada no seu computador, pelo nome exato."
            value={fontDraft}
            maxLength={64}
            spellCheck={false}
            error={FONT_NAME_RE.test(fontDraft) ? undefined : 'Use apenas letras, números, espaço, ponto, hífen ou _.'}
            onChange={(e) => {
              const v = e.target.value;
              setFontDraft(v);
              if (FONT_NAME_RE.test(v)) setAppearance({ fontFamily: v.trim() });
            }}
          />
        )}
        {fontMissing && (
          <p className="small warning-text" role="status">
            A fonte “{a.fontFamily}” não foi encontrada neste computador; usando a fonte padrão.
          </p>
        )}
        <FontImporter
          current={a.fontFamily}
          onUse={(family) => {
            setCustomFont(false);
            setAppearance({ fontFamily: family });
          }}
          onRemoved={(family) => {
            if (a.fontFamily === family) setAppearance({ fontFamily: '' });
          }}
        />
        <Slider
          label="Tamanho da fonte"
          min={0.8}
          max={1.5}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          value={a.fontScale}
          onChange={(v) => setAppearance({ fontScale: v })}
        />
        <Switch
          label="Modo compacto"
          description="Mensagens e listas mais densas."
          checked={a.compact}
          onChange={(v) => setAppearance({ compact: v })}
        />
      </Section>
      <Section title="Movimento">
        <Select
          label="Reduzir animações"
          value={a.reducedMotion}
          options={REDUCED_MOTION_OPTIONS}
          onChange={(v) => setAppearance({ reducedMotion: v })}
        />
      </Section>
      <Section title="Restaurar">
        <Button
          variant="secondary"
          onClick={() => {
            setCustomFont(false);
            setFontDraft('');
            setAppearance(DEFAULT_APPEARANCE);
          }}
        >
          Restaurar aparência padrão
        </Button>
      </Section>
    </>
  );
}

/**
 * Importa arquivos de fonte do computador do usuário. Ficam só neste PC (IndexedDB) e nunca são enviados:
 * a preferência sincronizada guarda apenas o nome da família.
 */
function FontImporter({
  current,
  onUse,
  onRemoved,
}: {
  current: string;
  onUse: (family: string) => void;
  onRemoved: (family: string) => void;
}) {
  const families = useImportedFonts((st) => st.families);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[] | null>(null);
  const [family, setFamily] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await importFont(family, pending);
      setPending(null);
      onUse(family.trim());
      useUi.getState().toast('success', `Fonte “${family.trim()}” importada.`);
    } catch (e) {
      setError(e instanceof FontImportError ? e.message : 'Não foi possível importar a fonte.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="font-importer">
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={FONT_ACCEPT}
        aria-label="Arquivos de fonte"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!list.length) return;
          setPending(list);
          setFamily(familyFromFileName(list[0]!.name));
          setError(null);
        }}
      />
      {pending ? (
        <div className="font-import-form">
          <TextField
            label="Nome da fonte importada"
            hint={`${pending.length} arquivo(s): ${pending.map((f) => f.name).join(', ')}`}
            value={family}
            maxLength={64}
            spellCheck={false}
            error={error ?? undefined}
            onChange={(e) => setFamily(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <div className="font-import-actions">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !family.trim()}>
              {busy ? 'Importando…' : 'Importar e usar'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" icon="upload" onClick={() => input.current?.click()}>
          Importar fonte…
        </Button>
      )}
      <p className="muted small">
        WOFF2, WOFF, TTF ou OTF (até 5 MB cada). A fonte fica só neste computador e não é enviada a ninguém; você é
        responsável pela licença do arquivo.
      </p>
      {families.length > 0 && (
        <ul className="font-list" aria-label="Fontes importadas">
          {families.map((f) => (
            <li key={f}>
              <span className="truncate" style={{ fontFamily: `"${f}"` }}>
                {f}
              </span>
              {current === f ? (
                <span className="muted small">Em uso</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => onUse(f)}>
                  Usar
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remover ${f}`}
                onClick={() => void removeImportedFont(f).then(() => onRemoved(f))}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
