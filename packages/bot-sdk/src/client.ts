import { EventEmitter } from 'node:events';
import type {
  Bot,
  BotCommand,
  Channel as ChannelDto,
  EventEnvelope,
  Me,
  ServerDetail,
  ServerEvents,
  ServerSummary,
  UserPublic,
  UserProfile,
} from '@opencord/contracts';
import { io } from 'socket.io-client';
import { toCommandJSON, type CommandDefinition } from './builders.js';
import { RestClient, resolveBaseUrl, type FetchLike } from './rest.js';
import {
  ChatInputCommandInteraction,
  ClientUser,
  Guild,
  GuildMember,
  Message,
  MessageReaction,
  PartialMessage,
  TextChannel,
  User,
  type Channel,
} from './structures.js';

const SOCKET_PATH = '/realtime';

/** O que o Client usa do socket: suficiente para injetar um falso nos testes. */
export interface SocketLike {
  connected: boolean;
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(): unknown;
  removeAllListeners(): unknown;
}

export interface SocketOptions {
  path: string;
  auth: { token: string };
  transports: ['websocket'];
}

export interface ClientOptions {
  /** URL da API (ou variável OPENCORD_URL) */
  baseUrl?: string;
  /** aceito e ignorado: o bot recebe os eventos dos servidores em que é membro */
  intents?: unknown;
  /** aceito e ignorado */
  partials?: unknown;
  /** carregar servidores, canais e membros ao conectar (padrão: true) */
  cache?: boolean;
  /** uso interno/testes: substitui o `fetch` global */
  fetch?: FetchLike;
  /** uso interno/testes: substitui a criação do socket */
  createSocket?: (url: string, opts: SocketOptions) => SocketLike;
}

export interface ClientEvents {
  ready: [client: Client];
  clientReady: [client: Client];
  /** reconectou depois de uma queda (caches recarregados) */
  resume: [];
  messageCreate: [message: Message];
  /** não há "mensagem antiga": o primeiro argumento vem null */
  messageUpdate: [oldMessage: Message | null, newMessage: Message];
  messageDelete: [message: PartialMessage];
  messageReactionAdd: [reaction: MessageReaction, user: User];
  messageReactionRemove: [reaction: MessageReaction, user: User];
  interactionCreate: [interaction: ChatInputCommandInteraction];
  guildMemberAdd: [member: GuildMember];
  guildMemberRemove: [member: GuildMember];
  guildCreate: [guild: Guild];
  guildDelete: [guild: Guild];
  channelCreate: [channel: TextChannel];
  channelUpdate: [oldChannel: TextChannel | null, newChannel: TextChannel];
  channelDelete: [channel: TextChannel];
  error: [error: Error];
  disconnect: [reason: string];
  debug: [message: string];
}

type Ack = { ok: true; data: { ttlSeconds: number } } | { ok: false; error: { code: string; message: string } };

function isAck(v: unknown): v is Ack {
  return typeof v === 'object' && v !== null && 'ok' in v;
}

/**
 * Cliente do bot: REST + gateway (Socket.IO) do OpenCord, com os nomes de eventos e estruturas que a comunidade
 * de bots já conhece. `login()` autentica, conecta e mantém a presença (heartbeat) do bot.
 */
export class Client extends EventEmitter<ClientEvents> {
  readonly rest: RestClient;
  readonly options: ClientOptions;
  /** o usuário do bot; definido após `login()` */
  user: ClientUser | null = null;
  token: string | null = null;
  readonly guilds = {
    cache: new Map<string, Guild>(),
    fetch: async (id: string): Promise<Guild> => {
      const detail = await this.rest.get<ServerDetail>(`/servers/${id}`);
      const g = this.guilds.cache.get(id) ?? new Guild(this, detail);
      this.guilds.cache.set(id, g);
      return g.apply(detail);
    },
  };
  readonly channels = {
    cache: new Map<string, TextChannel>(),
    fetch: async (id: string): Promise<Channel> => {
      const cached = this.channels.cache.get(id);
      if (cached) return cached;
      // sem rota GET /channels/:id: recarrega os servidores até achar o canal
      for (const g of this.guilds.cache.values()) await g.fetch();
      const found = this.channels.cache.get(id);
      if (!found) throw new Error(`canal ${id} não encontrado nos servidores do bot`);
      return found;
    },
  };
  readonly users = {
    cache: new Map<string, User>(),
    fetch: async (id: string): Promise<User> => {
      const cached = this.users.cache.get(id);
      if (cached) return cached;
      const p = await this.rest.get<UserProfile>(`/users/${id}/profile`);
      return this.resolveUser(p.user);
    },
  };
  /** o registro do bot (`GET /bots/@me`) e os comandos de barra */
  readonly application = {
    id: null as string | null,
    fetch: async (): Promise<Bot> => {
      const bot = await this.rest.get<Bot>('/bots/@me');
      this.application.id = bot.id;
      return bot;
    },
    commands: {
      /** substitui a lista de comandos do bot (globais: valem em todo servidor em que ele é membro) */
      set: async (commands: CommandDefinition[]): Promise<BotCommand[]> => {
        const bot = await this.rest.put<Bot>('/bots/@me/commands', { commands: commands.map(toCommandJSON) });
        return bot.commands;
      },
      fetch: async (): Promise<BotCommand[]> => (await this.application.fetch()).commands,
    },
  };
  /** latência do último heartbeat (ms); -1 antes do primeiro */
  readonly ws = { ping: -1 };
  readyAt: Date | null = null;

