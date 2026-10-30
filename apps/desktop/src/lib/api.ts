import type { AuthResponse, InstanceInfo, TokenPair } from '@opencord/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Cliente REST tipado. Renova o access token de forma single-flight quando expira (401 ou < 30 s do fim).
 * Falha de refresh dispara `onAuthLost` (volta ao login).
 */
export class ApiClient {
  private tokens: SessionTokens | null = null;
  private refreshing: Promise<boolean> | null = null;
  onTokens: (t: SessionTokens) => void | Promise<void> = () => undefined;
  onAuthLost: () => void = () => undefined;

  constructor(
    public baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  setTokens(t: SessionTokens | null) {
    this.tokens = t;
  }

  get accessToken(): string | null {
    return this.tokens?.accessToken ?? null;
  }

  private url(path: string) {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  /**
   * Lê os tokens persistidos (outra aba/janela pode ter rotacionado o refresh).
   * Usado dentro da trava para nunca reapresentar um refresh já usado: o servidor trata reuso
   * como roubo e revoga a família inteira (logout em todos os lugares).
   */
  readStored: () => Promise<SessionTokens | null> = async () => null;

  async refresh(): Promise<boolean> {
    if (!this.tokens) return false;
    this.refreshing ??= withRefreshLock(() => this.doRefresh()).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const stored = await this.readStored().catch(() => null);
    if (stored && this.tokens && stored.refreshToken !== this.tokens.refreshToken) {
      // outra aba/instância já rotacionou: adota o par novo em vez de reutilizar o antigo
      this.tokens = stored;
      if (new Date(stored.accessExpiresAt).getTime() - Date.now() > 30_000) return true;
    }
    if (!this.tokens) return false;
    try {
      const res = await this.fetchImpl(this.url('/auth/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.tokens.refreshToken }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          this.tokens = null;
          this.onAuthLost();
        }
        return false;
      }
      const t = (await res.json()) as TokenPair;
      this.tokens = { accessToken: t.accessToken, refreshToken: t.refreshToken, accessExpiresAt: t.accessExpiresAt };
      // persiste ainda dentro da trava: a próxima aba já lê o refresh novo
      await this.onTokens(this.tokens);
      return true;
    } catch {
      return false; // offline: manter tokens e tentar depois
    }
  }

  /** Garante um access token válido (renova se faltar < 30 s). */
  async freshToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (new Date(this.tokens.accessExpiresAt).getTime() - Date.now() < 30_000) await this.refresh();
    return this.tokens?.accessToken ?? null;
  }

  async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    opts: { auth?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const auth = opts.auth !== false;
    const doFetch = async () => {
      const token = auth ? await this.freshToken() : null;
      return this.fetchImpl(this.url(path), {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    };
    let res = await doFetch();
    if (res.status === 401 && auth && this.tokens) {
      if (await this.refresh()) res = await doFetch();
    }
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const d = (data ?? {}) as { message?: string | string[]; details?: unknown };
      const msg = Array.isArray(d.message) ? d.message.join('; ') : (d.message ?? `erro ${res.status}`);
      throw new ApiError(res.status, msg, d.details);
    }
    return data as T;
  }

  /** GET autenticado devolvendo o corpo como Blob (imagens protegidas, ex.: prévia de live). */
  async blob(path: string): Promise<Blob> {
    const send = async () => {
      const token = await this.freshToken();
      return this.fetchImpl(this.url(path), { headers: token ? { authorization: `Bearer ${token}` } : {} });
    };
    let res = await send();
    if (res.status === 401 && (await this.refresh())) res = await send();
    if (!res.ok) throw new ApiError(res.status, `erro ${res.status}`, undefined);
    return res.blob();
  }

  async upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
    const form = new FormData();
    // campos antes do arquivo: o servidor lê o multipart em ordem
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', file, file.name);
    const send = async () => {
      const token = await this.freshToken();
      return this.fetchImpl(this.url(path), {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form,
      });
    };
    let res = await send();
    if (res.status === 401 && (await this.refresh())) res = await send();
    return this.parse<T>(res);
  }

  // ----- auth (sem token) -----
  instance() {
    return this.request<InstanceInfo>('GET', '/auth/instance', undefined, { auth: false });
  }
  guest(nickname: string, deviceId: string, accessCode?: string) {
    return this.request<AuthResponse>(
      'POST',
      '/auth/guest',
      { nickname, deviceId, ...(accessCode ? { accessCode } : {}) },
      { auth: false },
    );
  }
  /** Login de conta: `login` = apelido ou e-mail. */
  login(login: string, password: string, deviceId: string) {
    return this.request<AuthResponse>('POST', '/auth/login', { login, password, deviceId }, { auth: false });
  }
  /** Criar conta (opcional): apelido + senha; e-mail opcional. */
  register(body: {
    nickname: string;
    password: string;
    email?: string | undefined;
    accessCode?: string | undefined;
    deviceId: string;
  }) {
    return this.request<AuthResponse>('POST', '/auth/register', body, { auth: false });
  }
}

export function normalizeServerUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `${/^(localhost|127\.|\[::1\])/.test(s) ? 'http' : 'https'}://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * Serializa renovações entre abas/janelas do mesmo perfil (Web Locks).
 * Sem Web Locks, serializa ao menos dentro deste contexto JS (fila em memória).
 */
let localQueue: Promise<unknown> = Promise.resolve();
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) return locks.request('oc:auth-refresh', fn);
  const run = localQueue.then(fn, fn);
  localQueue = run.catch(() => undefined);
  return run;
}
