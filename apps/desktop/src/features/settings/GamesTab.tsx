/**
 * Configurações → Jogos (ADR-0021): mostrar o jogo que estou jogando e cadastrar jogos que o OpenCord não reconhece
 * sozinho (escolhendo um programa aberto).
 */
import type { UserSettings } from '@opencord/contracts';
import { Button, Icon, Select, Slider, Switch, TextField } from '@opencord/ui';
import { useEffect, useState } from 'react';
import type { WinAudioOutput } from '../../../electron/shared/ipc';
import { bridge } from '../../lib/bridge';
import { clipBitrate, useClips } from '../../store/clips';
import { useGames } from '../../store/games';
import { updateSettings } from '../../store/settings';
import { useElapsed } from '../shell/Playing';
import { useOverlayPrefs } from '../../lib/overlay';
import { Section } from './SettingsModal';

export function GamesTab({ settings }: { settings: UserSettings }) {
  const g = settings.games;
  const mine = useGames((s) => s.mine);
  const clipping = useClips((s) => s.active);
  const elapsed = useElapsed(mine?.startedAt);
  const set = (patch: Partial<UserSettings['games']>) =>
    updateSettings((s) => ({ ...s, games: { ...s.games, ...patch } }));
  const overlay = useOverlayPrefs();
  return (
    <>
      {bridge && (
        <Section title="Overlay no jogo">
          <Switch
            label="Quem está falando, por cima do jogo"
            description="Não aparece em tela cheia exclusiva."
            checked={overlay.enabled}
            onChange={(v) => overlay.set({ enabled: v })}
          />
          {overlay.enabled && (
            <Select
              label="Canto"
              value={overlay.corner}
              onChange={(v) => overlay.set({ corner: v })}
              options={[
                { value: 'tl', label: 'Superior esquerdo' },
                { value: 'tr', label: 'Superior direito' },
                { value: 'bl', label: 'Inferior esquerdo' },
                { value: 'br', label: 'Inferior direito' },
              ]}
            />
          )}
        </Section>
      )}
      <Section title="Jogo atual">
        <Switch
          label="Mostrar o jogo que estou jogando"
          checked={g.showPlaying}
          onChange={(v) => set({ showPlaying: v })}
        />
        <p className="games-now small">
          <Icon name="gamepad" size={16} />
          {!bridge
            ? 'A detecção de jogos funciona no app para Windows.'
            : mine
              ? `Jogando agora: ${mine.name} (${elapsed})`
              : 'Nenhum jogo aberto agora.'}
        </p>
      </Section>
      {bridge && (
        <Section title="Clipes">
          <Switch
            label={settings.keybinds.saveClip ? `Salvar clipe com ${settings.keybinds.saveClip}` : 'Salvar clipes'}
            description={
              settings.keybinds.saveClip
                ? 'Os últimos segundos do jogo, com o som, na pasta de clipes.'
                : 'Escolha um atalho em Atalhos.'
            }
            checked={g.clips}
            onChange={(v) => set({ clips: v })}
          />
          {g.clips && mine && (
            <p className="games-now small">
              <Icon name="record" size={16} />
              {clipping ? `Guardando os últimos ${g.clipSeconds} s agora.` : 'Preparando a captura…'}
            </p>
          )}
          <div className="games-clip-grid">
            <Select
              label="Duração do clipe"
              value={String(g.clipSeconds)}
              options={[
                { value: '15', label: '15 segundos' },
                { value: '30', label: '30 segundos' },
                { value: '60', label: '1 minuto' },
                { value: '120', label: '2 minutos' },
              ]}
              onChange={(v) => set({ clipSeconds: Number(v) as UserSettings['games']['clipSeconds'] })}
            />
            <Select
              label="Quadros por segundo"
              value={String(g.clipFps)}
              options={[
                { value: '60', label: '60 fps' },
                { value: '30', label: '30 fps' },
              ]}
              onChange={(v) => set({ clipFps: Number(v) as UserSettings['games']['clipFps'] })}
            />
            <Select
              label="Resolução"
              value={g.clipResolution}
              options={[
                { value: 'source', label: 'A da tela' },
                { value: '1080p', label: '1080p' },
                { value: '720p', label: '720p' },
              ]}
              onChange={(v) => set({ clipResolution: v })}
            />
          </div>
          <Slider
            label="Qualidade"
            hint={`Cerca de ${estimateMb(g)} MB por clipe.`}
            min={10}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            value={g.clipQuality}
            onChange={(v) => set({ clipQuality: v })}
          />
          <ClipOutputs off={g.clipOutputsOff ?? []} onChange={(clipOutputsOff) => set({ clipOutputsOff })} />
          <ClipsFolder />
        </Section>
      )}
      {bridge && (
        <Section
          title="Jogos adicionados por você"
          description="Seu jogo não aparece? Abra-o e escolha o programa na lista."
        >
          <AddCustomGame custom={g.custom} onAdd={(c) => set({ custom: [...g.custom, c] })} />
          {g.custom.length > 0 && (
            <ul className="games-custom" aria-label="Jogos adicionados por você">
              {g.custom.map((c) => (
                <li key={c.exe}>
                  <Icon name="gamepad" size={16} />
                  <span className="truncate">
                    <strong>{c.name}</strong> <span className="muted small">{c.exe}</span>
                  </span>
                  <button
                    className="icon-btn"
                    aria-label={`Remover ${c.name}`}
                    data-tip="Remover"
                    onClick={() => set({ custom: g.custom.filter((x) => x.exe !== c.exe) })}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}

function AddCustomGame({
  custom,
  onAdd,
}: {
  custom: UserSettings['games']['custom'];
  onAdd: (c: { exe: string; name: string }) => void;
}) {
  const [list, setList] = useState<string[] | null>(null);
  const [exe, setExe] = useState('');
  const [name, setName] = useState('');
  const load = async () => {
    const all = (await bridge?.games.processes()) ?? [];
    const taken = new Set(custom.map((c) => c.exe.toLowerCase()));
    setList(all.filter((e) => !taken.has(e)));
  };
  if (!list)
    return (
      <Button variant="secondary" icon="plus" onClick={() => void load()}>
        Adicionar um jogo
      </Button>
    );
  return (
    <form
      className="games-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!exe || !name.trim()) return;
        onAdd({ exe, name: name.trim() });
        setList(null);
        setExe('');
        setName('');
      }}
    >
      <Select
        label="Programa aberto"
        value={exe || null}
        placeholder={list.length ? 'Escolha o programa do jogo' : 'Nenhum programa encontrado'}
        options={list.map((e) => ({ value: e, label: e }))}
        onChange={(v) => {
          setExe(v);
          if (!name) setName(v.replace(/\.exe$/i, ''));
        }}
      />
      <TextField label="Nome do jogo" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      <div className="games-add-actions">
        <Button type="button" variant="ghost" onClick={() => void load()} icon="refresh">
          Atualizar lista
        </Button>
        <Button type="button" variant="ghost" onClick={() => setList(null)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!exe || !name.trim()}>
          Adicionar
        </Button>
      </div>
    </form>
  );
}

const RES = { source: [2560, 1440], '1080p': [1920, 1080], '720p': [1280, 720] } as const;
/** tamanho aproximado de um clipe com estas opções (a tela de origem conta como 1440p) */
function estimateMb(g: UserSettings['games']) {
  const [w, h] = RES[g.clipResolution];
  return Math.round((clipBitrate(w, h, g.clipFps, g.clipQuality) * g.clipSeconds) / 8 / 1024 / 1024);
}

/** Pasta onde os clipes são gravados (fica neste computador). */
function ClipsFolder() {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    void bridge?.clips.dir().then(setDir);
  }, []);
  return (
    <div className="games-folder">
      <TextField label="Pasta dos clipes" value={dir ?? ''} readOnly />
      <Button
        variant="secondary"
        icon="folder"
        onClick={() =>
          void bridge?.clips.chooseDir().then((d) => {
            setDir(d);
            void useClips.getState().loadLibrary();
          })
        }
      >
        Trocar pasta
      </Button>
    </div>
  );
}

/**
 * Saídas de áudio do Windows gravadas nos clipes (ADR-0024): fones com duas saídas ("Game" e "Chat") entram as
 * duas. O microfone, as vozes da chamada e os efeitos entram sempre, cada um na sua trilha.
 */
function ClipOutputs({ off, onChange }: { off: string[]; onChange: (off: string[]) => void }) {
  const [list, setList] = useState<WinAudioOutput[] | null>(null);
  useEffect(() => {
    void bridge?.winAudio
      .list()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  if (!list?.length) return null;
  return (
    <fieldset className="games-outputs">
      <legend className="small">Som gravado</legend>
      <p className="small muted">Cada saída ligada vira uma trilha separada no clipe.</p>
      {list.map((d) => (
        <Switch
          key={d.id}
          label={d.name}
          description={
            d.default ? 'Saída padrão do Windows' : d.comm ? 'Dispositivo de comunicação do Windows' : undefined
          }
          checked={!off.includes(d.name)}
          onChange={(v) => onChange(v ? off.filter((n) => n !== d.name) : [...off, d.name])}
        />
      ))}
    </fieldset>
  );
}