  private socket: SocketLike | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private wasReady = false;

  constructor(options: ClientOptions = {}) {
    super();
    this.options = options;
    this.rest = new RestClient({ baseUrl: resolveBaseUrl(options.baseUrl), fetch: options.fetch });
  }

  isReady() {
    return this.readyAt !== null;
  }
  get uptime() {
    return this.readyAt ? Date.now() - this.readyAt.getTime() : null;
  }

  /** Autentica com o token (ou OPENCORD_TOKEN), conecta ao gateway e resolve quando o socket é criado. */
  async login(token?: string): Promise<string> {
    const t = token ?? process.env.OPENCORD_TOKEN;
    if (!t) throw new Error('informe o token: client.login(token) ou a variável OPENCORD_TOKEN');
    if (this.socket) throw new Error('login() já foi chamado; use destroy() antes de conectar de novo');
    this.token = t;
    this.rest.setToken(t);
    const me = await this.rest.get<Me>('/me');
    this.user = new ClientUser(this, me);
    this.users.cache.set(me.id, this.user);
    if (!me.bot) this.emit('debug', 'o token não é de um bot: a conta aparece como pessoa comum');
    await this.application.fetch().catch((e: unknown) => this.emit('debug', `GET /bots/@me falhou: ${String(e)}`));
    this.connect(t);
    return t;
  }

