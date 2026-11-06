import { KEYWORDS_MAX, type UserSettings } from '@opencord/contracts';
import { Button, Icon, Select, Slider, Switch, TextField } from '@opencord/ui';
import { useState } from 'react';
import { fold, isMutedOverride, mutedLabel, unmute } from '../../lib/notifyPrefs';
import { openReminder, removeReminder } from '../../lib/reminders';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { playSound, SOUND_PACK_LABEL, SOUND_PACKS, type SoundPack } from '../../lib/sounds';
import { updateSettings } from '../../store/settings';
import { Section } from './Section';

export function NotificationsTab({ settings }: { settings: UserSettings }) {
  const n = settings.notifications;
  const set = (patch: Partial<UserSettings['notifications']>) =>
    updateSettings((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));
  return (
    <>
    <Section title="Notificações">
      <Switch label="Notificações na área de trabalho" checked={n.desktop} onChange={(v) => set({ desktop: v })} />
      <Switch
        label="Efeitos sonoros"
        description="Entrar e sair da voz, gente entrando e saindo, mutar, transmissão, conexão e mensagens."
        checked={n.sounds}
        onChange={(v) => set({ sounds: v })}
      />
      {n.sounds && (
        <>
          <Select<SoundPack>
            label="Conjunto de sons"
            value={(SOUND_PACKS as readonly string[]).includes(n.soundPack) ? (n.soundPack as SoundPack) : 'padrao'}
            onChange={(v) => {
              set({ soundPack: v });
              playSound('join', { force: true, pack: v });
            }}
            options={SOUND_PACKS.map((p) => ({ value: p, label: SOUND_PACK_LABEL[p] }))}
          />
          <div className="sound-volume">
            <Slider
              label="Volume dos efeitos"
              min={0}
              max={1}
              step={0.05}
              value={n.soundVolume}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => set({ soundVolume: v })}
            />
          </div>
          <div className="sound-previews" role="group" aria-label="Ouvir cada som">
            {(
              [
                ['join', 'Entrar'],
                ['leave', 'Sair'],
                ['peerJoin', 'Alguém entrou'],
                ['mute', 'Mutar'],
                ['message', 'Mensagem'],
                ['streamStart', 'Live'],
              ] as const
            ).map(([name, label]) => (
              <Button
                key={name}
                variant="secondary"
                size="sm"
                icon="play"
                onClick={() => playSound(name, { force: true })}
              >
                {label}
              </Button>
            ))}
          </div>
        </>
      )}
      <Switch
        label="Não perturbe"
        description="Silencia notificações e sons."
        checked={n.dnd}
        onChange={(v) => set({ dnd: v })}
      />
    </Section>
      <KeywordsSection keywords={n.keywords} onChange={(keywords) => set({ keywords })} />
      <MutedSection settings={settings} />
      <RemindersSection settings={settings} />
    </>
  );
}

function KeywordsSection({ keywords, onChange }: { keywords: string[]; onChange: (k: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const w = draft.trim().replace(/\s+/g, ' ');
    if (w.length < 2) return;
    if (keywords.some((k) => fold(k) === fold(w))) {
      setDraft('');
      return;
    }
    if (keywords.length >= KEYWORDS_MAX) {
      useUi.getState().toast('error', `Até ${KEYWORDS_MAX} palavras-chave.`);
      return;
    }
    onChange([...keywords, w.slice(0, 40)]);
    setDraft('');
  };
  return (
    <Section
      title="Palavras-chave"
      description="Quando alguém escrever uma delas (palavra inteira, sem ligar para acento ou maiúscula) num canal que você vê, você é avisado como numa menção. Canais silenciados ficam de fora."
    >
      <div className="keyword-add">
        <TextField
          label="Nova palavra-chave"
          value={draft}
          maxLength={40}
          placeholder="Ex.: raid, seu apelido, reunião"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" icon="plus" onClick={add} disabled={draft.trim().length < 2}>
          Adicionar
        </Button>
      </div>
      {keywords.length > 0 && (
        <ul className="keyword-list" aria-label="Palavras-chave">
          {keywords.map((k) => (
            <li key={k} className="keyword-chip">
              {k}
              <button
                className="icon-btn"
                aria-label={`Tirar ${k}`}
                onClick={() => onChange(keywords.filter((x) => x !== k))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function MutedSection({ settings }: { settings: UserSettings }) {
  const details = useData((s) => s.details);
  const servers = useData((s) => s.servers);
  const n = settings.notifications;
  const rows = [
    ...Object.entries(n.servers)
      .filter(([, o]) => isMutedOverride(o))
      .map(([id, o]) => ({
        scope: 'servers' as const,
        id,
        name: servers.find((x) => x.id === id)?.name ?? details[id]?.name ?? 'Servidor',
        label: mutedLabel(o),
      })),
    ...Object.entries(n.channels)
      .filter(([, o]) => isMutedOverride(o))
      .map(([id, o]) => {
        const d = Object.values(details).find((x) => x.channels.some((c) => c.id === id));
        const c = d?.channels.find((x) => x.id === id);
        return { scope: 'channels' as const, id, name: c ? `#${c.name} · ${d!.name}` : 'Canal', label: mutedLabel(o) };
      }),
  ];
  return (
    <Section
      title="Silenciados"
      description="Silencie um servidor ou canal pelo clique direito nele. Silenciado, ele não avisa nem fica em destaque; menções diretas ainda aparecem no contador."
    >
      {rows.length === 0 ? (
        <p className="muted small">Nada silenciado.</p>
      ) : (
        <ul className="settings-rows">
          {rows.map((r) => (
            <li key={`${r.scope}:${r.id}`} className="settings-row">
              <Icon name="bell-off" size={16} />
              <span className="settings-row-main truncate">
                {r.name}
                <span className="muted small"> · {r.label}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => unmute(r.scope, r.id)}>
                Reativar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RemindersSection({ settings }: { settings: UserSettings }) {
  const list = settings.reminders;
  const fmt = (at: number) =>
    new Date(at).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <Section
      title="Lembretes"
      description="Clique direito numa mensagem → Lembrar-me. Na hora, você recebe uma notificação com o atalho para ela."
    >
      {list.length === 0 ? (
        <p className="muted small">Nenhum lembrete marcado.</p>
      ) : (
        <ul className="settings-rows">
          {list.map((r) => (
            <li key={r.id} className="settings-row">
              <Icon name="clock" size={16} />
              <span className="settings-row-main">
                <span className="small">
                  {fmt(r.at)}
                  {r.author ? ` · ${r.author}` : ''}
                </span>
                <span className="muted small truncate">{r.excerpt || '[anexo]'}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  useUi.getState().openModal(null);
                  openReminder(r);
                }}
              >
                Abrir
              </Button>
              <button className="icon-btn" aria-label="Apagar lembrete" onClick={() => removeReminder(r.id)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
