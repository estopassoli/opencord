import { vi } from 'vitest';
import type {
  Channel as ChannelDto,
  Interaction as InteractionDto,
  Member as MemberDto,
  Message as MessageDto,
  Role as RoleDto,
  ServerDetail,
  ServerSummary,
  UserPublic,
} from '@opencord/contracts';
import { Client, type ClientOptions, type SocketLike, type SocketOptions } from '../src/index.js';

/** socket falso: guarda handlers e o que o cliente emitiu; `fire` simula um evento do servidor (com envelope) */
export class FakeSocket implements SocketLike {
  connected = true;
  handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  emitted: { event: string; args: unknown[] }[] = [];
  /** resposta de ack por comando (padrão: ok) */
  acks = new Map<string, (payload: unknown) => unknown>();
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    const ack = args.at(-1);
    if (typeof ack === 'function') {
      const custom = this.acks.get(event);
      ack(custom ? custom(args[0]) : { ok: true, data: { ttlSeconds: 60 } });
    }
    return true;
  }
  disconnect() {
    this.connected = false;
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  fire(event: string, payload: unknown, eventId: string = crypto.randomUUID()) {
    const env = { eventId, schemaVersion: 1, occurredAt: new Date().toISOString(), payload };
    for (const h of this.handlers.get(event) ?? []) h(env);
  }
  sent(event: string) {
    return this.emitted.filter((e) => e.event === event);
  }
}

export const BOT_ID = '11111111-1111-4111-8111-111111111111';
export const BOT_ROW_ID = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const USER2_ID = '22222222-2222-4222-8222-222222222223';
export const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
export const VOICE_ID = '33333333-3333-4333-8333-333333333334';
export const SERVER_ID = '44444444-4444-4444-8444-444444444444';
export const SERVER2_ID = '44444444-4444-4444-8444-444444444445';
export const MSG_ID = '55555555-5555-4555-8555-555555555555';
export const MSG2_ID = '55555555-5555-4555-8555-555555555556';
export const INTERACTION_ID = '66666666-6666-4666-8666-666666666666';
export const ROLE_EVERYONE = '77777777-7777-4777-8777-777777777770';
export const ROLE_MOD = '77777777-7777-4777-8777-777777777771';
export const CONV_ID = '88888888-8888-4888-8888-888888888888';
export const CATEGORY_ID = '99999999-9999-4999-8999-999999999990';
export const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export const botUser: UserPublic = {
  id: BOT_ID,
  username: 'meubot',
  displayName: 'Meu Bot',
  avatarKey: null,
  bot: true,
};
export const person: UserPublic = { id: USER_ID, username: 'ana', displayName: 'Ana', avatarKey: null, bot: false };
export const person2: UserPublic = {
  id: USER2_ID,
  username: 'bruno',
  displayName: 'Bruno',
  avatarKey: null,
  bot: false,
};

export function messageDto(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: MSG_ID,
    channelId: CHANNEL_ID,
    conversationId: null,
    author: person,
    body: '!ping',
    createdAt: new Date().toISOString(),
    editedAt: null,
    deleted: false,
    replyTo: null,
    reactions: [],
    attachments: [],
    mentions: [],
    pinnedAt: null,
    poll: null,
    reactionRoles: [],
    replyCount: 0,
    embeds: [],
    components: [],
    ...over,
  };
}

export function interactionDto(over: Partial<InteractionDto> = {}): InteractionDto {
  return {
    id: INTERACTION_ID,
    type: 'command',
    serverId: SERVER_ID,
    channelId: CHANNEL_ID,
    botId: BOT_ROW_ID,
    user: person,
    command: 'ola',
    options: {},
    createdAt: new Date().toISOString(),
    ...over,
  };
}

export function channelDto(over: Partial<ChannelDto> = {}): ChannelDto {
  return {
    id: CHANNEL_ID,
    serverId: SERVER_ID,
    categoryId: CATEGORY_ID,
    kind: 'text',
    name: 'geral',
    topic: null,
    position: 0,
    myPermissions: 0b111111,
    overrides: [],
    boardId: null,
    roomHub: false,
    temporary: false,
    ...over,
  };
}

export function roleDto(over: Partial<RoleDto> = {}): RoleDto {
  return {
    id: ROLE_EVERYONE,
    serverId: SERVER_ID,
    name: '@everyone',
    position: 0,
    permissions: 0b111011,
    color: null,
    isEveryone: true,
    ...over,
  };
}

export function memberDto(user: UserPublic, over: Partial<MemberDto> = {}): MemberDto {
  return { user, roleIds: [], joinedAt: new Date().toISOString(), nickname: null, timeoutUntil: null, ...over };
}

export function serverSummary(over: Partial<ServerSummary> = {}): ServerSummary {
  return {
    id: SERVER_ID,
    name: 'Clube',
    iconKey: null,
    ownerId: USER_ID,
    official: false,
    accent: null,
    wallpaperKey: null,
    ...over,
  };
}

export function serverDetail(over: Partial<ServerDetail> = {}): ServerDetail {
  return {
    ...serverSummary(),
    roles: [
      roleDto(),
      roleDto({ id: ROLE_MOD, name: 'Moderação', position: 1, permissions: 1 << 2, isEveryone: false }),
    ],
    categories: [{ id: CATEGORY_ID, serverId: SERVER_ID, name: 'Texto', position: 0 }],
    channels: [channelDto(), channelDto({ id: VOICE_ID, kind: 'voice', name: 'Sala', categoryId: null })],
    members: [
      memberDto(botUser, { roleIds: [ROLE_MOD] }),
      memberDto(person),
      memberDto(person2, { roleIds: [ROLE_MOD] }),
    ],
    myPermissions: 0b111011 | (1 << 2),
    ...over,
  };
}

