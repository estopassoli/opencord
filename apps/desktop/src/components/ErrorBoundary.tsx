import { Button, Icon } from '@opencord/ui';
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import type { UpdateStatus } from '../../electron/shared/ipc';
import { bridge } from '../lib/bridge';

/** Erro do React minificado ("Minified React error #310") em português, com o número para o suporte. */
const REACT_ERRORS: Record<string, string> = {
  '300': 'Uma parte da tela mudou a ordem interna de estado.',
  '310': 'Uma parte da tela mudou a ordem interna de estado.',
  '185': 'Uma parte da tela entrou num ciclo de atualizações.',
  '31': 'Uma parte da tela recebeu um dado em formato inesperado.',
};
export function describeCrash(e: Error): string {
  const n = /Minified React error #(\d+)/.exec(e.message)?.[1];
  if (n) return `${REACT_ERRORS[n] ?? 'Erro interno da interface.'} (React #${n})`;
  return e.message || 'Erro desconhecido.';
}

/** Registra no crash-log.txt do app (sem conteúdo do usuário). */
export function reportError(where: 'boundary' | 'window' | 'promise', e: unknown, componentStack?: string | null) {
  const err = e instanceof Error ? e : new Error(String(e));
  void bridge
    ?.reportError({
      where,
      message: err.message.slice(0, 2000),
      ...(err.stack ? { stack: err.stack.slice(0, 8000) } : {}),
      ...(componentStack ? { componentStack: componentStack.slice(0, 8000) } : {}),
    })
    .catch(() => undefined);
}

interface Props {
  children: ReactNode;
  /** área protegida: em vez da tela inteira, só ela mostra o aviso (o resto do app continua) */
  area?: string;
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: Error | null; details: string }> {
  override state = { error: null as Error | null, details: '' };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    reportError('boundary', error, info.componentStack);
    this.setState({ details: `${error.message}\n${error.stack ?? ''}\n${info.componentStack ?? ''}` });
  }
  override render() {
    const { error, details } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    if (this.props.area)
      return (
        <div className="area-error" role="alert">
          <Icon name="warning" size={18} />
          <span>
            Não deu para mostrar {this.props.area}. <span className="muted small">{describeCrash(error)}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null, details: '' })}>
            Tentar de novo
          </Button>
        </div>
      );
    return <Fatal error={error} details={details} />;
  }
}

/** Tela de erro geral: recarregar, atualizar direto do servidor (sem baixar instalador) e copiar os detalhes. */
function Fatal({ error, details }: { error: Error; details: string }) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    void bridge.updates.status().then(setUpdate, () => undefined);
    return bridge.on('update', setUpdate);
  }, []);
  const check = async () => {
    if (!bridge) return;
    setChecking(true);
    try {
      setUpdate(await bridge.updates.check());
    } finally {
      setChecking(false);
    }
  };
  const ready = update?.state === 'ready' || update?.state === 'available';
  return (
    <div className="fatal" role="alert">
      <h1>Algo deu errado</h1>
      <p>{describeCrash(error)}</p>
      {bridge && (
        <p className="muted small">
          {update?.state === 'downloading'
            ? `Baixando a versão ${update.version}… ${update.progress}%`
            : ready
              ? `A versão ${update.version} está pronta e pode corrigir isto.`
              : update && !checking
                ? 'Procure uma versão nova: as correções chegam por atualização.'
                : ''}
        </p>
      )}
      <div className="fatal-actions">
        <Button variant="secondary" onClick={() => location.reload()}>
          Recarregar
        </Button>
        {bridge &&
          (ready ? (
            <Button icon="download" onClick={() => void bridge?.updates.install()}>
              Atualizar agora
            </Button>
          ) : (
            <Button icon="download" disabled={checking || update?.state === 'downloading'} onClick={() => void check()}>
              {checking ? 'Procurando…' : update?.state === 'downloading' ? 'Baixando…' : 'Procurar atualização'}
            </Button>
          ))}
        <Button
          variant="ghost"
          icon="copy"
          onClick={() =>
            void navigator.clipboard
              .writeText(details || `${error.message}\n${error.stack ?? ''}`)
              .then(() => setCopied(true))
          }
        >
          {copied ? 'Copiado' : 'Copiar detalhes'}
        </Button>
      </div>
    </div>
  );
}
