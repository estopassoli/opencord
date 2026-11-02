import { EventEmitter } from 'node:events';
import type {
  ActionRow,
  Bot,
  BotCommand,
  Category as CategoryDto,
  Channel as ChannelDto,
  EventEnvelope,
  InvitePreview,
  Me,
  Message as MessageDto,
  PlayingGame,
  ServerDetail,
  ServerEvents,
  ServerSummary,
  UserPublic,
  UserProfile,
} from '@opencord/contracts';
import { io } from 'socket.io-client';
import { toCommandJSON, type CommandDefinition } from './builders/commands.js';
import { componentTypeOf } from './builders/components.js';
import { Collection } from './collection.js';
import { Status, type ComponentTypeValue, type StatusValue } from './constants.js';
import { RestClient, resolveBaseUrl, type FetchLike, type RateLimitInfo } from './rest.js';
import { fnv1a, resolveShardOptions, ShardClientUtil } from './sharding.js';
import { CategoryChannel, TextChannel, Typing, type Channel } from './structures/channel.js';
import { Guild, GuildBan, GuildMember, GuildScheduledEvent, Invite, Presence, Role } from './structures/guild.js';
import { createInteraction, type Interaction } from './structures/interaction.js';
import { Message, MessageReaction, PartialMessage, Poll } from './structures/message.js';
import { ClientUser, User, type ClientPresenceStatus, type PresenceData } from './structures/user.js';

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
  /** presença inicial (`status`, `activities`) aplicada no `ready` */
  presence?: PresenceData;
  /** fila REST: `concurrency` (4), `retries` (3) e `rateLimitRetries` (5) */
  rest?: { concurrency?: number; retries?: number; rateLimitRetries?: number };
  /** este processo é o shard N (ou `'auto'` pelo ambiente OPENCORD_SHARD_ID) */
  shards?: number | number[] | 'auto';
  shardCount?: number | 'auto';
  shardId?: number;
  /** uso interno/testes: substitui o `fetch` global */
  fetch?: FetchLike;
  /** uso interno/testes: substitui a criação do socket */
  createSocket?: (url: string, opts: SocketOptions) => SocketLike;
}

export interface ClientEvents {
  ready: [client: Client];
  clientReady: [client: Client];
  /** reconectou depois de uma queda (caches recarregados e mensagens perdidas reemitidas) */
  resume: [];
  messageCreate: [message: Message];
  /** não há "mensagem antiga": o primeiro argumento vem null */
  messageUpdate: [oldMessage: Message | null, newMessage: Message];
  messageDelete: [message: PartialMessage];
  messageDeleteBulk: [messages: Collection<string, Message | PartialMessage>, channel: TextChannel];
  messageReactionAdd: [reaction: MessageReaction, user: User];
  messageReactionRemove: [reaction: MessageReaction, user: User];
  messageReactionRemoveAll: [message: PartialMessage, reactions: Collection<string, MessageReaction>];
  interactionCreate: [interaction: Interaction];
  typingStart: [typing: Typing];
  presenceUpdate: [oldPresence: Presence | null, newPresence: Presence];
  pollUpdate: [poll: Poll];
  channelPinsUpdate: [channel: Channel, time: Date];
  guildMemberAdd: [member: GuildMember];
  guildMemberRemove: [member: GuildMember];
  guildMemberUpdate: [oldMember: GuildMember | null, newMember: GuildMember];
  guildBanAdd: [ban: GuildBan];
  guildBanRemove: [ban: GuildBan];
  guildCreate: [guild: Guild];
  guildUpdate: [oldGuild: Guild, newGuild: Guild];
  guildDelete: [guild: Guild];
  roleCreate: [role: Role];
  roleUpdate: [oldRole: Role, newRole: Role];
  roleDelete: [role: Role];
  guildScheduledEventCreate: [event: GuildScheduledEvent];
  guildScheduledEventUpdate: [oldEvent: GuildScheduledEvent | null, newEvent: GuildScheduledEvent];
  guildScheduledEventDelete: [event: GuildScheduledEvent];
  channelCreate: [channel: TextChannel];
  channelUpdate: [oldChannel: TextChannel | null, newChannel: TextChannel];
  channelDelete: [channel: TextChannel];
  categoryCreate: [category: CategoryChannel];
  categoryUpdate: [oldCategory: CategoryChannel, newCategory: CategoryChannel];
  categoryDelete: [category: CategoryChannel];
  userUpdate: [oldUser: User, newUser: User];
  rateLimited: [info: RateLimitInfo];
  warn: [message: string];
  error: [error: Error];
  disconnect: [reason: string];
  debug: [message: string];
}

