/** Itens de menu "Silenciar" e "Notificações" para um servidor ou canal (clique direito no rail e na lista). */
import type { MenuEntry } from '../../components/ContextMenu';
import {
  isMutedOverride,
  mute,
  mutedLabel,
  MUTE_DURATIONS,
  serverDefaultOf,
  setLevel,
  unmute,
  type NotifyLevel,
} from '../../lib/notifyPrefs';
import { useData } from '../../store/data';

const LEVELS: { level: NotifyLevel; label: string }[] = [
  { level: 'all', label: 'Todas as mensagens' },
  { level: 'mentions', label: 'Só @menções' },
  { level: 'none', label: 'Nada' },
];

export function notifyMenuItems(scope: 'servers' | 'channels', id: string, serverId: string): MenuEntry[] {
  const n = useData.getState().settings?.notifications;
  const o = n?.[scope][id];
  const what = scope === 'servers' ? 'servidor' : 'canal';
  const muted = isMutedOverride(o);
  const inherited =
    scope === 'channels'
      ? 'Igual ao servidor'
      : `Padrão do servidor (${serverDefaultOf(serverId) === 'all' ? 'todas' : 'só menções'})`;
  return [
    muted
      ? {
          label: `Reativar ${what}`,
          icon: 'bell',
          hint: mutedLabel(o) ?? undefined,
          onSelect: () => unmute(scope, id),
        }
      : {
          kind: 'submenu',
          label: `Silenciar ${what}`,
          icon: 'bell-off',
          items: MUTE_DURATIONS.map((d) => ({ label: d.label, onSelect: () => mute(scope, id, d.ms) })),
        },
    {
      kind: 'submenu',
      label: 'Notificações',
      icon: 'bell',
      items: [
        { label: inherited, checked: o?.level == null, onSelect: () => setLevel(scope, id, null) },
        'separator',
        ...LEVELS.map((l) => ({
          label: l.label,
          checked: o?.level === l.level,
          onSelect: () => setLevel(scope, id, l.level),
        })),
      ],
    },
  ];
}
