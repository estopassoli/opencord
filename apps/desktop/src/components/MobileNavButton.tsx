import { Icon } from '@opencord/ui';
import { useUi } from '../store/ui';

/** Botão de menu dos cabeçalhos: só aparece no layout de celular (CSS) e abre a gaveta de navegação. */
export function MobileNavButton() {
  const open = useUi((s) => s.panel === 'nav');
  return (
    <button
      className="icon-btn mobile-only mobile-nav-btn"
      aria-label="Abrir menu de servidores e canais"
      aria-expanded={open}
      aria-controls="mobile-nav"
      onClick={() => useUi.getState().setPanel(open ? 'none' : 'nav')}
    >
      <Icon name="menu" />
    </button>
  );
}
