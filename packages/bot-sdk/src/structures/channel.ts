import type {
  Category as CategoryDto,
  Channel as ChannelDto,
  ChannelKind,
  Conversation,
  Message as MessageDto,
  MessagePage,
  PermissionOverrideDto,
  SearchMessagesResponse,
  Webhook as WebhookDto,
} from '@opencord/contracts';
import type { Client } from '../client.js';
import { Collection } from '../collection.js';
import {
  InteractionCollector,
  MessageCollector,
  type AwaitMessageComponentOptions,
  type AwaitMessagesOptions,
  type InteractionCollectorOptions,
  type MessageCollectorOptions,
} from '../collectors.js';
import { ChannelType, Limits } from '../constants.js';
import { PermissionsBitField } from '../permissions.js';
import type { Guild, GuildMember } from './guild.js';
import type { MessageComponentInteraction } from './interaction.js';
import { Message, PartialMessage } from './message.js';
import { sendMessage, type MessagePayload } from './payload.js';
import { User } from './user.js';

export interface FetchMessagesOptions {
  limit?: number;
  before?: string;
  after?: string;
  /** aceito e ignorado (a API não pagina em volta de um id) */
  around?: string;
  cache?: boolean;
}
export interface SearchMessagesOptions {
  /** palavras: todas precisam aparecer */
  q?: string;
  query?: string;
  content?: string;
  authorId?: string;
  author?: { id: string } | string;
  /** só mensagens com link, arquivo ou imagem */
  has?: 'link' | 'file' | 'image';
  offset?: number;
  limit?: number;
  /** busca no servidor: só neste canal */
  channelId?: string;
}
export interface SearchResult {
  messages: Collection<string, Message>;
  total: number;
}

function searchQuery(opts: SearchMessagesOptions): string {
  const q = opts.q ?? opts.query ?? opts.content;
  if (!q?.trim()) throw new Error('busca: informe o texto em q');
  const p = new URLSearchParams({ q });
  const authorId = opts.authorId ?? (typeof opts.author === 'string' ? opts.author : opts.author?.id);
  if (authorId) p.set('authorId', authorId);
  if (opts.has) p.set('has', opts.has);
  if (opts.offset) p.set('offset', String(opts.offset));
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.channelId) p.set('channelId', opts.channelId);
  return p.toString();
}

export async function searchMessages(client: Client, path: string, opts: SearchMessagesOptions): Promise<SearchResult> {
  const res = await client.rest.get<SearchMessagesResponse>(`${path}?${searchQuery(opts)}`);
  return { messages: new Collection(res.messages.map((m) => [m.id, new Message(client, m)])), total: res.total };
}

/** `channel.messages`: histórico, uma mensagem, fixadas, busca. */
export class ChannelMessageManager {
  readonly cache = new Collection<string, Message>();
  constructor(
    readonly client: Client,
    readonly channel: TextChannel | DMChannel,
    private readonly base: string,
  ) {}

