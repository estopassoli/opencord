import { randomUUID } from 'node:crypto';
import type {
  Channel as ChannelDto,
  Conversation,
  Interaction as InteractionDto,
  InteractionOptionValue,
  InteractionReplyResponse,
  Member as MemberDto,
  Message as MessageDto,
  MessagePage,
  Role as RoleDto,
  ServerDetail,
  UserPublic,
} from '@opencord/contracts';
import type { Client } from './client.js';
import { composeContent, type EmbedLike } from './embed.js';

// ---------- opções de envio ----------
export interface MessageCreateOptions {
  content?: string;
  embeds?: EmbedLike[];
  /** responder a uma mensagem (id ou a própria mensagem) */
  reply?: { messageReference: string | { id: string } };
}
export type MessagePayload = string | MessageCreateOptions;

function normalize(payload: MessagePayload): { body: string; replyToId?: string } {
  if (typeof payload === 'string') return { body: composeContent(payload, undefined) };
  const ref = payload.reply?.messageReference;
  const replyToId = typeof ref === 'string' ? ref : ref?.id;
  return { body: composeContent(payload.content, payload.embeds), ...(replyToId ? { replyToId } : {}) };
}

/** Cria uma mensagem num canal (`channelId`) ou numa conversa direta (`conversationId`). */
export async function sendMessage(
  client: Client,
  target: { channelId: string } | { conversationId: string },
  payload: MessagePayload,
): Promise<Message> {
  const path =
    'channelId' in target
      ? `/channels/${target.channelId}/messages`
      : `/conversations/${target.conversationId}/messages`;
  const dto = await client.rest.post<MessageDto>(path, { requestId: randomUUID(), ...normalize(payload) });
  return new Message(client, dto);
}

// ---------- usuários ----------
export class User {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly bot: boolean;
  readonly avatarKey: string | null;

  constructor(
    readonly client: Client,
    data: UserPublic,
  ) {
    this.id = data.id;
    this.username = data.username;
    this.displayName = data.displayName;
    this.bot = data.bot;
    this.avatarKey = data.avatarKey;
  }

  /** não há discriminador: a tag é o próprio nome de usuário */
  get tag() {
    return this.username;
  }
  get globalName() {
    return this.displayName;
  }
  /** menção no formato do OpenCord (`<@id>`) */
  toString() {
    return `<@${this.id}>`;
  }
  /** abre (ou reaproveita) a conversa direta com a pessoa */
  async createDM(): Promise<DMChannel> {
    const conv = await this.client.rest.post<Conversation>('/conversations', { userIds: [this.id] });
    return new DMChannel(this.client, conv.id);
  }
  async send(payload: MessagePayload): Promise<Message> {
    const dm = await this.createDM();
    return dm.send(payload);
  }
}

export class ClientUser extends User {}

/** Usuário de quem só se conhece o id (menção, opção de comando) e que não está no cache. */
export function stubUser(client: Client, id: string): User {
  return new User(client, { id, username: id, displayName: id, avatarKey: null, bot: false });
}

// ---------- servidores (guilds) ----------
export class Role {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly permissions: number;
  readonly color: string | null;
  readonly isEveryone: boolean;
  constructor(
    readonly guild: Guild,
    data: RoleDto,
  ) {
    this.id = data.id;
    this.name = data.name;
    this.position = data.position;
    this.permissions = data.permissions;
    this.color = data.color;
    this.isEveryone = data.isEveryone;
  }
  toString() {
    return this.name;
  }
}

