import type { UserSettings } from '@opencord/contracts';
import { Button } from '@opencord/ui';
import { useId, useState, type KeyboardEvent } from 'react';
import { acceleratorKey, formatAccelerator, formatCode, MODIFIER_CODES, needsModifier } from '../../lib/keys';
import { updateSettings } from '../../store/settings';
import { Section } from './Section';

// ---------------------------------------------------------------------------
// Atalhos
// ---------------------------------------------------------------------------

function KeyCapture({
  label,
  value,
  mode,
  onChange,
}: {
  label: string;
  value: string | null;
  mode: 'code' | 'accelerator';
  onChange: (v: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const errorId = useId();

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (e.key === 'Tab') {
      setRecording(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      setRecording(false);
      return;
    }
    if (mode === 'code') {
      if (!e.code) return;
      onChange(e.code);
      setError(null);
      setRecording(false);
      return;
    }
    if (MODIFIER_CODES.has(e.code)) return; // aguarda a tecla principal
    const key = acceleratorKey(e.code);
    if (!key) {
      setError('Esta tecla não serve para atalho global. Tente outra.');
      return;
    }
    const mods: string[] = [];
    if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (mods.length === 0 && needsModifier(e.code)) {
      setError(
        'Letras, números e pontuação precisam de Ctrl, Alt ou Shift. Teclas como Insert, End ou F8 valem sozinhas.',
      );
      return;
    }
    onChange([...mods, key].join('+'));
    setError(null);
    setRecording(false);
  };

  const shown = value ? (mode === 'code' ? formatCode(value) : formatAccelerator(value)) : 'Nenhum';

  return (
    <div className="keybind">
      <span className="keybind-label" id={labelId}>
        {label}
      </span>
      <div className="keybind-controls">
        <button
          type="button"
          className="keybind-capture"
          data-recording={recording ? 'true' : undefined}
          aria-labelledby={labelId}
          aria-describedby={error ? errorId : undefined}
          aria-pressed={recording}
          onClick={() => {
            setError(null);
            setRecording((r) => !r);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          <kbd>{recording ? 'Pressione uma tecla… (Esc cancela)' : shown}</kbd>
        </button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!value}
          onClick={() => onChange(null)}
          aria-label={`Limpar atalho: ${label}`}
        >
          Limpar
        </Button>
      </div>
      {error && (
        <p className="form-error small" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function setKeybind(patch: Partial<UserSettings['keybinds']>) {
  updateSettings((s) => ({ ...s, keybinds: { ...s.keybinds, ...patch } }));
}

export function KeybindsTab({ settings }: { settings: UserSettings }) {
  const { keybinds, audio } = settings;
  return (
    <>
      <Section
        title="Pressionar para falar"
        description={
          <>
            Com a janela em foco, segure a tecla para falar. Fora do aplicativo o atalho global funciona como
            alternância (pressione para abrir o microfone e pressione de novo para fechar), porque atalhos globais não
            informam quando a tecla é solta.
          </>
        }
      >
        <KeyCapture
          label="Tecla de pressionar para falar"
          mode="code"
          value={keybinds.pushToTalk}
          onChange={(v) => setKeybind({ pushToTalk: v })}
        />
        {audio.inputMode !== 'ptt' && (
          <p className="muted small">Ative “Pressionar para falar” em Voz e vídeo para usar este atalho.</p>
        )}
      </Section>
      <Section title="Atalhos globais" description="Funcionam mesmo com o aplicativo em segundo plano.">
        <KeyCapture
          label="Silenciar / ativar microfone"
          mode="accelerator"
          value={keybinds.toggleMute}
          onChange={(v) => setKeybind({ toggleMute: v })}
        />
        <KeyCapture
          label="Ensurdecer / ativar áudio"
          mode="accelerator"
          value={keybinds.toggleDeafen}
          onChange={(v) => setKeybind({ toggleDeafen: v })}
        />
        <KeyCapture
          label="Salvar clipe (últimos 60 s do jogo)"
          mode="accelerator"
          value={keybinds.saveClip}
          onChange={(v) => setKeybind({ saveClip: v })}
        />
        <KeyCapture
          label="Parar os efeitos sonoros tocando"
          mode="accelerator"
          value={keybinds.stopSounds}
          onChange={(v) => setKeybind({ stopSounds: v })}
        />
        <KeyCapture
          label="Silenciar / ativar efeitos sonoros"
          mode="accelerator"
          value={keybinds.toggleSoundsMuted}
          onChange={(v) => setKeybind({ toggleSoundsMuted: v })}
        />
      </Section>
    </>
  );
}