  /** `fetch(id)` → `GET /messages/:id`; `fetch({ limit, before, after })` → página (mais recente primeiro) */
  fetch(id: string): Promise<Message>;
  fetch(opts?: FetchMessagesOptions): Promise<Collection<string, Message>>;
  async fetch(arg: string | FetchMessagesOptions = {}): Promise<Message | Collection<string, Message>> {
    if (typeof arg === 'string') {
      const dto = await this.client.rest.get<MessageDto>(`/messages/${arg}`);
      return new Message(this.client, dto);
    }
    const q = new URLSearchParams();
    if (arg.limit) q.set('limit', String(arg.limit));
    if (arg.before) q.set('before', arg.before);
    if (arg.after) q.set('after', arg.after);
    const page = await this.client.rest.get<MessagePage>(`${this.base}/messages?${q}`);
    const out = new Collection(page.messages.map((m) => [m.id, new Message(this.client, m)]));
    const newest = page.messages[0];
    if (newest && !arg.before && 'guildId' in this.channel && this.channel.guildId)
      this.client.trackMessage(this.channel.id, newest.id);
    return out;
  }
  /** mensagens fixadas (`GET /channels/:id/pins`) */
  async fetchPinned(): Promise<Collection<string, Message>> {
    const list = await this.client.rest.get<MessageDto[]>(`${this.base}/pins`);
    return new Collection(list.map((m) => [m.id, new Message(this.client, m)]));
  }
  /** busca de texto neste canal/conversa */
  search(opts: SearchMessagesOptions | string): Promise<SearchResult> {
    const o = typeof opts === 'string' ? { q: opts } : opts;
    if (this.channel instanceof DMChannel) return searchMessages(this.client, `${this.base}/messages/search`, o);
    const guildId = this.channel.guildId;
    return searchMessages(this.client, `/servers/${guildId}/messages/search`, { ...o, channelId: this.channel.id });
  }
  async delete(message: string | { id: string }) {
    const id = typeof message === 'string' ? message : message.id;
    await this.client.rest.delete(`/messages/${id}`);
  }
  async pin(message: string | { id: string }) {
    const id = typeof message === 'string' ? message : message.id;
    await this.client.rest.put(`/messages/${id}/pin`);
  }
  async unpin(message: string | { id: string }) {
    const id = typeof message === 'string' ? message : message.id;
    await this.client.rest.delete(`/messages/${id}/pin`);
  }
  async react(message: string | { id: string }, emoji: string) {
    const id = typeof message === 'string' ? message : message.id;
    await this.client.rest.put(`/messages/${id}/reactions/${encodeURIComponent(emoji)}`);
  }
  async edit(message: string | { id: string }, payload: MessagePayload) {
    const id = typeof message === 'string' ? message : message.id;
    return new PartialMessage(
      this.client,
      id,
      this.channel.id,
      this.channel instanceof DMChannel ? this.channel.id : null,
    ).edit(payload);
  }
}

export interface ChannelEditOptions {
  name?: string;
  topic?: string | null;
  /** categoria (id, `CategoryChannel` ou null para tirar) */
  parent?: string | { id: string } | null;
  position?: number;
  overrides?: PermissionOverrideDto[];
  /** canal de texto: quadro kanban alimentado pelas mensagens (null desliga) */
  boardId?: string | null;
  /** canal de voz: criador de salas temporárias */
  roomHub?: boolean;
  reason?: string;
}

export function channelEditBody(data: ChannelEditOptions) {
  const body: Record<string, unknown> = {};
  if (data.name !== undefined) body.name = data.name;
  if (data.topic !== undefined) body.topic = data.topic;
  if (data.parent !== undefined)
    body.categoryId = data.parent === null ? null : typeof data.parent === 'string' ? data.parent : data.parent.id;
  if (data.position !== undefined) body.position = data.position;
  if (data.overrides !== undefined) body.overrides = data.overrides;
  if (data.boardId !== undefined) body.boardId = data.boardId;
  if (data.roomHub !== undefined) body.roomHub = data.roomHub;
  return body;
}

/** Webhook de entrada (ADR-0030): `send()` posta pelo link secreto. */
export class Webhook {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly name: string;
  readonly owner: User;
  readonly createdAt: Date;
  /** link secreto (`POST /webhooks/:id/:token`) */
  readonly url: string;
  readonly token: string;
  constructor(
    readonly client: Client,
    data: WebhookDto,
  ) {
    this.id = data.id;
    this.guildId = data.serverId;
    this.channelId = data.channelId;
    this.name = data.name;
    this.owner = client.resolveUser(data.createdBy);
    this.createdAt = new Date(data.createdAt);
    this.url = data.url;
    this.token = data.url.split('/').pop() ?? '';
  }
  get channel() {
    return this.client.channels.cache.get(this.channelId) ?? null;
  }
  get guild() {
    return this.client.guilds.cache.get(this.guildId) ?? null;
  }
  /** posta como o webhook (`{ content }`); embeds/components não passam por webhook de entrada */
  async send(payload: string | { content?: string; embeds?: unknown[] }): Promise<void> {
    const content = typeof payload === 'string' ? payload : payload.content;
    if (!content?.trim()) throw new Error('webhook: informe content');
    await this.client.rest.post(this.url, { content });
  }
  async delete(): Promise<void> {
    await this.client.rest.delete(`/webhooks/${this.id}`);
  }
}