export class GuildMember {
  readonly user: User;
  readonly nickname: string | null;
  readonly joinedAt: Date;
  readonly roleIds: readonly string[];
  constructor(
    readonly guild: Guild,
    data: MemberDto,
  ) {
    this.user = guild.client.resolveUser(data.user);
    this.nickname = data.nickname;
    this.joinedAt = new Date(data.joinedAt);
    this.roleIds = data.roleIds;
  }
  get id() {
    return this.user.id;
  }
  get guildId() {
    return this.guild.id;
  }
  get client() {
    return this.guild.client;
  }
  get displayName() {
    return this.nickname ?? this.user.displayName;
  }
  get roles() {
    const cache = new Map<string, Role>();
    for (const id of this.roleIds) {
      const r = this.guild.roles.cache.get(id);
      if (r) cache.set(id, r);
    }
    return { cache };
  }
  /** permissões efetivas do membro no servidor (bits do contrato `Permission`) */
  get permissions(): number {
    let bits = 0;
    for (const r of this.roles.cache.values()) bits |= r.permissions;
    return bits;
  }
  toString() {
    return this.user.toString();
  }
  send(payload: MessagePayload) {
    return this.user.send(payload);
  }
}

export class Guild {
  readonly id: string;
  name: string;
  ownerId: string;
  iconKey: string | null;
  readonly channels = { cache: new Map<string, TextChannel>() };
  readonly members = {
    cache: new Map<string, GuildMember>(),
    fetch: async (id?: string): Promise<GuildMember | Map<string, GuildMember>> => {
      await this.fetch();
      if (id === undefined) return this.members.cache;
      const m = this.members.cache.get(id);
      if (!m) throw new Error(`membro ${id} não encontrado em ${this.name}`);
      return m;
    },
  };
  readonly roles = { cache: new Map<string, Role>() };
  /** permissões do bot no servidor */
  myPermissions = 0;

  constructor(
    readonly client: Client,
    data: { id: string; name: string; ownerId: string; iconKey: string | null },
  ) {
    this.id = data.id;
    this.name = data.name;
    this.ownerId = data.ownerId;
    this.iconKey = data.iconKey;
  }

  /** aplica o detalhe (`GET /servers/:id`) nos caches */
  apply(detail: ServerDetail) {
    this.name = detail.name;
    this.ownerId = detail.ownerId;
    this.iconKey = detail.iconKey;
    this.myPermissions = detail.myPermissions;
    this.roles.cache.clear();
    for (const r of detail.roles) this.roles.cache.set(r.id, new Role(this, r));
    this.channels.cache.clear();
    for (const c of detail.channels) this.client.upsertChannel(c);
    this.members.cache.clear();
    for (const m of detail.members) this.members.cache.set(m.user.id, new GuildMember(this, m));
    return this;
  }

  /** recarrega canais, cargos e membros */
  async fetch(): Promise<this> {
    this.apply(await this.client.rest.get<ServerDetail>(`/servers/${this.id}`));
    return this;
  }
  get memberCount() {
    return this.members.cache.size;
  }
  toString() {
    return this.name;
  }
}

// ---------- canais ----------
export class TextChannel {
  readonly id: string;
  readonly guildId: string;
  name: string;
  topic: string | null;
  /** 'text' | 'voice' | 'board' */
  type: ChannelDto['kind'];
  /** permissões do bot neste canal */
  myPermissions: number;
  readonly messages = {
    fetch: async (opts: { limit?: number; before?: string } = {}): Promise<Map<string, Message>> => {
      const q = new URLSearchParams();
      if (opts.limit) q.set('limit', String(opts.limit));
      if (opts.before) q.set('before', opts.before);
      const page = await this.client.rest.get<MessagePage>(`/channels/${this.id}/messages?${q}`);
      return new Map(page.messages.map((m) => [m.id, new Message(this.client, m)]));
    },
  };

  constructor(
    readonly client: Client,
    data: ChannelDto,
  ) {
    this.id = data.id;
    this.guildId = data.serverId;
    this.name = data.name;
    this.topic = data.topic;
    this.type = data.kind;
    this.myPermissions = data.myPermissions;
  }

  get guild(): Guild | null {
    return this.client.guilds.cache.get(this.guildId) ?? null;
  }
  isTextBased() {
    return this.type === 'text';
  }
  isDMBased() {
    return false;
  }
  isVoiceBased() {
    return this.type === 'voice';
  }
  send(payload: MessagePayload) {
    return sendMessage(this.client, { channelId: this.id }, payload);
  }
  toString() {
    return `#${this.name}`;
  }
}

