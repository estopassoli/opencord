import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Status } from '../src/index.js';
import { BOT_ID, CHANNEL_ID, CONV_ID, VOICE_ID, messageDto, setup } from './helpers.js';

describe('retomada (sync:resume) e estado do gateway', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('guarda a última mensagem por canal e, ao reconectar, pede sync:resume e reemite só o que não viu', async () => {
    const s = setup();
    expect(s.client.ws.status).toBe(Status.Idle);
    await s.client.login('ocb_x');
    expect(s.client.ws.status).toBe(Status.Connecting);
    const readyP = new Promise<void>((r) => s.client.once('ready', () => r()));
    s.socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 60_000 });
    await readyP;
    expect(s.client.ws.status).toBe(Status.Ready);
    const seen: string[] = [];
    s.client.on('messageCreate', (m) => seen.push(m.id));
    s.socket().fire('chat:message:created', messageDto({ id: '55555555-5555-4555-8555-555555555001' }));
    s.socket().fire('chat:message:created', messageDto({ id: '55555555-5555-4555-8555-555555555002' }));
    s.socket().fire(
      'chat:message:created',
      messageDto({ id: '55555555-5555-4555-8555-555555555003', channelId: VOICE_ID }),
    );
    s.socket().fire(
      'chat:message:created',
      messageDto({ id: '55555555-5555-4555-8555-555555555004', channelId: null, conversationId: CONV_ID }),
    );
    expect(s.client.channels.cache.get(CHANNEL_ID)?.lastMessageId).toBe('55555555-5555-4555-8555-555555555002');
    expect(s.client.lastMessageIdOf(VOICE_ID)).toBe('55555555-5555-4555-8555-555555555003');

    // queda e reconexão: o ack do sync:resume devolve uma já vista e duas novas
    for (const h of s.socket().handlers.get('disconnect') ?? []) h('transport close');
    expect(s.client.ws.status).toBe(Status.Disconnected);
    s.socket().acks.set('sync:resume', () => ({
      ok: true,
      data: {
        missed: [
          messageDto({ id: '55555555-5555-4555-8555-555555555002' }),
          messageDto({ id: '55555555-5555-4555-8555-555555555005' }),
          messageDto({ id: '55555555-5555-4555-8555-555555555006', channelId: VOICE_ID }),
        ],
        truncated: true,
      },
    }));
    const resumed = vi.fn();
    const warned = vi.fn();
    s.client.on('resume', resumed);
    s.client.on('warn', warned);
    s.socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    const sync = s.socket().sent('sync:resume');
    expect(sync).toHaveLength(1);
    expect(sync[0]!.args[0]).toEqual({
      channels: [
        { channelId: CHANNEL_ID, lastMessageId: '55555555-5555-4555-8555-555555555002' },
        { channelId: VOICE_ID, lastMessageId: '55555555-5555-4555-8555-555555555003' },
      ],
    });
    expect(seen).toEqual([
      '55555555-5555-4555-8555-555555555001',
      '55555555-5555-4555-8555-555555555002',
      '55555555-5555-4555-8555-555555555003',
      '55555555-5555-4555-8555-555555555004',
      '55555555-5555-4555-8555-555555555005',
      '55555555-5555-4555-8555-555555555006',
    ]);
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringMatching(/truncada/));
    expect(s.client.lastMessageIdOf(CHANNEL_ID)).toBe('55555555-5555-4555-8555-555555555005');
    // a mesma mensagem chegando ao vivo depois da retomada não é repetida
    s.socket().fire(
      'chat:message:created',
      messageDto({ id: '55555555-5555-4555-8555-555555555006', channelId: VOICE_ID }),
    );
    expect(seen).toHaveLength(6);
    s.client.destroy();
    expect(s.client.ws.status).toBe(Status.Idle);
  });

  it('sem mensagens vistas não manda sync:resume; ack com erro só vira debug', async () => {
    const s = setup();
    await s.ready();
    s.socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.socket().sent('sync:resume')).toHaveLength(0);
    s.socket().fire('chat:message:created', messageDto());
    s.socket().acks.set('sync:resume', () => ({ ok: false, error: { code: 'x', message: 'nope' } }));
    const debug = vi.fn();
    s.client.on('debug', debug);
    const resumed = vi.fn();
    s.client.on('resume', resumed);
    s.socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.socket().sent('sync:resume')).toHaveLength(1);
    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/sync:resume recusado: nope/));
    expect(resumed).toHaveBeenCalledTimes(1);
  });
});
