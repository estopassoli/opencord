import type {
  ActionRow,
  Attachment as AttachmentDto,
  Embed,
  Message as MessageDto,
  Poll as PollDto,
  PollOption as PollOptionDto,
} from '@opencord/contracts';
import type { Client } from '../client.js';
import { Collection } from '../collection.js';
import {
  InteractionCollector,
  type AwaitMessageComponentOptions,
  type InteractionCollectorOptions,
} from '../collectors.js';
import { DMChannel, stubChannel, type Channel } from './channel.js';
import type { Guild, GuildMember } from './guild.js';
import type { MessageComponentInteraction } from './interaction.js';
import { buildEditBody, sendMessage, toOptions, type MessageEditPayload, type MessagePayload } from './payload.js';
import { stubUser, User } from './user.js';

/** Anexo de uma mensagem. `url` é assinada e de curta duração. */
export class Attachment {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly spoiler = false;
  constructor(data: AttachmentDto) {
    this.id = data.id;
    this.name = data.originalName;
    this.size = data.sizeBytes;
    this.contentType = data.mime;
    this.url = data.url;
    this.width = data.width;
    this.height = data.height;
  }
  get proxyURL() {
    return this.url;
  }
  toJSON(): AttachmentDto {
    return {
      id: this.id,
      originalName: this.name,
      mime: this.contentType,
      sizeBytes: this.size,
      url: this.url,
      width: this.width,
      height: this.height,
    };
  }
}

