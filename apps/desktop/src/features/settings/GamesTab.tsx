/**
 * Configurações → Jogos (ADR-0021): mostrar o jogo que estou jogando e cadastrar jogos que o OpenCord não reconhece
 * sozinho (escolhendo um programa aberto).
 */
import type { UserSettings } from '@opencord/contracts';
import { Button, Icon, Select, Slider, Switch, TextField } from '@opencord/ui';
import { useEffect, useState } from 'react';
import { bridge } from '../../lib/bridge';
import { clipBitrate, useClips } from '../../store/clips';
import { useGames } from '../../store/games';
import { updateSettings } from '../../store/settings';
import { useElapsed } from '../shell/Playing';
import { Section } from './SettingsModal';

export function GamesTab({ settings }: { settings: UserSettings }) {
  const g = settings.games;
  const mine = useGames((s) => s.mine);
  const clipping = useClips((s) => s.active);
  const elapsed = useElapsed(mine?.startedAt);
  const set = (patch: Partial<UserSettings['games']>) =>
    updateSettings((s) => ({ ...s, games: { ...s.games, ...patch } }));
  return (
    <>
      <Section
        title="Jogo atual"
        description="O OpenCord reconhece jogos da Steam e os mais conhecidos fora dela. Só o nome do jogo e há quanto tempo você joga aparecem para os outros; ficar invisível também esconde."
      >
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
        <Section
          title="Clipes"
          description="Com um jogo aberto, o OpenCord guarda na memória os últimos segundos da tela principal e do som do computador (inclusive a chamada). O atalho salva um vídeo MP4 na pasta de clipes. Nada é enviado ao servidor."
        >
          <Switch
            label="Criar clipes"
            description={
              settings.keybinds.saveClip
                ? `Atalho: ${settings.keybinds.saveClip} (mude em Atalhos). Usa a placa de vídeo e memória enquanto o jogo está aberto.`
                : 'Sem atalho definido: escolha um em Atalhos.'
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
            label="Qualidade do clipe"
            hint="Mais alta deixa o arquivo maior."
            min={10}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            value={g.clipQuality}
            onChange={(v) => set({ clipQuality: v })}
          />
          <p className="small muted">
            Cerca de {estimateMb(g)} MB por clipe (e o mesmo de memória enquanto o jogo está aberto).
          </p>
          <ClipsFolder />
        </Section>
      )}
      {bridge && (
        <Section
          title="Jogos adicionados por você"
          description="Seu jogo não aparece? Abra o jogo, escolha o programa dele na lista e dê um nome."
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
