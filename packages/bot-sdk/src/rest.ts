import type { BotCommand } from '@opencord/contracts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Erro devolvido pela API do OpenCord (`{ statusCode, message, details? }`). */
export class OpenCordAPIError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    readonly method?: HttpMethod,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'OpenCordAPIError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RestOptions {
  baseUrl?: string;
  token?: string;
  /** substitui o `fetch` global (testes) */
  fetch?: FetchLike;
}

export function resolveBaseUrl(given?: string): string {
  const url = given ?? process.env.OPENCORD_URL;
  if (!url) throw new Error('informe a URL da API: new Client({ baseUrl }) ou a variável OPENCORD_URL');
  return url.replace(/\/+$/, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Cliente HTTP mínimo: JSON para lá e para cá, `Authorization: Bearer`, erros tipados. */
export class RestClient {
  readonly baseUrl: string;
  private token: string | null;
  private readonly fetchImpl: FetchLike;

  constructor(opts: RestOptions = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  setToken(token: string) {
    this.token = token;
    return this;
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const d = isRecord(data) ? data : {};
      const message = typeof d.message === 'string' ? d.message : `HTTP ${res.status}`;
      throw new OpenCordAPIError(res.status, message, d.details, method, path);
    }
    return data as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

/**
 * Caminhos da API, com os nomes que quem registra comandos "manualmente" já usa. Comandos de bot são globais no
 * OpenCord (valem em todo servidor em que o bot é membro): as duas funções de comandos levam ao mesmo lugar.
 */
export const Routes = {
  applicationCommands: (_applicationId?: string) => '/bots/@me/commands',
  applicationGuildCommands: (_applicationId?: string, _guildId?: string) => '/bots/@me/commands',
  currentApplication: () => '/bots/@me',
  user: (userId = '@me') => (userId === '@me' ? '/me' : `/users/${userId}/profile`),
  channelMessages: (channelId: string) => `/channels/${channelId}/messages`,
  channelMessage: (_channelId: string, messageId: string) => `/messages/${messageId}`,
  interactionReply: (interactionId: string) => `/interactions/${interactionId}/reply`,
  interactionDefer: (interactionId: string) => `/interactions/${interactionId}/defer`,
} as const;

export interface RESTRequestOptions {
  body?: unknown;
}

type CommandLike = BotCommand | { toJSON(): BotCommand };

function toCommands(body: unknown): BotCommand[] {
  const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.commands) ? body.commands : null;
  if (!list) throw new Error('corpo inválido: envie um array de comandos ou { commands: [...] }');
  return (list as CommandLike[]).map((c) =>
    'toJSON' in c && typeof c.toJSON === 'function' ? c.toJSON() : (c as BotCommand),
  );
}

/**
 * `new REST().setToken(token)` + `rest.put(Routes.applicationCommands(id), { body: comandos })`: a forma de
 * registrar comandos que a comunidade conhece. Para tudo o mais, `rest.get/post/patch/delete(caminho, { body })`.
 */
export class REST {
  private inner: RestClient | null = null;
  private readonly opts: RestOptions;

  constructor(opts: RestOptions & { version?: string } = {}) {
    this.opts = opts;
  }

  setToken(token: string) {
    this.opts.token = token;
    this.inner = null;
    return this;
  }

  private get client(): RestClient {
    this.inner ??= new RestClient(this.opts);
    return this.inner;
  }

  private body(path: string, body: unknown): unknown {
    // PUT /bots/@me/commands recebe o array direto (como se registra lá fora) ou já embrulhado
    return path === Routes.applicationCommands() ? { commands: toCommands(body) } : body;
  }

  get<T = unknown>(path: string) {
    return this.client.get<T>(path);
  }
  post<T = unknown>(path: string, opts: RESTRequestOptions = {}) {
    return this.client.post<T>(path, this.body(path, opts.body));
  }
  put<T = unknown>(path: string, opts: RESTRequestOptions = {}) {
    return this.client.put<T>(path, this.body(path, opts.body));
  }
  patch<T = unknown>(path: string, opts: RESTRequestOptions = {}) {
    return this.client.patch<T>(path, opts.body);
  }
  delete<T = unknown>(path: string) {
    return this.client.delete<T>(path);
  }
}
