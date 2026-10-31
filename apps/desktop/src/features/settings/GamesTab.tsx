/**
 * Configurações → Jogos (ADR-0021): mostrar o jogo que estou jogando e cadastrar jogos que o OpenCord não reconhece
 * sozinho (escolhendo um programa aberto).
 */
import type { UserSettings } from '@opencord/contracts';
import { Button, Icon, Select, Switch, TextField } from '@opencord/ui';
import { useState } from 'react';
import { bridge } from '../../lib/bridge';
import { useGames } from '../../store/games';
import { updateSettings } from '../../store/settings';
import { useElapsed } from '../shell/Playing';
import { Section } from './SettingsModal';

export function GamesTab({ settings }: { settings: UserSettings }) {
  const g = settings.games;
  const mine = useGames((s) => s.mine);
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