type Ack<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function isAck(v: unknown): v is Ack {
  return typeof v === 'object' && v !== null && 'ok' in v;
}

const ENV_SHARD_ID = 'OPENCORD_SHARD_ID';
const ENV_SHARD_COUNT = 'OPENCORD_SHARD_COUNT';

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
  /** shard deste processo (null quando não há sharding) */
  readonly shard: ShardClientUtil | null;
  readonly guilds = {
    cache: new Collection<string, Guild>(),
    fetch: async (id: string): Promise<Guild> => {
      const detail = await this.rest.get<ServerDetail>(`/servers/${id}`);
      const g = this.guilds.cache.get(id) ?? new Guild(this, detail);
      this.guilds.cache.set(id, g);
      return g.apply(detail);
    },
    resolve: (id: string) => this.guilds.cache.get(id) ?? null,
  };
  readonly channels = {
    cache: new Collection<string, TextChannel>(),
    fetch: async (id: string): Promise<Channel> => {
      const cached = this.channels.cache.get(id);
      if (cached) return cached;
      // sem rota GET /channels/:id: recarrega os servidores até achar o canal
      for (const g of this.guilds.cache.values()) await g.fetch();
      const found = this.channels.cache.get(id);
      if (!found) throw new Error(`canal ${id} não encontrado nos servidores do bot`);
      return found;
    },
    resolve: (id: string) => this.channels.cache.get(id) ?? null,
  };
  readonly users = {
    cache: new Collection<string, User>(),
    /** `GET /users/:id/profile`: devolve o `User` com `profile` preenchido */
    fetch: async (id: string, opts: { force?: boolean } = {}): Promise<User> => {
      const cached = this.users.cache.get(id);
      if (cached?.profile && !opts.force) return cached;
      const p = await this.rest.get<UserProfile>(`/users/${id}/profile`);
      const u = this.resolveUser(p.user);
      u.profile = {
        createdAt: new Date(p.createdAt),
        friendSince: p.friendSince ? new Date(p.friendSince) : null,
        mutualServers: p.mutualServers,
        mutualFriends: p.mutualFriends,
      };
      return u;
    },
    resolve: (id: string) => this.users.cache.get(id) ?? null,
  };
  /** presença (status, jogo, texto) de quem o bot vê, atualizada pelos eventos */
  readonly presences = { cache: new Collection<string, Presence>() };
  /** o registro do bot (`GET /bots/@me`) e os comandos */
  readonly application = {
    id: null as string | null,
    fetch: async (): Promise<Bot> => {
      const bot = await this.rest.get<Bot>('/bots/@me');
      this.application.id = bot.id;
      return bot;
    },
    commands: {
      cache: new Collection<string, BotCommand>(),
      /**
       * Substitui a lista de comandos (`PUT /bots/@me/commands`). Com `guildId`, substitui só os comandos daquele
       * servidor (os outros ficam) e marca os novos com `guildIds: [guildId]`.
       */
      set: async (commands: CommandDefinition[], guildId?: string): Promise<BotCommand[]> => {
        let list = commands.map(toCommandJSON);
        if (guildId) {
          const current = await this.application.commands.fetch();
          const others = current.filter((c) => !c.guildIds.includes(guildId));
          list = [...others, ...list.map((c) => ({ ...c, guildIds: [guildId] }))];
        }
        const bot = await this.rest.put<Bot>('/bots/@me/commands', { commands: list });
        return this.application.commands.store(bot.commands);
      },
      /** acrescenta um comando (substitui o de mesmo tipo e nome) */
      create: async (command: CommandDefinition, guildId?: string): Promise<BotCommand> => {
        const json = toCommandJSON(command);
        if (guildId) json.guildIds = [guildId];
        const type = json.type ?? 'chat';
        const current = await this.application.commands.fetch();
        const rest = current.filter((c) => !(c.type === type && c.name === json.name));
        const saved = await this.application.commands.set([...rest, json]);
        const found = saved.find((c) => c.type === type && c.name === json.name);
        if (!found) throw new Error(`comando ${json.name} não voltou da API`);
        return found;
      },
      /** remove pelo nome (ou `{ type, name }`) */
      delete: async (command: string | { name: string; type?: BotCommand['type'] }): Promise<void> => {
        const name = typeof command === 'string' ? command : command.name;
        const type = typeof command === 'string' ? undefined : command.type;
        const current = await this.application.commands.fetch();
        await this.application.commands.set(current.filter((c) => !(c.name === name && (!type || c.type === type))));
      },
      fetch: async (): Promise<BotCommand[]> =>
        this.application.commands.store((await this.application.fetch()).commands),
      store: (commands: BotCommand[]) => {
        this.application.commands.cache.clear();
        for (const c of commands) this.application.commands.cache.set(`${c.type}:${c.name}`, c);
        return commands;
      },
    },
  };
  /** latência do último heartbeat (ms; -1 antes do primeiro) e estado da conexão */
  readonly ws: { ping: number; status: StatusValue } = { ping: -1, status: Status.Idle };
  readyAt: Date | null = null;
  /** status enviado no heartbeat (`setStatus`) */
  presenceStatus: ClientPresenceStatus = 'online';
  /** jogo atual (`setActivity`), reenviado após reconectar */
  activity: PlayingGame | null = null;

  private socket: SocketLike | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private wasReady = false;
  private readonly lastMessageIds = new Map<string, string>();
  private readonly resumedIds = new Set<string>();
  private readonly pinState = new Map<string, string | null>();
  private readonly ephemeralComponents = new Map<string, Map<string, ComponentTypeValue>>();

  constructor(options: ClientOptions = {}) {
    super();
    this.options = options;
    this.rest = new RestClient({ baseUrl: resolveBaseUrl(options.baseUrl), fetch: options.fetch, ...options.rest });
    this.rest.on('rateLimited', (info) => this.emit('rateLimited', info));
    this.rest.on('debug', (m) => this.emit('debug', m));
    const shard = resolveShardOptions(options, process.env[ENV_SHARD_ID], process.env[ENV_SHARD_COUNT]);
    this.shard = shard.count > 1 ? new ShardClientUtil(this, shard.id, shard.count) : null;
    if (options.presence?.status) this.presenceStatus = options.presence.status;
  }

  isReady() {
    return this.readyAt !== null;
  }
  get uptime() {
    return this.readyAt ? Date.now() - this.readyAt.getTime() : null;
  }
  /** este servidor é deste shard? (sem sharding: sempre) */
  inShard(guildId: string): boolean {
    if (!this.shard) return true;
    return fnv1a(guildId) % this.shard.count === this.shard.id;
  }

  /** Autentica com o token (ou OPENCORD_TOKEN), conecta ao gateway e resolve quando o socket é criado. */
  async login(token?: string): Promise<string> {
    const t = token ?? process.env.OPENCORD_TOKEN;
    if (!t) throw new Error('informe o token: client.login(token) ou a variável OPENCORD_TOKEN');
    if (this.socket) throw new Error('login() já foi chamado; use destroy() antes de conectar de novo');
    this.token = t;
    this.rest.setToken(t);
    this.ws.status = Status.Connecting;
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
      this.ws.status = Status.Disconnected;
      this.emit('disconnect', String(reason));
      this.emit('debug', `gateway desconectado: ${String(reason)}`);
    });
    s.on('connect_error', (err) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit('debug', `erro de conexão: ${e.message}`);
      // sem ouvinte de 'error', emitir derrubaria o processo a cada tentativa de reconexão
      if (e.message === 'unauthorized' && this.listenerCount('error') > 0) this.emit('error', e);
    });

    // ---- mensagens ----
    this.on_(s, 'chat:message:created', (m) => this.handleMessageCreated(m, false));
    this.on_(s, 'chat:message:updated', (m) => {
      if (!this.channelInShard(m.channelId, m.conversationId)) return;
      const msg = new Message(this, m);
      const before = this.pinState.get(m.id);
      const now = m.pinnedAt ?? null;
      this.rememberPin(m.id, now);
      this.emit('messageUpdate', null, msg);
      if ((before !== undefined && before !== now) || (before === undefined && now !== null))
        this.emit('channelPinsUpdate', msg.channel, now ? new Date(now) : new Date());
    });
    this.on_(s, 'chat:message:deleted', (e) => {
      if (!this.channelInShard(e.channelId, e.conversationId)) return;
      this.pinState.delete(e.messageId);
      this.emit(
        'messageDelete',
        new PartialMessage(this, e.messageId, e.channelId ?? e.conversationId ?? '', e.conversationId),
      );
    });
    this.on_(s, 'chat:reaction:changed', (e) => {
      if (!this.channelInShard(e.channelId, e.conversationId)) return;
      const msg = new PartialMessage(this, e.messageId, e.channelId ?? e.conversationId ?? '', e.conversationId);
      const reaction = new MessageReaction(this, e.emoji, msg, e.count, e.on ? [e.userId] : []);
      const user = this.users.cache.get(e.userId) ?? this.stub(e.userId);
      this.emit(e.on ? 'messageReactionAdd' : 'messageReactionRemove', reaction, user);
    });
    this.on_(s, 'chat:reactions:cleared', (e) => {
      if (!this.channelInShard(e.channelId, e.conversationId)) return;
      const msg = new PartialMessage(this, e.messageId, e.channelId ?? e.conversationId ?? '', e.conversationId);
      this.emit('messageReactionRemoveAll', msg, new Collection());
    });
    this.on_(s, 'chat:typing', (e) => {
      if (!e.active || !this.channelInShard(e.channelId, e.conversationId)) return;
      const channel = e.conversationId
        ? new PartialMessage(this, '', e.conversationId, e.conversationId).channel
        : (this.channels.cache.get(e.channelId ?? '') ?? null);
      if (!channel) return;
      this.emit('typingStart', new Typing(channel, this.users.cache.get(e.userId) ?? this.stub(e.userId)));
    });
    this.on_(s, 'poll:updated', (e) => {
      if (!this.channelInShard(e.channelId, e.conversationId)) return;
      const msg = new PartialMessage(this, e.messageId, e.channelId ?? e.conversationId ?? '', e.conversationId);
      this.emit('pollUpdate', new Poll(this, e.poll, msg));
    });

    // ---- interações ----
    this.on_(s, 'interaction:created', (i) => {
      if (!this.inShard(i.serverId)) return;
      this.emit('interactionCreate', createInteraction(this, i));
    });

    // ---- membros, banimentos ----
    this.on_(s, 'server:member:joined', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      if (!g) return;
      const m = new GuildMember(g, e.member);
      g.members.cache.set(m.id, m);
      this.emit('guildMemberAdd', m);
    });
    this.on_(s, 'server:member:updated', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      if (!g) return;
      const old = g.members.cache.get(e.member.user.id) ?? null;
      const m = new GuildMember(g, e.member);
      g.members.cache.set(m.id, m);
      this.emit('guildMemberUpdate', old, m);
    });
    this.on_(s, 'server:member:left', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      const m = g?.members.cache.get(e.userId);
      if (!g || !m) return;
      g.members.cache.delete(e.userId);
      this.emit('guildMemberRemove', m);
    });
    this.on_(s, 'server:ban:added', (b) => {
      const g = this.guilds.cache.get(b.serverId);
      if (!g) return;
      const ban = new GuildBan(g, b);
      g.bans.cache.set(ban.user.id, ban);
      this.emit('guildBanAdd', ban);
    });
    this.on_(s, 'server:ban:removed', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      if (!g) return;
      const ban =
        g.bans.cache.get(e.userId) ??
        new GuildBan(g, {
          user: (this.users.cache.get(e.userId) ?? this.stub(e.userId)).toJSON(),
          reason: null,
          by: null,
          createdAt: null,
        });
      g.bans.cache.delete(e.userId);
      this.emit('guildBanRemove', ban);
    });

    // ---- servidores ----
    this.on_(s, 'server:added', (sum) => {
      if (!this.inShard(sum.id)) return;
      void this.addGuild(sum).then((g) => this.emit('guildCreate', g));
    });
    this.on_(s, 'server:updated', (sum) => {
      const g = this.guilds.cache.get(sum.id);
      if (!g) return;
      const old = g._clone();
      g.applySummary(sum);
      this.emit('guildUpdate', old, g);
    });
    this.on_(s, 'server:removed', (e) => this.dropGuild(e.serverId));
    this.on_(s, 'server:deleted', (e) => this.dropGuild(e.serverId));

    // ---- canais, categorias, cargos ----
    this.on_(s, 'channel:created', (c) => {
      if (!this.inShard(c.serverId)) return;
      this.emit('channelCreate', this.upsertChannel(c));
    });
    this.on_(s, 'channel:updated', (c) => {
      if (!this.inShard(c.serverId)) return;
      const old = this.channels.cache.get(c.id) ?? null;
      this.emit('channelUpdate', old, this.upsertChannel(c));
    });
    this.on_(s, 'channel:deleted', (e) => {
      const ch = this.channels.cache.get(e.channelId);
      if (!ch) return;
      this.channels.cache.delete(e.channelId);
      this.lastMessageIds.delete(e.channelId);
      this.guilds.cache.get(e.serverId)?.channels.cache.delete(e.channelId);
      this.emit('channelDelete', ch);
    });
    this.on_(s, 'category:upserted', (c) => {
      const g = this.guilds.cache.get(c.serverId);
      if (!g) return;
      const old = g.categories.cache.get(c.id) ?? null;
      const cat = this.upsertCategory(c);
      if (old) this.emit('categoryUpdate', old, cat);
      else this.emit('categoryCreate', cat);
    });
    this.on_(s, 'category:deleted', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      const cat = g?.categories.cache.get(e.categoryId);
      if (!g || !cat) return;
      g.categories.cache.delete(e.categoryId);
      this.emit('categoryDelete', cat);
    });
    this.on_(s, 'role:upserted', (r) => {
      const g = this.guilds.cache.get(r.serverId);
      if (!g) return;
      const old = g.roles.cache.get(r.id) ?? null;
      const role = new Role(g, r);
      g.roles.cache.set(role.id, role);
      if (old) this.emit('roleUpdate', old, role);
      else this.emit('roleCreate', role);
    });
    this.on_(s, 'role:deleted', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      const role = g?.roles.cache.get(e.roleId);
      if (!g || !role) return;
      g.roles.cache.delete(e.roleId);
      this.emit('roleDelete', role);
    });
    this.on_(s, 'permissions:changed', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      if (g)
        void g
          .fetch()
          .catch((err: unknown) => this.emit('debug', `recarga após permissions:changed falhou: ${String(err)}`));
    });

    // ---- eventos do servidor ----
    this.on_(s, 'event:changed', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      if (!g) return;
      const old = g.scheduledEvents.cache.get(e.event.id) ?? null;
      const ev = new GuildScheduledEvent(this, e.event);
      g.scheduledEvents.cache.set(ev.id, ev);
      if (old) this.emit('guildScheduledEventUpdate', old, ev);
      else this.emit('guildScheduledEventCreate', ev);
    });
    this.on_(s, 'event:deleted', (e) => {
      const g = this.guilds.cache.get(e.serverId);
      const ev = g?.scheduledEvents.cache.get(e.eventId);
      if (!g || !ev) return;
      g.scheduledEvents.cache.delete(e.eventId);
      this.emit('guildScheduledEventDelete', ev);
    });

    // ---- presença e usuários ----
    this.on_(s, 'presence:changed', (e) => this.updatePresence(e.userId, { status: e.status }));
    this.on_(s, 'presence:game:changed', (e) => this.updatePresence(e.userId, { game: e.game }));
    this.on_(s, 'presence:text:changed', (e) => this.updatePresence(e.userId, { text: e.text }));
    this.on_(s, 'user:updated', (u) => {
      const cached = this.users.cache.get(u.id);
      if (!cached) {
        this.resolveUser(u);
        return;
      }
      const old = cached._clone();
      cached._patch(u);
      this.emit('userUpdate', old, cached);
    });
    this.on_(s, 'session:revoked', (e) => {
      this.emit('debug', `sessão revogada: ${e.reason}`);
      if (this.listenerCount('error') > 0) this.emit('error', new Error(`sessão revogada: ${e.reason}`));
    });
  }

  /**
   * `fromResume`: mensagem reemitida por `sync:resume` — pula as que o bot já viu ao vivo; e uma mensagem reemitida
   * que depois chegue ao vivo (evento atrasado) não é repetida.
   */
  private handleMessageCreated(m: MessageDto, fromResume: boolean) {
    if (fromResume) {
      if (!this.dedupe(`msg:${m.id}`)) return;
      this.resumedIds.add(m.id);
    } else {
      this.dedupe(`msg:${m.id}`);
      if (this.resumedIds.delete(m.id)) return;
    }
    if (!this.channelInShard(m.channelId, m.conversationId)) return;
    if (m.channelId) this.trackMessage(m.channelId, m.id);
    this.rememberPin(m.id, m.pinnedAt ?? null);
    this.emit('messageCreate', new Message(this, m));
  }

  /** evento de canal/conversa pertence a este shard? (DMs ficam no shard 0; canal desconhecido com sharding é ignorado) */
  private channelInShard(channelId: string | null | undefined, conversationId: string | null | undefined): boolean {
    if (!this.shard) return true;
    if (conversationId) return this.shard.id === 0;
    const ch = channelId ? this.channels.cache.get(channelId) : undefined;
    return !!ch && this.inShard(ch.guildId);
  }

  private updatePresence(
    userId: string,
    data: { status?: ServerEvents['presence:changed']['status']; game?: PlayingGame | null; text?: string | null },
  ) {
    const current = this.presences.cache.get(userId);
    const old = current?._clone() ?? null;
    const p = current ?? new Presence(this, userId);
    if (data.status !== undefined) p.status = data.status;
    if (data.game !== undefined)
      p.activities = data.game ? [new Presence(this, userId, { game: data.game }).activities[0]!] : [];
    if (data.text !== undefined) p.statusText = data.text;
    this.presences.cache.set(userId, p);
    for (const g of this.guilds.cache.values()) if (g.members.cache.has(userId)) g.presences.cache.set(userId, p);
    this.emit('presenceUpdate', old, p);
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
    if (this.seenOrder.length > 5000) this.seen.delete(this.seenOrder.shift() as string);
    return true;
  }
  private rememberPin(messageId: string, pinnedAt: string | null) {
    this.pinState.set(messageId, pinnedAt);
    if (this.pinState.size > 5000) this.pinState.delete(this.pinState.keys().next().value as string);
  }

  private async onReady(p: ServerEvents['ready']) {
    this.startHeartbeat(p.heartbeatIntervalMs);
    this.ws.status = Status.Ready;
    this.emit('debug', `gateway pronto (sessão ${p.sessionId}); heartbeat a cada ${p.heartbeatIntervalMs} ms`);
    if (this.options.cache !== false) {
      try {
        await this.loadGuilds();
      } catch (e) {
        this.emit('debug', `falha ao carregar servidores: ${String(e)}`);
      }
    }
    if (this.activity) void this.sendGame(this.activity).catch(() => undefined);
    if (this.wasReady) {
      await this.syncResume();
      this.emit('resume');
      return;
    }
    this.wasReady = true;
    this.readyAt = new Date();
    if (this.options.presence && this.user) {
      await this.user
        .setPresence(this.options.presence)
        .catch((e: unknown) => this.emit('debug', `presença inicial falhou: ${String(e)}`));
    }
    this.emit('ready', this);
    this.emit('clientReady', this);
  }

  /** `sync:resume` com a última mensagem vista por canal; reemite `messageCreate` do que perdeu (sem repetir) */
  private syncResume(): Promise<void> {
    const s = this.socket;
    const channels = [...this.lastMessageIds]
      .filter(([channelId]) => this.channels.cache.has(channelId))
      .slice(0, 500)
      .map(([channelId, lastMessageId]) => ({ channelId, lastMessageId }));
    if (!s || !channels.length) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (ack: unknown) => {
        if (!isAck(ack)) {
          resolve();
          return;
        }
        if (!ack.ok) {
          this.emit('debug', `sync:resume recusado: ${ack.error.message}`);
          resolve();
          return;
        }
        const data = ack.data as { missed?: MessageDto[]; truncated?: boolean } | null;
        const missed = data?.missed ?? [];
        this.emit(
          'debug',
          `retomada: ${missed.length} mensagem(ns) perdida(s)${data?.truncated ? ' (lista truncada)' : ''}`,
        );
        for (const m of missed) {
          try {
            this.handleMessageCreated(m, true);
          } catch (e) {
            this.emit('debug', `erro ao reemitir mensagem perdida: ${String(e)}`);
          }
        }
        if (data?.truncated)
          this.emit(
            'warn',
            'retomada truncada: pode haver mensagens perdidas além das reemitidas (use channel.messages.fetch)',
          );
        resolve();
      };
      try {
        s.emit('sync:resume', { channels }, done);
      } catch (e) {
        this.emit('debug', `sync:resume falhou: ${String(e)}`);
        resolve();
      }
    });
  }

  private async loadGuilds() {
    const list = (await this.rest.get<ServerSummary[]>('/servers')).filter((s) => this.inShard(s.id));
    const keep = new Set(list.map((s) => s.id));
    for (const id of [...this.guilds.cache.keys()]) if (!keep.has(id)) this.dropGuild(id, false);
    await Promise.all(list.map((s) => this.addGuild(s)));
  }

  private async addGuild(sum: ServerSummary): Promise<Guild> {
    const g = this.guilds.cache.get(sum.id) ?? new Guild(this, sum);
    g.applySummary(sum);
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
    for (const cid of g.channels.cache.keys()) {
      this.channels.cache.delete(cid);
      this.lastMessageIds.delete(cid);
    }
    this.guilds.cache.delete(id);
    if (emit) this.emit('guildDelete', g);
  }

  private startHeartbeat(ms: number) {
    this.stopHeartbeat();
    const beat = () => {
      const s = this.socket;
      if (!s) return;
      const t0 = Date.now();
      s.emit('presence:heartbeat', { status: this.presenceStatus }, (ack: unknown) => {
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

  /** comando do gateway com ack (`chat:typing:start`, `presence:game`…) */
  private command(name: string, payload: unknown): Promise<void> {
    const s = this.socket;
    if (!s) return Promise.reject(new Error('gateway desconectado: chame login() antes'));
    return new Promise((resolve, reject) => {
      s.emit(name, payload, (ack: unknown) => {
        if (isAck(ack) && !ack.ok) reject(new Error(`${name}: ${ack.error.message}`));
        else resolve();
      });
    });
  }
  /** "digitando…" num canal ou conversa */
  sendTyping(target: { channelId: string } | { conversationId: string }): Promise<void> {
    return this.command('chat:typing:start', target);
  }
  /** jogo que o bot está "jogando" (null limpa) */
  sendGame(game: PlayingGame | null): Promise<void> {
    return this.command('presence:game', { game });
  }

  /** prévia de um convite (`GET /invites/:code`); aceita o código ou o link inteiro */
  async fetchInvite(code: string): Promise<Invite> {
    const c = code.trim().split('/').pop() ?? code;
    const dto = await this.rest.get<InvitePreview>(`/invites/${encodeURIComponent(c)}`);
    return new Invite(this, dto);
  }

  /** Encerra o gateway e o heartbeat; o bot aparece offline. */
  destroy() {
    this.stopHeartbeat();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.readyAt = null;
    this.wasReady = false;
    this.ws.status = Status.Idle;
  }

  // ---------- caches usados pelas estruturas ----------
  /** devolve o User do cache (atualizado no lugar) ou cria um novo */
  resolveUser(data: UserPublic): User {
    const cached = this.users.cache.get(data.id);
    if (cached) return cached._patch(data);
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
  upsertCategory(c: CategoryDto): CategoryChannel {
    const cat = new CategoryChannel(this, c);
    this.guilds.cache.get(c.serverId)?.categories.cache.set(cat.id, cat);
    return cat;
  }
  /** guarda a última mensagem vista num canal (para `sync:resume`) */
  trackMessage(channelId: string, messageId: string) {
    this.lastMessageIds.set(channelId, messageId);
  }
  lastMessageIdOf(channelId: string): string | null {
    return this.lastMessageIds.get(channelId) ?? null;
  }
  /** cartões efêmeros com botões: guarda o tipo de cada componente para reconhecer o clique (`ephemeralOf`) */
  rememberEphemeralComponents(interactionId: string, rows: readonly ActionRow[]) {
    const map = new Map<string, ComponentTypeValue>();
    for (const row of rows)
      for (const c of row.components)
        if ('customId' in c && c.customId) map.set(c.customId, componentTypeOf([row], c.customId) ?? 'button');
    this.ephemeralComponents.set(interactionId, map);
    if (this.ephemeralComponents.size > 1000)
      this.ephemeralComponents.delete(this.ephemeralComponents.keys().next().value as string);
  }
  ephemeralComponentType(interactionId: string, customId: string): ComponentTypeValue | null {
    return this.ephemeralComponents.get(interactionId)?.get(customId) ?? null;
  }
}
