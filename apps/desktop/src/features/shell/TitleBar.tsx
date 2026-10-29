import { Icon } from '@opencord/ui';
import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../electron/shared/ipc';
import { Tooltip } from '../../components/Tooltip';
import { bridge } from '../../lib/bridge';
import { useData } from '../../store/data';
import { useUi } from '../../store/ui';
import { useVoice } from '../../store/voice';

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
  if (s.state === 'idle') return null;
  const label =
    s.state === 'downloading'
      ? `Baixando atualização ${s.version}… ${s.progress}%`
      : s.state === 'ready'
        ? `Atualização pronta! Clique para instalar a versão ${s.version}`
        : `Atualização ${s.version} disponível. Clique para baixar`;
  const install = () => {
    if (!bridge || s.state === 'downloading') return;
    const inCall = useVoice.getState().machine.status !== 'disconnected';
    if (s.state === 'ready' && inCall && !confirm('Instalar agora fecha o OpenCord e encerra a chamada. Continuar?'))
      return;
    void bridge.updates.install();
  };
  return (
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
  );
}

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
      <div className="titlebar-actions">
        <UpdateButton />
      </div>
    </header>
  );
}