/** Conversa direta (DM ou grupo). */
export class DMChannel {
  readonly guildId = null;
  readonly type = 'dm' as const;
  readonly messages = {
    fetch: async (opts: { limit?: number; before?: string } = {}): Promise<Map<string, Message>> => {
      const q = new URLSearchParams();
      if (opts.limit) q.set('limit', String(opts.limit));
      if (opts.before) q.set('before', opts.before);
      const page = await this.client.rest.get<MessagePage>(`/conversations/${this.id}/messages?${q}`);
      return new Map(page.messages.map((m) => [m.id, new Message(this.client, m)]));
    },
  };
  constructor(
    readonly client: Client,
    readonly id: string,
  ) {}
  get guild(): null {
    return null;
  }
  isTextBased() {
    return true;
  }
  isDMBased() {
    return true;
  }
  isVoiceBased() {
    return false;
  }
  send(payload: MessagePayload) {
    return sendMessage(this.client, { conversationId: this.id }, payload);
  }
}

export type Channel = TextChannel | DMChannel;

/** Canal de texto fora do cache (ex.: opção de comando apontando para um canal que o bot ainda não carregou). */
export function stubChannel(client: Client, id: string, guildId: string): TextChannel {
  return new TextChannel(client, {
    id,
    serverId: guildId,
    categoryId: null,
    kind: 'text',
    name: id,
    topic: null,
    position: 0,
    myPermissions: 0,
    overrides: [],
    boardId: null,
    roomHub: false,
    temporary: false,
  });
}

// ---------- mensagens ----------
export class MessageMentions {
  readonly users: Map<string, User>;
  readonly everyone: boolean;
  constructor(
    client: Client,
    readonly userIds: readonly string[],
    body: string,
  ) {
    this.users = new Map(userIds.map((id) => [id, client.users.cache.get(id) ?? stubUser(client, id)]));
    this.everyone = /(^|\s)@everyone\b/.test(body);
  }
  has(user: string | { id: string }) {
    const id = typeof user === 'string' ? user : user.id;
    return this.userIds.includes(id) || (this.everyone && id === 'everyone');
  }
}

export interface MessageReference {
  messageId: string;
  channelId: string;
  guildId: string | null;
}

export class Message {
  readonly id: string;
  content: string;
  readonly author: User;
  /** id do canal, ou da conversa direta quando é DM */
  readonly channelId: string;
  readonly conversationId: string | null;
  readonly createdAt: Date;
  editedAt: Date | null;
  readonly deleted: boolean;
  readonly mentions: MessageMentions;
  readonly reference: MessageReference | null;
  readonly reactions: readonly { emoji: string; count: number; userIds: readonly string[] }[];
  readonly attachments: MessageDto['attachments'];
  readonly pinnedAt: Date | null;
  readonly partial = false as const;

  constructor(
    readonly client: Client,
    data: MessageDto,
  ) {
    this.id = data.id;
    this.content = data.body;
    this.author = client.resolveUser(data.author);
    this.conversationId = data.conversationId;
    this.channelId = data.channelId ?? data.conversationId ?? '';
    this.createdAt = new Date(data.createdAt);
    this.editedAt = data.editedAt ? new Date(data.editedAt) : null;
    this.deleted = data.deleted;
    this.mentions = new MessageMentions(client, data.mentions, data.body);
    this.reference = data.replyTo
      ? { messageId: data.replyTo.id, channelId: this.channelId, guildId: this.guildId }
      : null;
    this.reactions = data.reactions.map((r) => ({ emoji: r.emoji, count: r.count, userIds: r.userIds }));
    this.attachments = data.attachments;
    this.pinnedAt = data.pinnedAt ? new Date(data.pinnedAt) : null;
  }