export class TextChannel {
  readonly id: string;
  readonly guildId: string;
  name: string;
  topic: string | null;
  /** `'text' | 'voice' | 'board'` (`ChannelType.GuildText`…) */
  type: ChannelKind;
  parentId: string | null;
  position: number;
  /** permissões do bot neste canal (bits) */
  myPermissions: number;
  overrides: PermissionOverrideDto[];
  boardId: string | null;
  roomHub: boolean;
  temporary: boolean;
  readonly messages: ChannelMessageManager;

  constructor(
    readonly client: Client,
    data: ChannelDto,
  ) {
    this.id = data.id;
    this.guildId = data.serverId;
    this.name = data.name;
    this.topic = data.topic;
    this.type = data.kind;
    this.parentId = data.categoryId;
    this.position = data.position;
    this.myPermissions = data.myPermissions;
    this.overrides = data.overrides;
    this.boardId = data.boardId ?? null;
    this.roomHub = data.roomHub ?? false;
    this.temporary = data.temporary ?? false;
    this.messages = new ChannelMessageManager(client, this, `/channels/${this.id}`);
  }

  get guild(): Guild | null {
    return this.client.guilds.cache.get(this.guildId) ?? null;
  }
  get parent(): CategoryChannel | null {
    return this.parentId ? (this.guild?.categories.cache.get(this.parentId) ?? null) : null;
  }
  /** permissões do bot neste canal */
  get permissions() {
    return new PermissionsBitField(this.myPermissions);
  }
  /** última mensagem vista pelo SDK neste canal (usada na retomada após reconexão) */
  get lastMessageId(): string | null {
    return this.client.lastMessageIdOf(this.id);
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
  isThread() {
    return false;
  }
  /** permissões de um membro neste canal (o bot: as da API; outros: calculadas com cargos e overrides) */
  permissionsFor(member: GuildMember | User | string): PermissionsBitField | null {
    const guild = this.guild;
    if (!guild) return null;
    const id = typeof member === 'string' ? member : member.id;
    const m = guild.members.cache.get(id);
    return m ? m.permissionsIn(this) : null;
  }
  send(payload: MessagePayload) {
    return sendMessage(this.client, { channelId: this.id }, payload);
  }
  /** "fulano está digitando…" (comando `chat:typing:start` do gateway) */
  sendTyping(): Promise<void> {
    return this.client.sendTyping({ channelId: this.id });
  }
  /**
   * Apaga várias mensagens de uma vez (`POST /channels/:id/messages/bulk-delete`, até 100): mensagens, ids ou um
   * número (as N mais recentes). Emite `messageDeleteBulk`.
   */
  async bulkDelete(
    messages: number | readonly (string | Message | PartialMessage)[] | ReadonlyMap<string, Message | PartialMessage>,
    _filterOld = false,
  ): Promise<Collection<string, Message | PartialMessage>> {
    let items: (string | Message | PartialMessage)[];
    if (typeof messages === 'number') {
      if (messages < 1 || messages > Limits.bulkDelete)
        throw new Error(`bulkDelete: de 1 a ${Limits.bulkDelete} mensagens`);
      items = [...(await this.messages.fetch({ limit: messages })).values()];
    } else
      items =
        messages instanceof Map
          ? [...messages.values()]
          : [...(messages as readonly (string | Message | PartialMessage)[])];
    const out = new Collection<string, Message | PartialMessage>();
    for (const m of items) {
      const id = typeof m === 'string' ? m : m.id;
      out.set(id, typeof m === 'string' ? new PartialMessage(this.client, id, this.id, null) : m);
    }
    if (!out.size) return out;
    if (out.size > Limits.bulkDelete) throw new Error(`bulkDelete: até ${Limits.bulkDelete} mensagens por vez`);
    await this.client.rest.post(`/channels/${this.id}/messages/bulk-delete`, { messageIds: [...out.keys()] });
    this.client.emit('messageDeleteBulk', out, this);
    return out;
  }
  /** webhooks de entrada deste canal */
  async fetchWebhooks(): Promise<Collection<string, Webhook>> {
    const all = await this.client.rest.get<WebhookDto[]>(`/servers/${this.guildId}/webhooks`);
    return new Collection(all.filter((w) => w.channelId === this.id).map((w) => [w.id, new Webhook(this.client, w)]));
  }
  async createWebhook(options: string | { name: string; reason?: string }): Promise<Webhook> {
    const name = typeof options === 'string' ? options : options.name;
    const dto = await this.client.rest.post<WebhookDto>(`/servers/${this.guildId}/webhooks`, {
      name,
      channelId: this.id,
    });
    return new Webhook(this.client, dto);
  }
  /** `PATCH /channels/:id` (MANAGE_CHANNELS) */
  async edit(data: ChannelEditOptions): Promise<TextChannel> {
    const dto = await this.client.rest.patch<ChannelDto>(`/channels/${this.id}`, channelEditBody(data));
    return this.client.upsertChannel(dto);
  }
  setName(name: string, reason?: string) {
    return this.edit({ name, reason });
  }
  setTopic(topic: string | null, reason?: string) {
    return this.edit({ topic, reason });
  }
  setParent(parent: string | { id: string } | null, reason?: string) {
    return this.edit({ parent, reason });
  }
  setPosition(position: number, reason?: string) {
    return this.edit({ position, reason });
  }
  async delete(_reason?: string): Promise<this> {
    await this.client.rest.delete(`/channels/${this.id}`);
    return this;
  }
  /** recarrega o servidor e devolve o canal atualizado */
  async fetch(): Promise<TextChannel> {
    await this.guild?.fetch();
    return this.client.channels.cache.get(this.id) ?? this;
  }
  createMessageCollector(options: MessageCollectorOptions = {}): MessageCollector {
    return new MessageCollector(this.client, { ...options, channel: this });
  }
  awaitMessages(options: AwaitMessagesOptions = {}): Promise<Collection<string, Message>> {
    return this.createMessageCollector(options).awaitAll(options.errors);
  }
  createMessageComponentCollector<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: InteractionCollectorOptions<T> = {},
  ): InteractionCollector<T> {
    return new InteractionCollector<T>(this.client, { ...options, channel: this });
  }
  awaitMessageComponent<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: AwaitMessageComponentOptions<T> = {},
  ): Promise<T> {
    return this.createMessageComponentCollector<T>({ ...options, max: 1 }).awaitOne();
  }
  toString() {
    return `#${this.name}`;
  }
  toJSON(): ChannelDto {
    return {
      id: this.id,
      serverId: this.guildId,
      categoryId: this.parentId,
      kind: this.type,
      name: this.name,
      topic: this.topic,
      position: this.position,
      myPermissions: this.myPermissions,
      overrides: this.overrides,
      boardId: this.boardId,
      roomHub: this.roomHub,
      temporary: this.temporary,
      ownerId: null,
      userLimit: null,
      locked: false,
      private: false,
      slowmodeSec: 0,
    };
  }
}

