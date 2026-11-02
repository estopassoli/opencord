import { EventEmitter } from 'node:events';
import type { Attachment, BotCommandInput } from '@opencord/contracts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Erro devolvido pela API do OpenCord (`{ statusCode, message, details? }`). `status` 0 = falha de rede. */
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
  /** requisições simultâneas (padrão 4) */
  concurrency?: number;
  /** retentativas em 5xx e falha de rede, com espera exponencial a partir de 500 ms (padrão 3) */
  retries?: number;
  /** retentativas em 429, esperando o `Retry-After` (padrão 5) */
  rateLimitRetries?: number;
}

export interface RateLimitInfo {
  method: HttpMethod;
  path: string;
  /** caminho sem ids (`/channels/:id/messages`) */
  route: string;
  retryAfterMs: number;
  /** quantas vezes esta requisição já esperou */
  attempt: number;
}

export interface RestEvents {
  rateLimited: [info: RateLimitInfo];
  debug: [message: string];
}

export interface RequestOptions {
  /** cabeçalhos extras */
  headers?: Record<string, string>;
}

export function resolveBaseUrl(given?: string): string {
  const url = given ?? process.env.OPENCORD_URL;
  if (!url) throw new Error('informe a URL da API: new Client({ baseUrl }) ou a variável OPENCORD_URL');
  return url.replace(/\/+$/, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** `/channels/<uuid>/messages` → `/channels/:id/messages` (para agrupar nos eventos de limite) */
export function routeOf(path: string): string {
  return path.split('?')[0]!.replace(UUID_RE, ':id');
}

function retryAfterMs(res: Response): number {
  const h = res.headers.get('retry-after');
  if (h) {
    const n = Number(h);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n * 1000);
    const at = Date.parse(h);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset) {
    const n = Number(reset);
    if (Number.isFinite(n)) return Math.max(0, n * 1000 - Date.now());
  }
  return 1000;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Arquivo pronto para subir: nome + conteúdo. */
export interface UploadFile {
  name: string;
  data: Blob;
}

/**
 * Cliente HTTP do OpenCord: JSON para lá e para cá, `Authorization: Bearer`, erros tipados, fila com concorrência,
 * retentativa em 429 (respeitando `Retry-After`) e em 5xx/rede (espera exponencial). Emite `rateLimited`.
 */
export class RestClient extends EventEmitter<RestEvents> {
  readonly baseUrl: string;
  readonly concurrency: number;
  readonly retries: number;
  readonly rateLimitRetries: number;
  private token: string | null;
  private readonly fetchImpl: FetchLike;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(opts: RestOptions = {}) {
    super();
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.concurrency = Math.max(1, opts.concurrency ?? 4);
    this.retries = Math.max(0, opts.retries ?? 3);
    this.rateLimitRetries = Math.max(0, opts.rateLimitRetries ?? 5);
  }

  setToken(token: string) {
    this.token = token;
    return this;
  }

  /** quantas requisições estão esperando por uma vaga na fila */
  get queued() {
    return this.waiting.length;
  }

  private slot(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.waiting.push(() => {
        this.active++;
        resolve();
      }),
    );
  }
  private release() {
    this.active--;
    this.waiting.shift()?.();
  }

  /**
   * Faz a requisição. `body` objeto vira JSON; `FormData` vai como multipart. `path` pode ser um caminho da API ou
   * uma URL absoluta (webhooks).
   */
  async request<T>(method: HttpMethod, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    await this.slot();
    try {
      return await this.attempt<T>(method, path, body, opts);
    } finally {
      this.release();
    }
  }

  private async attempt<T>(method: HttpMethod, path: string, body: unknown, opts: RequestOptions): Promise<T> {
    const url = /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !multipart) headers['content-type'] = 'application/json';
    const init = (): RequestInit => ({
      method,
      headers,
      body: body === undefined ? undefined : multipart ? (body as FormData) : JSON.stringify(body),
    });
    let failures = 0;
    let limited = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (failures < this.retries) {
          failures++;
          const wait = 500 * 2 ** (failures - 1);
          this.emit('debug', `${method} ${path}: falha de rede (${msg}); nova tentativa em ${wait} ms`);
          await sleep(wait);
          continue;
        }
        throw new OpenCordAPIError(0, `falha de rede: ${msg}`, undefined, method, path);
      }
      if (res.status === 429) {
        const wait = retryAfterMs(res);
        limited++;
        this.emit('rateLimited', { method, path, route: routeOf(path), retryAfterMs: wait, attempt: limited });
        if (limited <= this.rateLimitRetries) {
          await res.text().catch(() => undefined);
          await sleep(wait);
          continue;
        }
      } else if (res.status >= 500 && failures < this.retries) {
        failures++;
        const wait = 500 * 2 ** (failures - 1);
        this.emit('debug', `${method} ${path}: HTTP ${res.status}; nova tentativa em ${wait} ms`);
        await res.text().catch(() => undefined);
        await sleep(wait);
        continue;
      }
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
  }

  get<T>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, undefined, opts);
  }
  post<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, body, opts);
  }
  put<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PUT', path, body, opts);
  }
  patch<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, body, opts);
  }
  delete<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, body, opts);
  }

  /** `POST /attachments` (multipart, campo `file`) → `Attachment`. */
  async upload(file: UploadFile, path = '/attachments'): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file.data, file.name);
    const res = await this.post<{ attachment: Attachment }>(path, form);
    return res.attachment;
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
  userPresence: () => '/me/presence',
  userStatusText: () => '/me/status-text',
  guilds: () => '/servers',
  guild: (guildId: string) => `/servers/${guildId}`,
  guildChannels: (guildId: string) => `/servers/${guildId}/channels`,
  guildCategories: (guildId: string) => `/servers/${guildId}/categories`,
  guildRoles: (guildId: string) => `/servers/${guildId}/roles`,
  guildMember: (guildId: string, userId: string) => `/servers/${guildId}/members/${userId}`,
  guildMemberRoles: (guildId: string, userId: string) => `/servers/${guildId}/members/${userId}/roles`,
  guildBans: (guildId: string) => `/servers/${guildId}/bans`,
  guildBan: (guildId: string, userId: string) => `/servers/${guildId}/bans/${userId}`,
  guildInvites: (guildId: string) => `/servers/${guildId}/invites`,
  guildAuditLog: (guildId: string) => `/servers/${guildId}/audit-log`,
  guildWebhooks: (guildId: string) => `/servers/${guildId}/webhooks`,
  guildScheduledEvents: (guildId: string) => `/servers/${guildId}/events`,
  guildScheduledEvent: (_guildId: string, eventId: string) => `/events/${eventId}`,
  guildMessagesSearch: (guildId: string) => `/servers/${guildId}/messages/search`,
  guildCommands: (guildId: string) => `/servers/${guildId}/commands`,
  invite: (code: string) => `/invites/${code}`,
  channel: (channelId: string) => `/channels/${channelId}`,
  channelMessages: (channelId: string) => `/channels/${channelId}/messages`,
  channelBulkDelete: (channelId: string) => `/channels/${channelId}/messages/bulk-delete`,
  channelPins: (channelId: string) => `/channels/${channelId}/pins`,
  channelPolls: (channelId: string) => `/channels/${channelId}/polls`,
  channelMessage: (_channelId: string, messageId: string) => `/messages/${messageId}`,
  message: (messageId: string) => `/messages/${messageId}`,
  messageReactions: (messageId: string) => `/messages/${messageId}/reactions`,
  messageReaction: (messageId: string, emoji: string) =>
    `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
  messagePin: (messageId: string) => `/messages/${messageId}/pin`,
  messageReplies: (messageId: string) => `/messages/${messageId}/replies`,
  messageReactionRoles: (messageId: string) => `/messages/${messageId}/reaction-roles`,
  pollVote: (pollId: string) => `/polls/${pollId}/vote`,
  pollClose: (pollId: string) => `/polls/${pollId}/close`,
  role: (roleId: string) => `/roles/${roleId}`,
  category: (categoryId: string) => `/categories/${categoryId}`,
  webhook: (webhookId: string, token?: string) =>
    token ? `/webhooks/${webhookId}/${token}` : `/webhooks/${webhookId}`,
  conversations: () => '/conversations',
  conversationMessages: (conversationId: string) => `/conversations/${conversationId}/messages`,
  conversationPins: (conversationId: string) => `/conversations/${conversationId}/pins`,
  conversationMessagesSearch: (conversationId: string) => `/conversations/${conversationId}/messages/search`,
  attachments: () => '/attachments',
  interactionReply: (interactionId: string) => `/interactions/${interactionId}/reply`,
  interactionDefer: (interactionId: string) => `/interactions/${interactionId}/defer`,
  interactionUpdate: (interactionId: string) => `/interactions/${interactionId}/update`,
  interactionModal: (interactionId: string) => `/interactions/${interactionId}/modal`,
  interactionAutocomplete: (interactionId: string) => `/interactions/${interactionId}/autocomplete`,
  userBlock: (userId: string) => `/blocks/${userId}`,
} as const;

export interface RESTRequestOptions {
  body?: unknown;
}

type CommandLike = BotCommandInput | { toJSON(): BotCommandInput };

function toCommands(body: unknown): BotCommandInput[] {
  const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.commands) ? body.commands : null;
  if (!list) throw new Error('corpo inválido: envie um array de comandos ou { commands: [...] }');
  return (list as CommandLike[]).map((c) =>
    'toJSON' in c && typeof c.toJSON === 'function' ? c.toJSON() : (c as BotCommandInput),
  );
}

/**
 * `new REST().setToken(token)` + `rest.put(Routes.applicationCommands(id), { body: comandos })`: a forma de
 * registrar comandos que a comunidade conhece. Para tudo o mais, `rest.get/post/patch/delete(caminho, { body })`.
 */
export class REST extends EventEmitter<RestEvents> {
  private inner: RestClient | null = null;
  private readonly opts: RestOptions;

  constructor(opts: RestOptions & { version?: string } = {}) {
    super();
    this.opts = opts;
  }

  setToken(token: string) {
    this.opts.token = token;
    this.inner = null;
    return this;
  }

  private get client(): RestClient {
    if (!this.inner) {
      this.inner = new RestClient(this.opts);
      this.inner.on('rateLimited', (info) => this.emit('rateLimited', info));
      this.inner.on('debug', (m) => this.emit('debug', m));
    }
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
  delete<T = unknown>(path: string, opts: RESTRequestOptions = {}) {
    return this.client.delete<T>(path, opts.body);
  }
}