  get channel(): Channel {
    if (this.conversationId) return new DMChannel(this.client, this.conversationId);
    return this.client.channels.cache.get(this.channelId) ?? stubChannel(this.client, this.channelId, '');
  }
  get guildId(): string | null {
    if (this.conversationId) return null;
    return this.client.channels.cache.get(this.channelId)?.guildId ?? null;
  }
  get guild(): Guild | null {
    const id = this.guildId;
    return id ? (this.client.guilds.cache.get(id) ?? null) : null;
  }
  get member(): GuildMember | null {
    return this.guild?.members.cache.get(this.author.id) ?? null;
  }
  get createdTimestamp() {
    return this.createdAt.getTime();
  }
  get url() {
    return `${this.client.rest.baseUrl}/messages/${this.id}`;
  }
  inGuild() {
    return this.conversationId === null;
  }

  /** responde citando esta mensagem */
  reply(payload: MessagePayload): Promise<Message> {
    const opts: MessageCreateOptions = typeof payload === 'string' ? { content: payload } : { ...payload };
    opts.reply = { messageReference: this.id };
    return sendMessage(
      this.client,
      this.conversationId ? { conversationId: this.conversationId } : { channelId: this.channelId },
      opts,
    );
  }
  async react(emoji: string): Promise<this> {
    await this.client.rest.put(`/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`);
    return this;
  }
  async unreact(emoji: string): Promise<this> {
    await this.client.rest.delete(`/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`);
    return this;
  }
  async edit(payload: MessagePayload): Promise<Message> {
    const { body } = normalize(payload);
    const dto = await this.client.rest.patch<MessageDto>(`/messages/${this.id}`, { body });
    return new Message(this.client, dto);
  }
  async delete(): Promise<this> {
    await this.client.rest.delete(`/messages/${this.id}`);
    return this;
  }
  async pin(): Promise<this> {
    await this.client.rest.put(`/messages/${this.id}/pin`);
    return this;
  }
  async unpin(): Promise<this> {
    await this.client.rest.delete(`/messages/${this.id}/pin`);
    return this;
  }
  toString() {
    return this.content;
  }
}

/** Mensagem de que só se sabe o id (evento de exclusão ou reação). */
export class PartialMessage {
  readonly partial = true as const;
  constructor(
    readonly client: Client,
    readonly id: string,
    readonly channelId: string,
    readonly conversationId: string | null,
  ) {}
  get guildId(): string | null {
    if (this.conversationId) return null;
    return this.client.channels.cache.get(this.channelId)?.guildId ?? null;
  }
  get guild(): Guild | null {
    const id = this.guildId;
    return id ? (this.client.guilds.cache.get(id) ?? null) : null;
  }
  get channel(): Channel {
    if (this.conversationId) return new DMChannel(this.client, this.conversationId);
    return this.client.channels.cache.get(this.channelId) ?? stubChannel(this.client, this.channelId, '');
  }
  inGuild() {
    return this.conversationId === null;
  }
  async fetch(): Promise<Message> {
    // não há GET /messages/:id: busca na página mais recente do canal
    const q = `?limit=100`;
    const path = this.conversationId
      ? `/conversations/${this.conversationId}/messages${q}`
      : `/channels/${this.channelId}/messages${q}`;
    const page = await this.client.rest.get<MessagePage>(path);
    const dto = page.messages.find((m) => m.id === this.id);
    if (!dto) throw new Error(`mensagem ${this.id} não encontrada entre as 100 mais recentes`);
    return new Message(this.client, dto);
  }
  react(emoji: string) {
    return this.client.rest.put(`/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`).then(() => this);
  }
  delete() {
    return this.client.rest.delete(`/messages/${this.id}`).then(() => this);
  }
}

export class MessageReaction {
  readonly emoji: { name: string; toString(): string };
  constructor(
    readonly client: Client,
    emoji: string,
    readonly message: PartialMessage,
    readonly count: number,
  ) {
    this.emoji = { name: emoji, toString: () => emoji };
  }
  /** a reação é do próprio bot? (o evento não diz; sempre false) */
  readonly me = false;
}

// ---------- interações (comandos de barra) ----------
type OptionType = 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'channel';

export interface CommandInteractionOption {
  name: string;
  value: InteractionOptionValue;
}

export class CommandInteractionOptionResolver {
  constructor(
    private readonly client: Client,
    private readonly values: Readonly<Record<string, InteractionOptionValue>>,
    private readonly guildId: string,
  ) {}