/** Categoria de canais (`ChannelType.GuildCategory`); vive em `guild.categories.cache`. */
export class CategoryChannel {
  readonly id: string;
  readonly guildId: string;
  name: string;
  position: number;
  readonly type = ChannelType.GuildCategory;
  constructor(
    readonly client: Client,
    data: CategoryDto,
  ) {
    this.id = data.id;
    this.guildId = data.serverId;
    this.name = data.name;
    this.position = data.position;
  }
  get guild(): Guild | null {
    return this.client.guilds.cache.get(this.guildId) ?? null;
  }
  /** canais dentro da categoria */
  get children() {
    const cache = (this.guild?.channels.cache ?? new Collection<string, TextChannel>()).filter(
      (c) => c.parentId === this.id,
    );
    return { cache };
  }
  isTextBased() {
    return false;
  }
  isDMBased() {
    return false;
  }
  isVoiceBased() {
    return false;
  }
  async edit(data: { name?: string; position?: number; reason?: string }): Promise<CategoryChannel> {
    const body: Record<string, unknown> = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.position !== undefined) body.position = data.position;
    const dto = await this.client.rest.patch<CategoryDto>(`/categories/${this.id}`, body);
    return this.client.upsertCategory(dto);
  }
  setName(name: string) {
    return this.edit({ name });
  }
  setPosition(position: number) {
    return this.edit({ position });
  }
  async delete(_reason?: string): Promise<this> {
    await this.client.rest.delete(`/categories/${this.id}`);
    return this;
  }
  toString() {
    return this.name;
  }
}