export class MessageMentions {
  readonly users: Collection<string, User>;
  readonly everyone: boolean;
  /** não há menção de cargo nem de canal no OpenCord: coleções vazias, para o código portado compilar */
  readonly roles = new Collection<string, never>();
  readonly channels = new Collection<string, never>();
  constructor(
    client: Client,
    readonly userIds: readonly string[],
    body: string,
  ) {
    this.users = new Collection(userIds.map((id) => [id, client.users.cache.get(id) ?? stubUser(client, id)]));
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

type MessageLike = Message | PartialMessage;

/** Quem reagiu com aquele emoji (`reaction.users`). */
export class ReactionUserManager {
  readonly cache: Collection<string, User>;
  constructor(
    readonly reaction: MessageReaction,
    userIds: readonly string[],
  ) {
    const client = reaction.client;
    this.cache = new Collection(userIds.map((id) => [id, client.users.cache.get(id) ?? stubUser(client, id)]));
  }
  /** recarrega a mensagem (`GET /messages/:id`): até 100 pessoas por emoji */
  async fetch(): Promise<Collection<string, User>> {
    const msg = await this.reaction.message.fetch();
    const r = msg.reactions.cache.get(this.reaction.emoji.name);
    this.cache.clear();
    for (const [id, u] of r?.users.cache ?? []) this.cache.set(id, u);
    return this.cache;
  }
  /** tira a reação do próprio bot (a API só remove a própria; para limpar todas: `message.reactions.removeAll()`) */
  async remove(user?: User | string): Promise<MessageReaction> {
    const id = typeof user === 'string' ? user : user?.id;
    const me = this.reaction.client.user?.id;
    if (id && id !== me)
      throw new Error('só dá para tirar a própria reação; para limpar todas use message.reactions.removeAll()');
    await this.reaction.client.rest.delete(
      `/messages/${this.reaction.message.id}/reactions/${encodeURIComponent(this.reaction.emoji.name)}`,
    );
    return this.reaction;
  }
}

export class MessageReaction {
  readonly emoji: { name: string; id: null; toString(): string };
  readonly users: ReactionUserManager;
  /** a reação é do próprio bot? */
  readonly me: boolean;
  constructor(
    readonly client: Client,
    emoji: string,
    readonly message: MessageLike,
    readonly count: number,
    userIds: readonly string[] = [],
  ) {
    this.emoji = { name: emoji, id: null, toString: () => emoji };
    this.users = new ReactionUserManager(this, userIds);
    this.me = !!client.user && userIds.includes(client.user.id);
  }
  /** tira a reação do bot com este emoji */
  remove() {
    return this.users.remove();
  }
  toJSON() {
    return { emoji: this.emoji.name, count: this.count, userIds: [...this.users.cache.keys()] };
  }
}

/** `message.reactions`: cache por emoji + `removeAll()`. */
export class ReactionManager {
  readonly cache = new Collection<string, MessageReaction>();
  constructor(readonly message: MessageLike) {}
  resolve(emoji: string | { name: string }) {
    return this.cache.get(typeof emoji === 'string' ? emoji : emoji.name) ?? null;
  }
  /** limpa todas as reações (`DELETE /messages/:id/reactions`, MANAGE_MESSAGES) */
  async removeAll(): Promise<MessageLike> {
    await this.message.client.rest.delete(`/messages/${this.message.id}/reactions`);
    this.cache.clear();
    return this.message;
  }
}

export class PollAnswer {
  readonly id: string;
  readonly text: string;
  readonly voteCount: number;
  constructor(
    readonly poll: Poll,
    data: PollOptionDto,
  ) {
    this.id = data.id;
    this.text = data.text;
    this.voteCount = data.votes;
  }
}

/** Enquete presa a uma mensagem (ADR-0018). */
export class Poll {
  readonly id: string;
  readonly question: { text: string };
  readonly answers: Collection<string, PollAnswer>;
  readonly allowMultiselect: boolean;
  readonly expiresAt: Date | null;
  /** encerrada (prazo vencido ou fechada) */
  readonly closed: boolean;
  /** pessoas que votaram */
  readonly voters: number;
  /** opções em que o bot votou */
  readonly mine: readonly string[];
  constructor(
    readonly client: Client,
    data: PollDto,
    readonly message: MessageLike,
  ) {
    this.id = data.id;
    this.question = { text: data.question };
    this.allowMultiselect = data.multiple;
    this.expiresAt = data.endsAt ? new Date(data.endsAt) : null;
    this.closed = data.closed;
    this.voters = data.voters;
    this.mine = data.mine;
    this.answers = new Collection(data.options.map((o) => [o.id, new PollAnswer(this, o)]));
  }
  get resultsFinalized() {
    return this.closed;
  }
  get expiresTimestamp() {
    return this.expiresAt?.getTime() ?? null;
  }
  /** vota (substitui o voto do bot; vazio retira): ids das respostas ou as próprias respostas */
  async vote(...answers: (string | PollAnswer | (string | PollAnswer)[])[]): Promise<Poll> {
    const optionIds = answers.flat().map((a) => (typeof a === 'string' ? a : a.id));
    const dto = await this.client.rest.put<PollDto>(`/polls/${this.id}/vote`, { optionIds });
    return new Poll(this.client, dto, this.message);
  }
  /** encerra a enquete (`POST /polls/:id/close`; autor ou MANAGE_MESSAGES) */
  async end(): Promise<Poll> {
    const dto = await this.client.rest.post<PollDto>(`/polls/${this.id}/close`);
    return new Poll(this.client, dto, this.message);
  }
  toJSON(): PollDto {
    return {
      id: this.id,
      question: this.question.text,
      multiple: this.allowMultiselect,
      endsAt: this.expiresAt?.toISOString() ?? null,
      closed: this.closed,
      options: this.answers.map((a) => ({ id: a.id, text: a.text, votes: a.voteCount })),
      voters: this.voters,
      mine: [...this.mine],
    };
  }
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
  readonly reactions: ReactionManager;
  readonly attachments: Collection<string, Attachment>;
  readonly embeds: Embed[];
  readonly components: ActionRow[];
  readonly pinnedAt: Date | null;
  readonly poll: Poll | null;
  readonly reactionRoles: readonly { emoji: string; roleId: string }[];
  /** quantas mensagens respondem a esta (`fetchReplies()`) */
  readonly replyCount: number;
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
    this.reactions = new ReactionManager(this);
    for (const r of data.reactions)
      this.reactions.cache.set(r.emoji, new MessageReaction(client, r.emoji, this, r.count, r.userIds));
    this.attachments = new Collection(data.attachments.map((a) => [a.id, new Attachment(a)]));
    this.embeds = data.embeds ?? [];
    this.components = data.components ?? [];
    this.pinnedAt = data.pinnedAt ? new Date(data.pinnedAt) : null;
    this.poll = data.poll ? new Poll(client, data.poll, this) : null;
    this.reactionRoles = data.reactionRoles ?? [];
    this.replyCount = data.replyCount ?? 0;
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
  get editedTimestamp() {
    return this.editedAt?.getTime() ?? null;
  }
  get pinned() {
    return this.pinnedAt !== null;
  }
  get url() {
    return `${this.client.rest.baseUrl}/messages/${this.id}`;
  }
  get editable() {
    return this.author.id === this.client.user?.id;
  }
  get deletable() {
    return this.editable || this.channel.permissions?.has('ManageMessages') === true;
  }
  get pinnable() {
    return this.channel.permissions?.has('ManageMessages') === true;
  }
  get hasComponents() {
    return this.components.length > 0;
  }
  inGuild() {
    return this.conversationId === null;
  }
  private get target() {
    return this.conversationId ? { conversationId: this.conversationId } : { channelId: this.channelId };
  }

  /** responde citando esta mensagem */
  reply(payload: MessagePayload): Promise<Message> {
    const opts = toOptions(payload);
    opts.reply = { messageReference: this.id };
    return sendMessage(this.client, this.target, opts);
  }
  async react(emoji: string): Promise<this> {
    await this.client.rest.put(`/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`);
    return this;
  }
  async unreact(emoji: string): Promise<this> {
    await this.client.rest.delete(`/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`);
    return this;
  }
  /** edita só o que veio (`content`, `embeds`, `components: []` tira os botões) */
  async edit(payload: MessageEditPayload): Promise<Message> {
    const dto = await this.client.rest.patch<MessageDto>(`/messages/${this.id}`, buildEditBody(payload));
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
  /** recarrega (`GET /messages/:id`) */
  async fetch(): Promise<Message> {
    const dto = await this.client.rest.get<MessageDto>(`/messages/${this.id}`);
    return new Message(this.client, dto);
  }
  /** respostas diretas a esta mensagem (thread leve, `GET /messages/:id/replies`) */
  async fetchReplies(opts: { limit?: number } = {}): Promise<Collection<string, Message>> {
    const q = opts.limit ? `?limit=${opts.limit}` : '';
    const list = await this.client.rest.get<MessageDto[]>(`/messages/${this.id}/replies${q}`);
    return new Collection(list.map((m) => [m.id, new Message(this.client, m)]));
  }
  /** cargos por reação (ADR-0019): reagir com o emoji dá o cargo (`PUT /messages/:id/reaction-roles`) */
  async setReactionRoles(
    pairs: { emoji: string; roleId?: string; role?: { id: string } | string }[],
  ): Promise<Message> {
    const body = {
      pairs: pairs.map((p) => {
        const roleId = p.roleId ?? (typeof p.role === 'string' ? p.role : p.role?.id);
        if (!roleId) throw new Error(`cargo por reação "${p.emoji}": informe roleId`);
        return { emoji: p.emoji, roleId };
      }),
    };
    const dto = await this.client.rest.put<MessageDto>(`/messages/${this.id}/reaction-roles`, body);
    return dto && typeof dto === 'object' && 'id' in dto ? new Message(this.client, dto) : this.fetch();
  }
  /** não há threads como canal no OpenCord: use `reply()` e `fetchReplies()` */
  startThread(_opts?: unknown): never {
    throw new Error('threads não existem no OpenCord: responda com reply() e leia as respostas com fetchReplies()');
  }
  crosspost(): never {
    throw new Error('não há canais de anúncio no OpenCord');
  }
  /** coletor de cliques em botões/menus desta mensagem */
  createMessageComponentCollector<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: InteractionCollectorOptions<T> = {},
  ): InteractionCollector<T> {
    return new InteractionCollector<T>(this.client, { ...options, message: this });
  }
  /** espera um clique (rejeita com razão `time` se o prazo passar) */
  awaitMessageComponent<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: AwaitMessageComponentOptions<T> = {},
  ): Promise<T> {
    return this.createMessageComponentCollector<T>({ ...options, max: 1 }).awaitOne();
  }
  equals(other: Message | PartialMessage | null | undefined) {
    return !!other && other.id === this.id;
  }
  toString() {
    return this.content;
  }
}

/** Mensagem de que só se sabe o id (evento de exclusão, reação ou cartão efêmero). */
export class PartialMessage {
  readonly partial = true as const;
  readonly reactions: ReactionManager;
  constructor(
    readonly client: Client,
    readonly id: string,
    readonly channelId: string,
    readonly conversationId: string | null,
  ) {
    this.reactions = new ReactionManager(this);
  }
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
  get url() {
    return `${this.client.rest.baseUrl}/messages/${this.id}`;
  }
  inGuild() {
    return this.conversationId === null;
  }
  /** carrega a mensagem inteira (`GET /messages/:id`) */
  async fetch(): Promise<Message> {
    const dto = await this.client.rest.get<MessageDto>(`/messages/${this.id}`);
    return new Message(this.client, dto);
  }
  react(emoji: string) {
    return this.client.rest.put(`/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`).then(() => this);
  }
  unreact(emoji: string) {
    return this.client.rest.delete(`/messages/${this.id}/reactions/${encodeURIComponent(emoji)}`).then(() => this);
  }
  delete() {
    return this.client.rest.delete(`/messages/${this.id}`).then(() => this);
  }
  pin() {
    return this.client.rest.put(`/messages/${this.id}/pin`).then(() => this);
  }
  unpin() {
    return this.client.rest.delete(`/messages/${this.id}/pin`).then(() => this);
  }
  async edit(payload: MessageEditPayload): Promise<Message> {
    const dto = await this.client.rest.patch<MessageDto>(`/messages/${this.id}`, buildEditBody(payload));
    return new Message(this.client, dto);
  }
  reply(payload: MessagePayload): Promise<Message> {
    const opts = toOptions(payload);
    opts.reply = { messageReference: this.id };
    return sendMessage(
      this.client,
      this.conversationId ? { conversationId: this.conversationId } : { channelId: this.channelId },
      opts,
    );
  }
}