  /** `required` lança se a opção não veio (como a comunidade espera) */
  get(name: string, required?: false): CommandInteractionOption | null;
  get(name: string, required: true): CommandInteractionOption;
  get(name: string, required = false): CommandInteractionOption | null {
    const value = this.values[name];
    if (value === undefined) {
      if (required) throw new Error(`opção obrigatória "${name}" não informada`);
      return null;
    }
    return { name, value };
  }
  private typed<T>(name: string, type: OptionType, required: boolean, pick: (v: InteractionOptionValue) => T | null) {
    const opt = this.get(name, false);
    if (!opt) {
      if (required) throw new Error(`opção obrigatória "${name}" não informada`);
      return null;
    }
    const v = pick(opt.value);
    if (v === null) throw new Error(`opção "${name}" não é ${type}`);
    return v;
  }
  getString(name: string, required?: false): string | null;
  getString(name: string, required: true): string;
  getString(name: string, required = false) {
    return this.typed(name, 'string', required, (v) => (typeof v === 'string' ? v : String(v)));
  }
  getInteger(name: string, required?: false): number | null;
  getInteger(name: string, required: true): number;
  getInteger(name: string, required = false) {
    return this.typed(name, 'integer', required, (v) => (typeof v === 'number' ? Math.trunc(v) : null));
  }
  getNumber(name: string, required?: false): number | null;
  getNumber(name: string, required: true): number;
  getNumber(name: string, required = false) {
    return this.typed(name, 'number', required, (v) => (typeof v === 'number' ? v : null));
  }
  getBoolean(name: string, required?: false): boolean | null;
  getBoolean(name: string, required: true): boolean;
  getBoolean(name: string, required = false) {
    return this.typed(name, 'boolean', required, (v) => (typeof v === 'boolean' ? v : null));
  }
  getUser(name: string, required?: false): User | null;
  getUser(name: string, required: true): User;
  getUser(name: string, required = false) {
    return this.typed(name, 'user', required, (v) =>
      typeof v === 'string' ? (this.client.users.cache.get(v) ?? stubUser(this.client, v)) : null,
    );
  }
  getMember(name: string): GuildMember | null {
    const u = this.getUser(name, false);
    return u ? (this.client.guilds.cache.get(this.guildId)?.members.cache.get(u.id) ?? null) : null;
  }
  getChannel(name: string, required?: false): TextChannel | null;
  getChannel(name: string, required: true): TextChannel;
  getChannel(name: string, required = false) {
    return this.typed(name, 'channel', required, (v) =>
      typeof v === 'string' ? (this.client.channels.cache.get(v) ?? stubChannel(this.client, v, this.guildId)) : null,
    );
  }
  /** sem subcomandos nesta fase */
  getSubcommand(required?: boolean): string | null {
    if (required) throw new Error('subcomandos não existem no OpenCord');
    return null;
  }
  get data(): CommandInteractionOption[] {
    return Object.entries(this.values).map(([name, value]) => ({ name, value }));
  }
}

export interface InteractionReplyOptions {
  content?: string;
  embeds?: EmbedLike[];
  /** só quem usou o comando vê (não vira mensagem no canal) */
  ephemeral?: boolean;
}
export type InteractionReplyPayload = string | InteractionReplyOptions;

export class ChatInputCommandInteraction {
  readonly id: string;
  readonly commandName: string;
  readonly user: User;
  readonly channelId: string;
  readonly guildId: string;
  readonly createdAt: Date;
  readonly options: CommandInteractionOptionResolver;
  readonly type = 2 as const;
  /** já respondeu (`reply`/`editReply` após `defer`) */
  replied = false;
  /** acusou recebimento ("pensando…") e ainda vai responder */
  deferred = false;
  /** se respondeu com mensagem no canal, o id dela (null para efêmera) */
  private messageId: string | null = null;
  private ephemeral = false;