/** Conversa direta (DM ou grupo). */
export class DMChannel {
  readonly guildId = null;
  readonly type = ChannelType.DM;
  readonly messages: ChannelMessageManager;
  /** pessoas na conversa (quando a conversa foi carregada) */
  readonly recipients = new Collection<string, User>();
  readonly name: string | null;
  constructor(
    readonly client: Client,
    readonly id: string,
    data?: Conversation,
  ) {
    this.messages = new ChannelMessageManager(client, this, `/conversations/${id}`);
    this.name = data?.name ?? null;
    for (const m of data?.members ?? []) this.recipients.set(m.id, client.resolveUser(m));
  }
  get guild(): null {
    return null;
  }
  /** a outra pessoa (em DM de duas) */
  get recipient(): User | null {
    return this.recipients.find((u) => u.id !== this.client.user?.id) ?? null;
  }
  get permissions(): PermissionsBitField | null {
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
  isThread() {
    return false;
  }
  send(payload: MessagePayload) {
    return sendMessage(this.client, { conversationId: this.id }, payload);
  }
  sendTyping(): Promise<void> {
    return this.client.sendTyping({ conversationId: this.id });
  }
  bulkDelete(_messages: unknown): never {
    throw new Error('bulkDelete só existe em canais de servidor; em conversas apague uma a uma (message.delete)');
  }
  createMessageCollector(options: MessageCollectorOptions = {}): MessageCollector {
    return new MessageCollector(this.client, { ...options, channel: this });
  }
  awaitMessages(options: AwaitMessagesOptions = {}): Promise<Collection<string, Message>> {
    return this.createMessageCollector(options).awaitAll(options.errors);
  }
  createMessageComponentCollector<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: InteractionCollectorOptions<T> = {},
  ): InteractionCollector<T> {
    return new InteractionCollector<T>(this.client, { ...options, channel: this });
  }
  awaitMessageComponent<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: AwaitMessageComponentOptions<T> = {},
  ): Promise<T> {
    return this.createMessageComponentCollector<T>({ ...options, max: 1 }).awaitOne();
  }
  toString() {
    return this.name ?? this.recipient?.toString() ?? this.id;
  }
}

export type Channel = TextChannel | DMChannel;
export type GuildChannel = TextChannel | CategoryChannel;

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
    ownerId: null,
    userLimit: null,
    locked: false,
    private: false,
    slowmodeSec: 0,
  });
}

/** "fulano está digitando" (`typingStart`). */
export class Typing {
  readonly startedAt = new Date();
  constructor(
    readonly channel: Channel,
    readonly user: User,
  ) {}
  get client() {
    return this.user.client;
  }
  get guild(): Guild | null {
    return this.channel.guild;
  }
  get member(): GuildMember | null {
    return this.guild?.members.cache.get(this.user.id) ?? null;
  }
  get startedTimestamp() {
    return this.startedAt.getTime();
  }
  inGuild() {
    return !this.channel.isDMBased();
  }
}
