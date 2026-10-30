import type { MenuEntry } from '../../components/ContextMenu';
import { useScenes } from '../../store/scenes';

/** Menu de cenas do Go Live: sem cena, as cenas salvas e "Editar cenas…". */
export function sceneMenu(onEdit: () => void): MenuEntry[] {
  const { scenes, activeId, setActive } = useScenes.getState();
  return [
    {
      label: 'Sem cena',
      hint: 'só a tela escolhida, como sempre',
      checked: activeId === null,
      onSelect: () => setActive(null),
    },
    ...scenes.map((s): MenuEntry => ({
      label: s.name,
      checked: s.id === activeId,
      onSelect: () => setActive(s.id),
    })),
    'separator',
    { label: 'Editar cenas…', icon: 'edit', onSelect: onEdit },
  ];
}
