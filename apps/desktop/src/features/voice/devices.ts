import type { MenuEntry } from '../../components/ContextMenu';
import { updateSettings } from '../../store/settings';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';

/** Nome do dispositivo sem o id USB de fabricante:produto que o Chromium acrescenta, ex.: " (046d:0b0b)". */
export function deviceLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}

/** Menu de dispositivos (seta ao lado do microfone/áudio): lista entradas ou saídas e grava a escolha nas configurações. */
export async function deviceMenu(kind: 'audioinput' | 'audiooutput'): Promise<MenuEntry[]> {
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === kind && d.deviceId !== 'default',
    );
  } catch {
    devices = [];
  }
  const settings = useData.getState().settings;
  const current = kind === 'audioinput' ? settings?.audio.inputDeviceId : settings?.audio.outputDeviceId;
  const pick = (id: string | null) =>
    updateSettings((s) => ({
      ...s,
      audio: { ...s.audio, ...(kind === 'audioinput' ? { inputDeviceId: id } : { outputDeviceId: id }) },
    }));
  const items: MenuEntry[] = [
    { label: `${current === null ? '✓ ' : ''}Padrão do sistema`, onSelect: () => pick(null) },
    ...devices.map((d, i) => ({
      label: `${current === d.deviceId ? '✓ ' : ''}${deviceLabel(d.label) || `${kind === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}`}`,
      onSelect: () => pick(d.deviceId),
    })),
    'separator',
    {
      label: 'Configurações de voz',
      icon: 'settings',
      onSelect: () => useUi.getState().openModal({ kind: 'settings', tab: 'voice' }),
    },
  ];
  return items;
}
