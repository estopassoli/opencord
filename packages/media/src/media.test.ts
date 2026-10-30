import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  availableProfiles,
  backoffDelay,
  effectiveProfile,
  initialStreamState,
  initialVoiceState,
  isHardwareEncoder,
  MAX_RECONNECT_ATTEMPTS,
  PushToTalk,
  SpeakingDebouncer,
  STREAM_PROFILES,
  streamBitrate,
  streamReducer,
  voiceReducer,
  type StreamEvent,
  type VoiceEvent,
  type VoiceState,
} from './index.js';

const run = (events: VoiceEvent[], s: VoiceState = initialVoiceState) => events.reduce(voiceReducer, s);

describe('voiceReducer', () => {
  it('fluxo feliz: disconnected → authorizing → connecting → connected', () => {
    const s1 = voiceReducer(initialVoiceState, { type: 'JOIN', channelId: 'c1' });
    expect(s1.status).toBe('authorizing');
    const s2 = voiceReducer(s1, { type: 'AUTHORIZED', generation: s1.generation });
    const s3 = voiceReducer(s2, { type: 'CONNECTED', generation: s1.generation });
    expect(s3).toMatchObject({ status: 'connected', channelId: 'c1', attempts: 0 });
  });

  it('descarta respostas de uma entrada anterior (troca rápida de canal)', () => {
    const a = voiceReducer(initialVoiceState, { type: 'JOIN', channelId: 'c1' });
    const b = voiceReducer(a, { type: 'JOIN', channelId: 'c2' });
    const stale = voiceReducer(b, { type: 'AUTHORIZED', generation: a.generation });
    expect(stale.status).toBe('authorizing');
    expect(stale.channelId).toBe('c2');
    const staleFail = voiceReducer(b, { type: 'FAILED', error: 'x', generation: a.generation });
    expect(staleFail.status).toBe('authorizing');
  });

  it('reconexão com limite de tentativas → failed', () => {
    let s = run([{ type: 'JOIN', channelId: 'c' }]);
    s = run(
      [
        { type: 'AUTHORIZED', generation: s.generation },
        { type: 'CONNECTED', generation: s.generation },
      ],
      s,
    );
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS; i++) s = voiceReducer(s, { type: 'CONNECTION_LOST' });
    expect(s.status).toBe('reconnecting');
    expect(s.attempts).toBe(MAX_RECONNECT_ATTEMPTS);
    expect(voiceReducer(s, { type: 'RECONNECTED' })).toMatchObject({ status: 'connected', attempts: 0 });
    expect(voiceReducer(s, { type: 'CONNECTION_LOST' }).status).toBe('failed');
  });

  it('eventos fora de ordem não mudam o estado', () => {
    expect(voiceReducer(initialVoiceState, { type: 'CONNECTED', generation: 0 })).toBe(initialVoiceState);
    expect(voiceReducer(initialVoiceState, { type: 'RECONNECTED' })).toBe(initialVoiceState);
    expect(voiceReducer(initialVoiceState, { type: 'CONNECTION_LOST' })).toBe(initialVoiceState);
  });

  it('expulsão força disconnected com motivo', () => {
    const s = run([
      { type: 'JOIN', channelId: 'c' },
      { type: 'FORCED_OUT', reason: 'kicked' },
    ]);
    expect(s).toMatchObject({ status: 'disconnected', channelId: null, error: 'kicked' });
  });
});

describe('streamReducer', () => {
  const go = (events: StreamEvent[]) => events.reduce(streamReducer, initialStreamState);
  it('nunca fica live sem PUBLISHED', () => {
    const s = go([
      { type: 'OPEN_PICKER' },
      { type: 'START', sourceId: 'screen:1', sourceKind: 'screen', withAudio: true },
    ]);
    expect(s.status).toBe('starting');
    expect(go([{ type: 'START', sourceId: 'x', sourceKind: 'screen', withAudio: false }]).status).toBe('idle');
  });
  it('marca áudio indisponível quando pedido e não publicado', () => {
    const s = go([
      { type: 'OPEN_PICKER' },
      { type: 'START', sourceId: 's', sourceKind: 'screen', withAudio: true },
      { type: 'PUBLISHED', audioPublished: false },
    ]);
    expect(s).toMatchObject({ status: 'live', audioUnavailable: true });
  });
  it('fonte encerrada → stopping → idle com erro explicativo', () => {
    const s = go([
      { type: 'OPEN_PICKER' },
      { type: 'START', sourceId: 'w', sourceKind: 'window', withAudio: false },
      { type: 'PUBLISHED', audioPublished: false },
      { type: 'SOURCE_ENDED' },
      { type: 'STOPPED' },
    ]);
    expect(s.status).toBe('idle');
    expect(s.error).toMatch(/fonte/);
  });
  it('cancelar seleção volta a idle; erro permite reabrir', () => {
    expect(go([{ type: 'OPEN_PICKER' }, { type: 'CANCEL' }]).status).toBe('idle');
    expect(go([{ type: 'ERROR', error: 'x' }, { type: 'OPEN_PICKER' }]).status).toBe('selecting');
  });
});

