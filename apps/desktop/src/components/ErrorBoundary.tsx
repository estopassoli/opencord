import { Button } from '@opencord/ui';
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="fatal" role="alert">
            <h1>Algo deu errado</h1>
            <p>{this.state.error.message}</p>
            <Button onClick={() => location.reload()}>Recarregar</Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
