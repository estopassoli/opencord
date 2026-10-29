/**
 * Estados do Go Live (SDD §5): idle → selecting → starting → live → stopping → idle | error.
 * Regra: nunca mostrar `live` antes de o publisher confirmar a publicação na SFU.
 */
export type StreamStatus = 'idle' | 'selecting' | 'starting' | 'live' | 'stopping' | 'error';

export interface StreamState {
  status: StreamStatus;
  sourceId: string | null;
  sourceKind: 'screen' | 'window' | null;
  withAudio: boolean;
  /** true quando o áudio do sistema foi pedido mas não pôde ser capturado. */
  audioUnavailable: boolean;
  error: string | null;
}

export type StreamEvent =
  | { type: 'OPEN_PICKER' }
  | { type: 'CANCEL' }
  | { type: 'START'; sourceId: string; sourceKind: 'screen' | 'window'; withAudio: boolean }
  | { type: 'PUBLISHED'; audioPublished: boolean }
  | { type: 'STOP' }
  | { type: 'STOPPED' }
  | { type: 'SOURCE_ENDED' }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

export const initialStreamState: StreamState = {
  status: 'idle',
  sourceId: null,
  sourceKind: null,
  withAudio: false,
  audioUnavailable: false,
  error: null,
};

export function streamReducer(s: StreamState, e: StreamEvent): StreamState {
  switch (e.type) {
    case 'OPEN_PICKER':
      return s.status === 'idle' || s.status === 'error' ? { ...initialStreamState, status: 'selecting' } : s;
    case 'CANCEL':
      return s.status === 'selecting' ? initialStreamState : s;
    case 'START':
      if (s.status !== 'selecting') return s;
      return {
        ...s,
        status: 'starting',
        sourceId: e.sourceId,
        sourceKind: e.sourceKind,
        withAudio: e.withAudio,
        error: null,
      };
    case 'PUBLISHED':
      if (s.status !== 'starting') return s;
      return { ...s, status: 'live', audioUnavailable: s.withAudio && !e.audioPublished };
    case 'STOP':
      return s.status === 'live' || s.status === 'starting' ? { ...s, status: 'stopping' } : s;
    case 'SOURCE_ENDED':
      // fonte fechada (janela/monitor removido): encerrar imediatamente
      return s.status === 'live' || s.status === 'starting'
        ? { ...s, status: 'stopping', error: 'a fonte de captura foi encerrada' }
        : s;
    case 'STOPPED':
      return s.status === 'stopping' ? { ...initialStreamState, error: s.error } : s;
    case 'ERROR':
      return { ...initialStreamState, status: 'error', error: e.error };
    case 'RESET':
      return initialStreamState;
    default:
      return s;
  }
}
