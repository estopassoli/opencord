/**
 * Máquina de estados da conexão de voz (SDD §5):
 * disconnected → authorizing → connecting → connected → reconnecting → connected | disconnected | failed.
 * Transições inválidas são ignoradas (o estado não muda), o que torna eventos duplicados/fora de ordem inofensivos.
 */
export type VoiceStatus = 'disconnected' | 'authorizing' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface VoiceState {
  status: VoiceStatus;
  channelId: string | null;
  error: string | null;
  /** Tentativas de reconexão consecutivas. */
  attempts: number;
  /** Incrementa a cada nova tentativa de entrada; respostas assíncronas antigas são descartadas. */
  generation: number;
}

export type VoiceEvent =
  | { type: 'JOIN'; channelId: string }
  | { type: 'AUTHORIZED'; generation: number }
  | { type: 'CONNECTED'; generation: number }
  | { type: 'CONNECTION_LOST' }
  | { type: 'RECONNECTED' }
  | { type: 'FAILED'; error: string; generation?: number }
  | { type: 'LEAVE' }
  | { type: 'FORCED_OUT'; reason: string };

export const initialVoiceState: VoiceState = {
  status: 'disconnected',
  channelId: null,
  error: null,
  attempts: 0,
  generation: 0,
};

export const MAX_RECONNECT_ATTEMPTS = 6;

export function voiceReducer(s: VoiceState, e: VoiceEvent): VoiceState {
  switch (e.type) {
    case 'JOIN':
      return { status: 'authorizing', channelId: e.channelId, error: null, attempts: 0, generation: s.generation + 1 };
    case 'AUTHORIZED':
      if (s.status !== 'authorizing' || e.generation !== s.generation) return s;
      return { ...s, status: 'connecting' };
    case 'CONNECTED':
      if (!(s.status === 'connecting' || s.status === 'reconnecting') || e.generation !== s.generation) return s;
      return { ...s, status: 'connected', attempts: 0, error: null };
    case 'CONNECTION_LOST':
      if (s.status !== 'connected' && s.status !== 'reconnecting') return s;
      if (s.attempts + 1 > MAX_RECONNECT_ATTEMPTS) return { ...s, status: 'failed', error: 'conexão perdida' };
      return { ...s, status: 'reconnecting', attempts: s.attempts + 1 };
    case 'RECONNECTED':
      if (s.status !== 'reconnecting') return s;
      return { ...s, status: 'connected', attempts: 0, error: null };
    case 'FAILED':
      if (s.status === 'disconnected') return s;
      if (e.generation !== undefined && e.generation !== s.generation) return s;
      return { ...s, status: 'failed', error: e.error };
    case 'LEAVE':
      return { ...initialVoiceState, generation: s.generation + 1 };
    case 'FORCED_OUT':
      return { ...initialVoiceState, generation: s.generation + 1, error: e.reason };
    default:
      return s;
  }
}

export const isInVoice = (s: VoiceState) => s.status !== 'disconnected' && s.status !== 'failed';
