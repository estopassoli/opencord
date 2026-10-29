import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, normalizeServerUrl } from '../src/lib/api';

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('ApiClient', () => {
  it('refresh single-flight: várias 401 simultâneas geram UM refresh', async () => {
    let refreshes = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, {
          accessToken: 'new',
          accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
          refreshToken: 'r2',
          refreshExpiresAt: new Date().toISOString(),
        });
      }
      const auth = new Headers(init?.headers).get('authorization');
      return auth === 'Bearer new' ? json(200, { ok: true }) : json(401, { message: 'expirado' });
    });
    const c = new ApiClient('http://x', fetchMock as typeof fetch);
    c.setTokens({
      accessToken: 'old',
      refreshToken: 'r1',
      accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    const results = await Promise.all([c.request('GET', '/a'), c.request('GET', '/b'), c.request('GET', '/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
  });
  it('refresh 401 dispara onAuthLost e erro tipado', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/auth/refresh') ? json(401, { message: 'x' }) : json(401, { message: 'token inválido' }),
    );
    const c = new ApiClient('http://x', fetchMock as typeof fetch);
    const lost = vi.fn();
    c.onAuthLost = lost;
    c.setTokens({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: new Date(Date.now() + 900_000).toISOString() });
    await expect(c.request('GET', '/me')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalledOnce();
  });
});

describe('helpers', () => {
  it('normaliza URL do servidor', () => {
    expect(normalizeServerUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeServerUrl('chat.exemplo.com/')).toBe('https://chat.exemplo.com');
  });
  it('dois clientes com o mesmo refresh (StrictMode/abas): só um rotaciona, o outro adota o novo', async () => {
    let stored = { accessToken: 'a0', refreshToken: 'r1', accessExpiresAt: new Date(Date.now() - 1000).toISOString() };
    const used: string[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const rt = (JSON.parse(String(init?.body)) as { refreshToken: string }).refreshToken;
      if (used.includes(rt)) return json(401, { message: 'refresh reutilizado; sessões revogadas' });
      used.push(rt);
      await new Promise((r) => setTimeout(r, 10));
      return json(200, {
        accessToken: `a-${rt}`,
        accessExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        refreshToken: `${rt}+`,
        refreshExpiresAt: new Date().toISOString(),
      });
    });
    const make = () => {
      const c = new ApiClient('http://x', fetchMock as typeof fetch);
      c.setTokens({ ...stored });
      c.readStored = async () => ({ ...stored });
      c.onTokens = async (t) => {
        stored = { ...t };
      };
      c.onAuthLost = () => {
        throw new Error('não deveria perder a sessão');
      };
      return c;
    };
    const [a, b] = [make(), make()];
    expect(await Promise.all([a.refresh(), b.refresh()])).toEqual([true, true]);
    expect(used).toEqual(['r1']);
    expect(a.accessToken).toBe('a-r1');
    expect(b.accessToken).toBe('a-r1');
    expect(stored.refreshToken).toBe('r1+');
  });
});
