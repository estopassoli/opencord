import { Icon } from '@opencord/ui';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';

/**
 * Barra de título integrada (janela com titleBarOverlay): voltar/avançar à esquerda, local atual ao centro.
 * Os controles da janela (minimizar/maximizar/fechar) são nativos do Windows, desenhados à direita pelo Electron.
 */
export function TitleBar() {
  const view = useUi((s) => s.view);
  const canBack = useUi((s) => s.back.length > 0);
  const canForward = useUi((s) => s.forward.length > 0);
  // seletor devolve só uma string (primitivo): objetos novos a cada chamada causariam loop no zustand v5
  const text = useData((s) => {
    if (view.kind === 'home') return 'Amigos';
    if (view.kind === 'dm') {
      const c = s.conversations.find((x) => x.id === view.conversationId);
      const name =
        c?.name ??
        c?.members
          .filter((m) => m.id !== s.me?.id)
          .map((m) => m.displayName)
          .join(', ');
      return name || 'Mensagem direta';
    }
    return s.details[view.serverId]?.name ?? 'OpenCord';
  });
  const icon = view.kind === 'home' ? 'users' : view.kind === 'dm' ? 'chat' : 'server';
  return (
    <header className="titlebar">
      <div className="titlebar-nav">
        <button
          className="titlebar-btn"
          aria-label="Voltar"
          disabled={!canBack}
          onClick={() => useUi.getState().goBack()}
        >
          <Icon name="chevron-right" size={16} className="flip" />
        </button>
        <button
          className="titlebar-btn"
          aria-label="Avançar"
          disabled={!canForward}
          onClick={() => useUi.getState().goForward()}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      <div className="titlebar-title">
        <Icon name={icon} size={14} />
        <span className="truncate">{text}</span>
      </div>
    </header>
  );
}