  private connect(token: string) {
    const opts: SocketOptions = { path: SOCKET_PATH, auth: { token }, transports: ['websocket'] };
    const create = this.options.createSocket ?? ((url, o) => io(url, o) as unknown as SocketLike);
    const s = create(this.rest.baseUrl, opts);
    this.socket = s;
    this.on_(s, 'ready', (p) => void this.onReady(p));
    s.on('disconnect', (reason) => {
      this.stopHeartbeat();
      this.emit('disconnect', String(reason));
      this.emit('debug', `gateway desconectado: ${String(reason)}`);
    });
    s.on('connect_error', (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit('debug', `erro de conexão: ${e.message}`);
      // sem ouvinte de 'error', emitir derrubaria o processo a cada tentativa de reconexão
      if (e.message === 'unauthorized' && this.listenerCount('error') > 0) this.emit('error', e);
    });
    this.on_(s, 'chat:message:created', (m) => this.emit('messageCreate', new Message(this, m)));
    this.on_(s, 'chat:message:updated', (m) => this.emit('messageUpdate', null, new Message(this, m)));
    this.on_(s, 'chat:message:deleted', (e) =>
      this.emit(
        'messageDelete',
        new PartialMessage(this, e.messageId, e.channelId ?? e.conversationId ?? '', e.conversationId),
      ),
    );
    this.on_(s, 'chat:reaction:changed', (e) => {
      const msg = new PartialMessage(this, e.messageId, e.channelId ?? e.conversationId ?? '', e.conversationId);
      const reaction = new MessageReaction(this, e.emoji, msg, e.count);
      const user = this.users.cache.get(e.userId) ?? this.stub(e.userId);
      this.emit(e.on ? 'messageReactionAdd' : 'messageReactionRemove', reaction, user);
    });
    this.on_(s, 'interaction:created', (i) => this.emit('interactionCreate', new ChatInputCommandInteraction(this, i)));
    this.on_(s, 'server:member:joined', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      if (!g) return;
      const m = new GuildMember(g, e.member);
      g.members.cache.set(m.id, m);
      this.emit('guildMemberAdd', m);
    });
    this.on_(s, 'server:member:updated', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      if (g) g.members.cache.set(e.member.user.id, new GuildMember(g, e.member));
    });
    this.on_(s, 'server:member:left', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      const m = g?.members.cache.get(e.userId);
      if (!g || !m) return;
      g.members.cache.delete(e.userId);
      this.emit('guildMemberRemove', m);
    });
    this.on_(s, 'server:added', (sum) => void this.addGuild(sum).then((g) => this.emit('guildCreate', g)));
    this.on_(s, 'server:updated', (sum) => {
      const g = this.guilds.cache.get(sum.id);
      if (g) Object.assign(g, { name: sum.name, ownerId: sum.ownerId, iconKey: sum.iconKey });
    });
    this.on_(s, 'server:removed', (e) => this.dropGuild(e.serverId));
    this.on_(s, 'server:deleted', (e) => this.dropGuild(e.serverId));
    this.on_(s, 'channel:created', (c) => this.emit('channelCreate', this.upsertChannel(c)));
    this.on_(s, 'channel:updated', (c) => {
      const old = this.channels.cache.get(c.id) ?? null;
      this.emit('channelUpdate', old, this.upsertChannel(c));
    });
    this.on_(s, 'channel:deleted', (e) => {
      const ch = this.channels.cache.get(e.channelId);
      if (!ch) return;
      this.channels.cache.delete(e.channelId);
      this.guilds.cache.get(e.serverId)?.channels.cache.delete(e.channelId);
      this.emit('channelDelete', ch);
    });
    this.on_(s, 'user:updated', (u) => this.resolveUser(u));
    this.on_(s, 'session:revoked', (e) => {
      this.emit('debug', `sessão revogada: ${e.reason}`);
      if (this.listenerCount('error') > 0) this.emit('error', new Error(`sessão revogada: ${e.reason}`));
    });
  }

  /** registra um evento do gateway desembrulhando o envelope e ignorando duplicados */
  private on_<N extends keyof ServerEvents>(s: SocketLike, name: N, handler: (payload: ServerEvents[N]) => void) {
    s.on(name, (raw: unknown) => {
      const env = raw as EventEnvelope<ServerEvents[N]> | undefined;
      if (!env || typeof env !== 'object' || !('payload' in env)) return;
      if (env.eventId && !this.dedupe(`${name}:${env.eventId}`)) return;
      try {
        handler(env.payload);
      } catch (e) {
        if (this.listenerCount('error') > 0) this.emit('error', e instanceof Error ? e : new Error(String(e)));
        else this.emit('debug', `erro ao tratar ${name}: ${String(e)}`);
      }
    });
  }

  private dedupe(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > 2000) this.seen.delete(this.seenOrder.shift() as string);
    return true;
  }

  private async onReady(p: ServerEvents['ready']) {
    this.startHeartbeat(p.heartbeatIntervalMs);
    this.emit('debug', `gateway pronto (sessão ${p.sessionId}); heartbeat a cada ${p.heartbeatIntervalMs} ms`);
    if (this.options.cache !== false) {
      try {
        await this.loadGuilds();
      } catch (e) {
        this.emit('debug', `falha ao carregar servidores: ${String(e)}`);
      }
    }
    if (this.wasReady) {
      this.emit('resume');
      return;
    }
    this.wasReady = true;
    this.readyAt = new Date();
    this.emit('ready', this);
    this.emit('clientReady', this);
  }

  private async loadGuilds() {
    const list = await this.rest.get<ServerSummary[]>('/servers');
    const keep = new Set(list.map((s) => s.id));
    for (const id of [...this.guilds.cache.keys()]) if (!keep.has(id)) this.dropGuild(id, false);
    await Promise.all(list.map((s) => this.addGuild(s)));
  }

  private async addGuild(sum: ServerSummary): Promise<Guild> {
    const g = this.guilds.cache.get(sum.id) ?? new Guild(this, sum);
    this.guilds.cache.set(sum.id, g);
    try {
      await g.fetch();
    } catch (e) {
      this.emit('debug', `GET /servers/${sum.id} falhou: ${String(e)}`);
    }
    return g;
  }

  private dropGuild(id: string, emit = true) {
    const g = this.guilds.cache.get(id);
    if (!g) return;
    for (const cid of g.channels.cache.keys()) this.channels.cache.delete(cid);
    this.guilds.cache.delete(id);
    if (emit) this.emit('guildDelete', g);
  }

  private startHeartbeat(ms: number) {
    this.stopHeartbeat();
    const beat = () => {
      const s = this.socket;
      if (!s) return;
      const t0 = Date.now();
      s.emit('presence:heartbeat', { status: 'online' }, (ack: unknown) => {
        this.ws.ping = Date.now() - t0;
        if (isAck(ack) && !ack.ok) this.emit('debug', `heartbeat recusado: ${ack.error.message}`);
      });
    };
    beat();
    this.heartbeat = setInterval(beat, ms);
    // não segura o processo vivo sozinho (o socket já faz isso)
    this.heartbeat.unref?.();
  }
  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Encerra o gateway e o heartbeat; o bot aparece offline. */
  destroy() {
    this.stopHeartbeat();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.readyAt = null;
    this.wasReady = false;
  }

  // ---------- caches usados pelas estruturas ----------
  /** devolve o User do cache (atualizado) ou cria um novo */
  resolveUser(data: UserPublic): User {
    const cached = this.users.cache.get(data.id);
    if (cached && cached.username === data.username && cached.displayName === data.displayName) return cached;
    const u = data.id === this.user?.id ? new ClientUser(this, data) : new User(this, data);
    if (u instanceof ClientUser) this.user = u;
    this.users.cache.set(u.id, u);
    return u;
  }
  private stub(id: string): User {
    return new User(this, { id, username: id, displayName: id, avatarKey: null, bot: false });
  }
  upsertChannel(c: ChannelDto): TextChannel {
    const ch = new TextChannel(this, c);
    this.channels.cache.set(ch.id, ch);
    this.guilds.cache.get(c.serverId)?.channels.cache.set(ch.id, ch);
    return ch;
  }
}
