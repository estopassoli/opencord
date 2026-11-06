import type { UserSettings } from '@opencord/contracts';
import { Button, Select, Slider, Switch } from '@opencord/ui';
import { playSound, SOUND_PACK_LABEL, SOUND_PACKS, type SoundPack } from '../../lib/sounds';
import { updateSettings } from '../../store/settings';
import { Section } from './Section';

export function NotificationsTab({ settings }: { settings: UserSettings }) {
  const n = settings.notifications;
  const set = (patch: Partial<UserSettings['notifications']>) =>
    updateSettings((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));
  return (
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
  );
}
