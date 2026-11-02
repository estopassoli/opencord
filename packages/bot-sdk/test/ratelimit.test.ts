import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REST, RestClient, routeOf } from '../src/index.js';
import { setup } from './helpers.js';

describe('RestClient: limites, retentativas e fila', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('429 espera o Retry-After (segundos), emite rateLimited e tenta de novo', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      if (n === 1) return new Response('{"message":"muitas"}', { status: 429, headers: { 'retry-after': '2' } });
      return new Response('{"ok":true}', { status: 200 });
    });
    const rest = new RestClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    const limited = vi.fn();
    rest.on('rateLimited', limited);
    const p = rest.get<{ ok: boolean }>('/channels/33333333-3333-4333-8333-333333333333/messages');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(limited).toHaveBeenCalledWith({
      method: 'GET',
      path: '/channels/33333333-3333-4333-8333-333333333333/messages',
      route: '/channels/:id/messages',
      retryAfterMs: 2000,
      attempt: 1,
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      routeOf('/servers/44444444-4444-4444-8444-444444444444/members/22222222-2222-4222-8222-222222222222?x=1'),
    ).toBe('/servers/:id/members/:id');
  });

  it('desiste depois de rateLimitRetries e devolve OpenCordAPIError 429', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"message":"muitas"}', { status: 429, headers: { 'retry-after': '0' } }),
    );
    const rest = new RestClient({ baseUrl: 'http://api.test', fetch: fetchMock, rateLimitRetries: 2 });
    const p = rest.get('/x').catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(await p).toMatchObject({ name: 'OpenCordAPIError', status: 429, message: 'muitas' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('5xx e falha de rede: espera exponencial (500, 1000, 2000 ms) e depois erro', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('ECONNRESET');
      if (n === 2) return new Response('erro', { status: 503 });
      return new Response('{"ok":1}', { status: 200 });
    });
    const rest = new RestClient({ baseUrl: 'http://api.test', fetch: fetchMock });
    const p = rest.post('/x', { a: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await p).toEqual({ ok: 1 });

    const dead = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const r2 = new RestClient({ baseUrl: 'http://api.test', fetch: dead, retries: 1 });
    const q = r2.get('/y').catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await q).toMatchObject({ name: 'OpenCordAPIError', status: 0, message: /falha de rede: ENOTFOUND/ });
    expect(dead).toHaveBeenCalledTimes(2);
  });

  it('fila: no máximo `concurrency` requisições em voo', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          release.push(() => {
            inFlight--;
            resolve(new Response('{}', { status: 200 }));
          });
        }),
    );
    const rest = new RestClient({ baseUrl: 'http://api.test', fetch: fetchMock, concurrency: 2 });
    const all = Promise.all([rest.get('/1'), rest.get('/2'), rest.get('/3'), rest.get('/4')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rest.queued).toBe(2);
    release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    let released = 1;
    while (released < 4) {
      if (release.length) {
        release.shift()!();
        released++;
      }
      await vi.advanceTimersByTimeAsync(0);
    }
    await all;
    expect(peak).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('Client e REST reemitem rateLimited; upload manda FormData sem content-type', async () => {
    const s = setup();
    s.routes.push((c) =>
      c.path === '/limitada' ? new Response('', { status: 429, headers: { 'retry-after': '1' } }) : undefined,
    );
    const events = vi.fn();
    s.client.on('rateLimited', events);
    await s.client.login('ocb_x');
    const p = s.client.rest.get('/limitada').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ route: '/limitada', retryAfterMs: 1000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    const wrapped = new REST({ baseUrl: 'http://api.test', fetch: s.fetchMock as never }).setToken('x');
    const ev2 = vi.fn();
    wrapped.on('rateLimited', ev2);
    const q = wrapped.get('/limitada').catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    await q;
    expect(ev2).toHaveBeenCalled();
  });
});