  constructor(
    readonly client: Client,
    data: InteractionDto,
  ) {
    this.id = data.id;
    this.commandName = data.command;
    this.user = client.resolveUser(data.user);
    this.channelId = data.channelId;
    this.guildId = data.serverId;
    this.createdAt = new Date(data.createdAt);
    this.options = new CommandInteractionOptionResolver(client, data.options, data.serverId);
  }

  get channel(): TextChannel {
    return this.client.channels.cache.get(this.channelId) ?? stubChannel(this.client, this.channelId, this.guildId);
  }
  get guild(): Guild | null {
    return this.client.guilds.cache.get(this.guildId) ?? null;
  }
  get member(): GuildMember | null {
    return this.guild?.members.cache.get(this.user.id) ?? null;
  }
  get createdTimestamp() {
    return this.createdAt.getTime();
  }
  isChatInputCommand(): this is ChatInputCommandInteraction {
    return true;
  }
  isCommand() {
    return true;
  }
  isButton() {
    return false;
  }
  isStringSelectMenu() {
    return false;
  }
  isModalSubmit() {
    return false;
  }
  isAutocomplete() {
    return false;
  }
  isRepliable() {
    return true;
  }
  inGuild() {
    return true;
  }

  private async send(payload: InteractionReplyPayload, ephemeralDefault: boolean): Promise<InteractionReplyResponse> {
    const o: InteractionReplyOptions = typeof payload === 'string' ? { content: payload } : payload;
    const ephemeral = o.ephemeral ?? ephemeralDefault;
    const res = await this.client.rest.post<InteractionReplyResponse>(`/interactions/${this.id}/reply`, {
      content: composeContent(o.content, o.embeds),
      ephemeral,
    });
    this.replied = true;
    this.ephemeral = ephemeral;
    this.messageId = res.messageId;
    return res;
  }

  /** responde ao comando; `ephemeral: true` só para quem usou */
  async reply(payload: InteractionReplyPayload): Promise<InteractionReplyResponse> {
    if (this.replied) throw new Error('interação já respondida: use editReply ou followUp');
    return this.send(payload, false);
  }

  /** "pensando…" — ganha até 15 min para `editReply` */
  async deferReply(opts: { ephemeral?: boolean } = {}): Promise<void> {
    if (this.replied || this.deferred) throw new Error('interação já respondida ou adiada');
    await this.client.rest.post(`/interactions/${this.id}/defer`);
    this.deferred = true;
    this.ephemeral = opts.ephemeral ?? false;
  }

  /**
   * Edita a resposta: se virou mensagem no canal, edita a mensagem (`PATCH /messages/:id`); se só adiou ou a resposta
   * foi efêmera, responde agora com o texto novo.
   */
  async editReply(payload: InteractionReplyPayload): Promise<Message | InteractionReplyResponse> {
    if (!this.replied && !this.deferred) throw new Error('nada para editar: responda ou adie primeiro');
    const o: InteractionReplyOptions = typeof payload === 'string' ? { content: payload } : payload;
    if (this.messageId) {
      const dto = await this.client.rest.patch<MessageDto>(`/messages/${this.messageId}`, {
        body: composeContent(o.content, o.embeds),
      });
      return new Message(this.client, dto);
    }
    return this.send({ ...o, ephemeral: o.ephemeral ?? this.ephemeral }, this.ephemeral);
  }

  /** mensagem adicional no canal (efêmero não existe aqui: vira mensagem comum do bot) */
  followUp(payload: InteractionReplyPayload): Promise<Message> {
    const o: InteractionReplyOptions = typeof payload === 'string' ? { content: payload } : payload;
    return sendMessage(this.client, { channelId: this.channelId }, { content: o.content, embeds: o.embeds });
  }

  /** a mensagem criada pela resposta (null se efêmera ou ainda sem resposta) */
  async fetchReply(): Promise<Message | null> {
    if (!this.messageId) return null;
    return new PartialMessage(this.client, this.messageId, this.channelId, null).fetch();
  }
  async deleteReply(): Promise<void> {
    if (!this.messageId) return;
    await this.client.rest.delete(`/messages/${this.messageId}`);
    this.messageId = null;
  }
}

export type Interaction = ChatInputCommandInteraction;