describe('perfis de stream', () => {
  it('sem hardware confirmado, 1440p60 cai para 1080p60', () => {
    expect(effectiveProfile('1440p60', { hardware: null }).id).toBe('1080p60');
    expect(effectiveProfile('1440p60', { hardware: true }).id).toBe('1440p60');
    expect(availableProfiles({ hardware: false }).map((p) => p.id)).toEqual(['720p30', '1080p60']);
  });
  it('não excede a resolução da fonte', () => {
    expect(effectiveProfile('1440p60', { hardware: true, sourceHeight: 1080 }).id).toBe('1080p60');
    expect(effectiveProfile('1080p60', { hardware: true, sourceHeight: 720 }).id).toBe('720p30');
  });
  it('classifica encoders observados no F0.5', () => {
    expect(isHardwareEncoder('MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)')).toBe(true);
    expect(isHardwareEncoder('libvpx')).toBe(false);
    expect(isHardwareEncoder('libaom')).toBe(false);
    expect(isHardwareEncoder(undefined)).toBeNull();
  });
});

describe('SpeakingDebouncer', () => {
  it('liga imediatamente e só desliga após o hold', () => {
    const changes: boolean[] = [];
    const d = new SpeakingDebouncer((v) => changes.push(v), 300);
    d.update(true, 0);
    d.update(false, 100);
    d.update(true, 150);
    d.update(false, 200);
    d.update(false, 400);
    expect(changes).toEqual([true]);
    d.update(false, 460);
    expect(changes).toEqual([true, false]);
  });
});

describe('PushToTalk', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('abre ao pressionar, fecha após atraso, ignora auto-repeat', () => {
    const calls: boolean[] = [];
    const p = new PushToTalk((o) => calls.push(o), 200);
    p.down();
    p.down();
    p.down();
    p.up();
    vi.advanceTimersByTime(150);
    expect(p.isOpen).toBe(true);
    p.down(); // pressionou de novo antes do atraso: continua aberto sem novo evento
    p.up();
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([true, false]);
  });
  it('reset fecha imediatamente (blur da janela)', () => {
    const calls: boolean[] = [];
    const p = new PushToTalk((o) => calls.push(o), 1000);
    p.down();
    p.reset();
    expect(calls).toEqual([true, false]);
    vi.advanceTimersByTime(2000);
    expect(calls).toEqual([true, false]);
  });
});

describe('backoffDelay', () => {
  it('cresce exponencialmente com teto e jitter', () => {
    expect(backoffDelay(0, 500, 15000, () => 1)).toBe(500);
    expect(backoffDelay(3, 500, 15000, () => 1)).toBe(4000);
    expect(backoffDelay(20, 500, 15000, () => 1)).toBe(15000);
    expect(backoffDelay(5, 500, 15000, () => 0)).toBe(0);
  });
});

describe('bitrate da live', () => {
  it('máxima é o teto do perfil e leve < equilibrada < máxima', () => {
    for (const p of Object.values(STREAM_PROFILES)) {
      expect(streamBitrate(p.id, 'high')).toBe(p.maxBitrate);
      expect(streamBitrate(p.id, 'low')).toBeLessThan(streamBitrate(p.id, 'medium'));
      expect(streamBitrate(p.id, 'medium')).toBeLessThan(streamBitrate(p.id, 'high'));
    }
    expect(streamBitrate('1080p60', 'medium')).toBe(12_000_000);
  });
});
