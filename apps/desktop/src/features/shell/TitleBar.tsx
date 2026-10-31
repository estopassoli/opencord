import { Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import type { UpdateStatus, WindowControl } from '../../../electron/shared/ipc';
import { Tooltip } from '../../components/Tooltip';
import { ServerIcon } from '../../components/ServerIcon';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { UpdateDialog } from './UpdateDialog';

function useUpdateStatus(): UpdateStatus {
  const [s, setS] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    if (!bridge) return;
    void bridge.updates.status().then(setS, () => undefined);
    return bridge.on('update', setS);
  }, []);
  return s;
}

/** Botão de atualização (só no app desktop): baixando → pronta (Windows) ou disponível (abre o download). */
function UpdateButton() {
  const s = useUpdateStatus();
  // hooks antes do return: o estado muda de "idle" para "pronta" com o componente montado
  const [dialog, setDialog] = useState(false);
  if (s.state === 'idle') return null;
  const label =
    s.state === 'downloading'
      ? `Baixando atualização ${s.version}… ${s.progress}%`
      : s.state === 'ready'
        ? `Atualização pronta! Clique para reiniciar e atualizar para a versão ${s.version}`
        : `Atualização ${s.version} disponível. Clique para baixar`;
  const install = () => {
    if (!bridge || s.state === 'downloading') return;
    setDialog(true);
  };
  return (
    <>
      {dialog && s.state !== 'downloading' && <UpdateDialog status={s} onClose={() => setDialog(false)} />}
      <Tooltip label={label} side="bottom">
        <button
          className="titlebar-btn titlebar-update"
          data-state={s.state}
          aria-label={label}
          aria-disabled={s.state === 'downloading' || undefined}
          onClick={install}
        >
          <Icon name="download" size={16} />
        </button>
      </Tooltip>
    </>
  );
}

/**
 * Minimizar, maximizar/restaurar e fechar, desenhados pelo app (Windows/Linux; no macOS ficam os botões do sistema).
 * Substituem a sobreposição nativa (titleBarOverlay), que atrasava a apresentação de cada quadro da interface.
 */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    void bridge.windowState().then(
      (s) => setMaximized(s.maximized),
      () => undefined,
    );
    return bridge.on('window-state', (s) => setMaximized(s.maximized));
  }, []);
  if (!bridge || /Mac/i.test(navigator.userAgent)) return null;
  const act = (a: WindowControl) => void bridge?.windowControl(a);
  return (
    <div className="titlebar-window">
      <button className="titlebar-window-btn" aria-label="Minimizar" onClick={() => act('minimize')}>
        <Icon name="window-minimize" size={14} />
      </button>
      <button
        className="titlebar-window-btn"
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={() => act('toggle-maximize')}
      >
        <Icon name={maximized ? 'window-restore' : 'window-maximize'} size={12} />
      </button>
      <button className="titlebar-window-btn titlebar-window-close" aria-label="Fechar" onClick={() => act('close')}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** Barra de título integrada: voltar/avançar à esquerda, local atual ao centro, atualização e controles à direita. */
export function TitleBar() {
  const view = useUi((s) => s.view);
  const canBack = useUi((s) => s.back.length > 0);
  const canForward = useUi((s) => s.forward.length > 0);
  // seletor devolve só uma string (primitivo): objetos novos a cada chamada causariam loop no zustand v5
  const text = useData((s) => {
    if (view.kind === 'home') return view.tab === 'news' ? 'Novidades' : 'Amigos';
    if (view.kind === 'dm') {
      const c = s.conversations.find((x) => x.id === view.conversationId);
      const name =
        c?.name ??
        c?.members
          .filter((m) => m.id !== s.me?.id)
          .map((m) => s.settings?.friendNicknames[m.id] ?? m.displayName)
          .join(', ');
      return name || 'Mensagem direta';
    }
    return s.details[view.serverId]?.name ?? 'OpenCord';
  });
  const icon = view.kind === 'home' ? (view.tab === 'news' ? 'bell' : 'users') : view.kind === 'dm' ? 'chat' : 'server';
  // no servidor, a imagem dele (ou a marca do oficial / iniciais) no lugar do ícone genérico
  const server = useData((s) => (view.kind === 'server' ? s.servers.find((x) => x.id === view.serverId) : undefined));
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
        {server ? (
          <span className="titlebar-server" aria-hidden="true">
            <ServerIcon name={server.name} iconKey={server.iconKey} official={server.official} />
          </span>
        ) : (
          <Icon name={icon} size={14} />
        )}
        <span className="truncate">{text}</span>
      </div>
      <div className="titlebar-actions">
        <UpdateButton />
        <WindowControls />
      </div>
    </header>
  );
}
