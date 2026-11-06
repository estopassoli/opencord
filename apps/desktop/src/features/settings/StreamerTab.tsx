import type { UserSettings } from '@opencord/contracts';
import { RadioGroup, Switch } from '@opencord/ui';
import { useStreamer } from '../../lib/streamer';
import { updateSettings } from '../../store/settings';
import { Section } from './Section';

export function StreamerTab({ settings }: { settings: UserSettings }) {
  const st = settings.streamer;
  const active = useStreamer((s) => s.active);
  const streamApp = useStreamer((s) => s.streamApp);
  const set = (patch: Partial<UserSettings['streamer']>) =>
    updateSettings((s) => ({ ...s, streamer: { ...s.streamer, ...patch } }));
  return (
    <>
      <Section
        title="Modo streamer"
        description={
          active
            ? 'Ligado agora: o que você marcou abaixo está escondido.'
            : 'Desligado agora. Ele esconde o que não pode aparecer na sua live.'
        }
      >
        <RadioGroup
          label="Quando ligar"
          value={st.mode}
          onChange={(v) => set({ mode: v })}
          options={[
            {
              value: 'auto',
              label: 'Automático',
              description: streamApp
                ? 'Com Go Live ou com um programa de transmissão aberto (aberto agora).'
                : 'Com Go Live ou com OBS, Streamlabs, XSplit ou Twitch Studio aberto.',
            },
            { value: 'on', label: 'Sempre ligado' },
            { value: 'off', label: 'Desligado' },
          ]}
        />
      </Section>
      <Section title="O que esconder">
        <Switch
          label="Meu e-mail"
          description="Na sua conta e nas telas de segurança."
          checked={st.hideEmail}
          onChange={(v) => set({ hideEmail: v })}
        />
        <Switch
          label="Links de convite"
          description="O link aparece mascarado; o botão de copiar continua funcionando."
          checked={st.hideInvites}
          onChange={(v) => set({ hideInvites: v })}
        />
        <Switch
          label="Texto das notificações"
          description="A notificação diz quem mandou, mas não o que foi escrito."
          checked={st.hideNotificationContent}
          onChange={(v) => set({ hideNotificationContent: v })}
        />
        <Switch
          label="Sons de notificação"
          description="Desliga o som de mensagens e lembretes (os sons da chamada continuam)."
          checked={st.muteSounds}
          onChange={(v) => set({ muteSounds: v })}
        />
      </Section>
    </>
  );
}