export type Call = { method: string; path: string; body: unknown; headers: Record<string, string>; raw?: RequestInit };
export type Route = (c: Call, init?: RequestInit) => Response | undefined | Promise<Response | undefined>;

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const noContent = (): Response => new Response(null, { status: 204 });

export interface Setup {
  client: Client;
  calls: Call[];
  socket: () => FakeSocket;
  sockets: { socket: FakeSocket; opts: SocketOptions }[];
  /** rotas extras (avaliadas antes das padrão) */
  routes: Route[];
  fetchMock: ReturnType<typeof vi.fn>;
  /** login + ready + caches carregados */
  ready: () => Promise<void>;
}

/** Client com fetch e socket falsos. Rotas padrão: /me, /bots/@me, /servers, /servers/:id (um servidor com 2 canais). */
export function setup(
  options: Partial<ClientOptions> & { guilds?: ServerSummary[]; details?: Record<string, ServerDetail> } = {},
): Setup {
  const calls: Call[] = [];
  const sockets: { socket: FakeSocket; opts: SocketOptions }[] = [];
  const routes: Route[] = [];
  const guilds = options.guilds ?? [serverSummary()];
  const details = options.details ?? { [SERVER_ID]: serverDetail() };
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = input.replace('http://api.test', '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown = undefined;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    else if (init?.body instanceof FormData) body = init.body;
    const call: Call = { method, path, body, headers, raw: init };
    calls.push(call);
    for (const r of routes) {
      const res = await r(call, init);
      if (res) return res;
    }
    if (path === '/me')
      return json(200, { ...botUser, email: null, hasAccount: true, createdAt: new Date().toISOString() });
    if (path === '/bots/@me')
      return json(200, {
        id: BOT_ROW_ID,
        user: botUser,
        ownerId: USER_ID,
        description: '',
        public: false,
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
        commands: [],
      });
    if (path === '/servers' && method === 'GET') return json(200, guilds);
    const m = /^\/servers\/([^/]+)$/.exec(path);
    if (m && method === 'GET') {
      const d = details[m[1]!];
      return d ? json(200, d) : json(404, { statusCode: 404, message: 'servidor não encontrado' });
    }
    if (path.endsWith('/reply') && method === 'POST') {
      const b = body as { ephemeral: boolean };
      return json(200, { messageId: b.ephemeral ? null : MSG2_ID });
    }
    if (
      path.endsWith('/defer') ||
      path.endsWith('/update') ||
      path.endsWith('/modal') ||
      path.endsWith('/autocomplete')
    )
      return noContent();
    if (/^\/channels\/[^/]+\/messages$/.test(path) && method === 'POST') {
      const b = body as { body: string; embeds?: unknown[]; components?: unknown[]; attachmentIds?: string[] };
      return json(
        201,
        messageDto({
          id: MSG2_ID,
          author: botUser,
          body: b.body,
          embeds: (b.embeds ?? []) as MessageDto['embeds'],
          components: (b.components ?? []) as MessageDto['components'],
        }),
      );
    }
    if (/^\/conversations\/[^/]+\/messages$/.test(path) && method === 'POST') {
      const b = body as { body: string };
      return json(
        201,
        messageDto({ id: MSG2_ID, channelId: null, conversationId: CONV_ID, author: botUser, body: b.body }),
      );
    }
    if (/^\/messages\/[^/]+$/.test(path) && method === 'GET')
      return json(200, messageDto({ id: path.split('/')[2], author: botUser, body: 'buscada' }));
    if (/^\/messages\/[^/]+$/.test(path) && method === 'PATCH') {
      const b = body as { body?: string; embeds?: unknown[]; components?: unknown[] };
      return json(
        200,
        messageDto({
          id: path.split('/')[2],
          author: botUser,
          body: b.body ?? 'x',
          components: (b.components ?? []) as MessageDto['components'],
        }),
      );
    }
    if (/^\/messages\/[^/]+(\/pin|\/reactions(\/.+)?)?$/.test(path) && (method === 'PUT' || method === 'DELETE'))
      return noContent();
    return json(404, { statusCode: 404, message: `rota ${method} ${path} não existe no mock` });
  });
  const client = new Client({
    baseUrl: 'http://api.test/',
    fetch: fetchMock,
    createSocket: (_url, opts) => {
      const socket = new FakeSocket();
      sockets.push({ socket, opts });
      return socket;
    },
    ...options,
  });
  const socket = () => sockets[0]!.socket;
  const ready = async () => {
    await client.login('ocb_teste');
    const p = new Promise<void>((r) => client.once('ready', () => r()));
    socket().fire('ready', { userId: BOT_ID, sessionId: 'bot:x', heartbeatIntervalMs: 60_000 });
    await p;
  };
  return { client, calls, socket, sockets, routes, fetchMock, ready };
}

export const last = (calls: Call[]) => calls[calls.length - 1]!;
export const find = (calls: Call[], method: string, pathRe: RegExp) =>
  calls.find((c) => c.method === method && pathRe.test(c.path));
