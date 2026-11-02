import type {
  BotCommandChoice,
  Interaction as InteractionDto,
  InteractionOptionValue,
  InteractionReplyResponse,
  Message as MessageDto,
} from '@opencord/contracts';
import type { Client } from '../client.js';
import type { FileResolvable } from '../builders/attachment.js';
import {
  componentTypeOf,
  resolveComponents,
  resolveModal,
  selectTypeOf,
  type ActionRowLike,
  type ModalLike,
} from '../builders/components.js';
import { Collection } from '../collection.js';
import { ComponentType, InteractionType, Limits, MessageFlags, type ComponentTypeValue } from '../constants.js';
import {
  InteractionCollector,
  type AwaitMessageComponentOptions,
  type InteractionCollectorOptions,
} from '../collectors.js';
import { resolveEmbeds, type EmbedLike } from '../embed.js';
import { PermissionsBitField } from '../permissions.js';
import { stubChannel, TextChannel } from './channel.js';
import { Guild, GuildMember, Role, stubRole } from './guild.js';
import { Message } from './message.js';
import { buildEditBody, sendMessage, uploadFiles, type MessageEditPayload } from './payload.js';
import { stubUser, User } from './user.js';

// ---------- opções ----------
type OptionType = 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'channel' | 'role' | 'mentionable';

export interface CommandInteractionOption {
  name: string;
  value: InteractionOptionValue;
  focused?: boolean;
}

export class CommandInteractionOptionResolver {
  constructor(
    private readonly client: Client,
    private readonly values: Readonly<Record<string, InteractionOptionValue>>,
    private readonly guildId: string,
    private readonly sub: { subcommand?: string; subcommandGroup?: string; focused?: string } = {},
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
    return { name, value, ...(this.sub.focused === name ? { focused: true } : {}) };
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
  getChannel(name: string, required?: false, channelTypes?: readonly string[]): TextChannel | null;
  getChannel(name: string, required: true, channelTypes?: readonly string[]): TextChannel;
  getChannel(name: string, required = false, channelTypes?: readonly string[]) {
    const ch = this.typed(name, 'channel', required, (v) =>
      typeof v === 'string' ? (this.client.channels.cache.get(v) ?? stubChannel(this.client, v, this.guildId)) : null,
    );
    if (ch && channelTypes?.length && !channelTypes.includes(ch.type))
      throw new Error(`opção "${name}": canal do tipo ${ch.type}, esperado ${channelTypes.join('/')}`);
    return ch;
  }
  getRole(name: string, required?: false): Role | null;
  getRole(name: string, required: true): Role;
  getRole(name: string, required = false) {
    return this.typed(name, 'role', required, (v) =>
      typeof v === 'string'
        ? (this.client.guilds.cache.get(this.guildId)?.roles.cache.get(v) ?? stubRole(this.client, this.guildId, v))
        : null,
    );
  }
  /** membro, cargo ou usuário (nessa ordem de preferência) */
  getMentionable(name: string, required?: false): GuildMember | Role | User | null;
  getMentionable(name: string, required: true): GuildMember | Role | User;
  getMentionable(name: string, required = false) {
    return this.typed(name, 'mentionable', required, (v) => {
      if (typeof v !== 'string') return null;
      const g = this.client.guilds.cache.get(this.guildId);
      return (
        g?.members.cache.get(v) ?? g?.roles.cache.get(v) ?? this.client.users.cache.get(v) ?? stubUser(this.client, v)
      );
    });
  }
  /** não há opção de anexo no OpenCord */
  getAttachment(_name: string, _required?: boolean): never {
    throw new Error('opções de anexo não existem no OpenCord: peça o arquivo numa mensagem (message.attachments)');
  }
  /** `required` (padrão true) lança se o comando não tem subcomando */
  getSubcommand(required?: true): string;
  getSubcommand(required: false): string | null;
  getSubcommand(required = true): string | null {
    if (this.sub.subcommand === undefined) {
      if (required) throw new Error('este comando não tem subcomando');
      return null;
    }
    return this.sub.subcommand;
  }
  getSubcommandGroup(required?: false): string | null;
  getSubcommandGroup(required: true): string;
  getSubcommandGroup(required = false): string | null {
    if (this.sub.subcommandGroup === undefined) {
      if (required) throw new Error('este comando não tem grupo de subcomandos');
      return null;
    }
    return this.sub.subcommandGroup;
  }
  /** autocompletar: a opção que a pessoa está digitando (`getFocused(true)` devolve `{ name, value }`) */
  getFocused(getFull?: false): string;
  getFocused(getFull: true): CommandInteractionOption;
  getFocused(getFull = false): string | CommandInteractionOption {
    const name = this.sub.focused;
    if (!name) throw new Error('nenhuma opção em foco (só em interações de autocompletar)');
    const value = this.values[name] ?? '';
    return getFull ? { name, value, focused: true } : String(value);
  }
  get data(): CommandInteractionOption[] {
    return Object.entries(this.values).map(([name, value]) => ({
      name,
      value,
      ...(this.sub.focused === name ? { focused: true } : {}),
    }));
  }
}

/** Campos de um modal enviado (`interaction.fields.getTextInputValue('id')`). */
export class ModalSubmitFields {
  readonly fields: Collection<string, { customId: string; type: 'text'; value: string }>;
  constructor(values: Readonly<Record<string, string>>) {
    this.fields = new Collection(
      Object.entries(values).map(([customId, value]) => [customId, { customId, type: 'text' as const, value }]),
    );
  }
  getField(customId: string, required?: true): { customId: string; type: 'text'; value: string };
  getField(customId: string, required: false): { customId: string; type: 'text'; value: string } | null;
  getField(customId: string, required = true) {
    const f = this.fields.get(customId);
    if (!f) {
      if (required) throw new Error(`campo "${customId}" não veio no modal`);
      return null;
    }
    return f;
  }
  /** campo opcional que a pessoa deixou em branco não vem no envio: devolve '' (como se tivesse vindo vazio) */
  getTextInputValue(customId: string): string {
    return this.getField(customId, false)?.value ?? '';
  }
}

// ---------- respostas ----------
export interface InteractionReplyOptions {
  content?: string;
  embeds?: EmbedLike[];
  components?: ActionRowLike[];
  files?: FileResolvable[];
  /** só quem usou o comando vê (não vira mensagem no canal) */
  ephemeral?: boolean;
  /** `MessageFlags.Ephemeral` é sinônimo de `ephemeral: true` */
  flags?: number;
  /** busca a mensagem criada e a devolve em `response.resource.message` */
  withResponse?: boolean;
  fetchReply?: boolean;
  allowedMentions?: unknown;
  tts?: boolean;
}
export type InteractionReplyPayload = string | InteractionReplyOptions;
export interface InteractionDeferReplyOptions {
  ephemeral?: boolean;
  flags?: number;
  withResponse?: boolean;
}
export interface InteractionUpdateOptions {
  content?: string | null;
  embeds?: EmbedLike[];
  components?: ActionRowLike[];
  withResponse?: boolean;
  fetchReply?: boolean;
}
export type InteractionUpdatePayload = string | InteractionUpdateOptions;

function toReplyOptions(payload: InteractionReplyPayload): InteractionReplyOptions {
  return typeof payload === 'string' ? { content: payload } : { ...payload };
}
function isEphemeral(o: { ephemeral?: boolean; flags?: number }): boolean | undefined {
  if (o.ephemeral !== undefined) return o.ephemeral;
  if (o.flags !== undefined) return (o.flags & MessageFlags.Ephemeral) !== 0;
  return undefined;
}

/**
 * O que `reply`/`deferReply`/`update` devolvem: `messageId` (null quando efêmera) e atalhos para coletar cliques
 * nos componentes daquela resposta (também nos cartões efêmeros).
 */
export class InteractionResponse {
  /** `response.resource.message` quando `withResponse`/`fetchReply` foi pedido */
  resource: { message: Message | null } = { message: null };
  constructor(
    readonly interaction: BaseInteraction,
    readonly messageId: string | null,
  ) {}
  get id() {
    return this.interaction.id;
  }
  get client() {
    return this.interaction.client;
  }
  /** a mensagem da resposta (null se efêmera) */
  fetch(): Promise<Message | null> {
    return this.interaction.fetchReply();
  }
  edit(payload: InteractionReplyPayload) {
    return this.interaction.editReply(payload);
  }
  delete() {
    return this.interaction.deleteReply();
  }
  createMessageComponentCollector<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: InteractionCollectorOptions<T> = {},
  ): InteractionCollector<T> {
    return new InteractionCollector<T>(this.client, {
      ...options,
      ...(this.messageId ? { message: { id: this.messageId } } : { interactionId: this.interaction.id }),
    });
  }
  awaitMessageComponent<T extends MessageComponentInteraction = MessageComponentInteraction>(
    options: AwaitMessageComponentOptions<T> = {},
  ): Promise<T> {
    return this.createMessageComponentCollector<T>({ ...options, max: 1 }).awaitOne();
  }
  toJSON() {
    return { messageId: this.messageId };
  }
}

const TYPE_OF: Record<InteractionDto['type'], number> = {
  command: InteractionType.ApplicationCommand,
  user_command: InteractionType.ApplicationCommand,
  message_command: InteractionType.ApplicationCommand,
  component: InteractionType.MessageComponent,
  modal: InteractionType.ModalSubmit,
  autocomplete: InteractionType.ApplicationCommandAutocomplete,
};

/** Base de toda interação: quem, onde, e as respostas (`reply`, `deferReply`, `editReply`, `followUp`, `showModal`…). */
export class BaseInteraction {
  readonly id: string;
  /** `InteractionType.*` (número que a comunidade conhece) */
  readonly type: number;
  /** o tipo no contrato do OpenCord (`command`, `component`, `modal`…) */
  readonly rawType: InteractionDto['type'];
  readonly user: User;
  readonly channelId: string;
  readonly guildId: string;
  readonly botId: string;
  readonly createdAt: Date;
  /** já respondeu (`reply`, `update`, `showModal`…) */
  replied = false;
  /** acusou recebimento (`deferReply`/`deferUpdate`) e ainda vai responder */
  deferred = false;
  /** a resposta foi efêmera */
  ephemeral = false;
  /** se respondeu com mensagem no canal, o id dela (null para efêmera) */
  protected replyMessageId: string | null = null;
  protected modalCustomId: string | null = null;

  constructor(
    readonly client: Client,
    readonly raw: InteractionDto,
  ) {
    this.id = raw.id;
    this.rawType = raw.type ?? 'command';
    this.type = TYPE_OF[this.rawType];
    this.user = client.resolveUser(raw.user);
    this.channelId = raw.channelId;
    this.guildId = raw.serverId;
    this.botId = raw.botId;
    this.createdAt = new Date(raw.createdAt);
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
  /** permissões de quem interagiu no canal (null fora do cache) */
  get memberPermissions(): PermissionsBitField | null {
    const m = this.member;
    const ch = this.client.channels.cache.get(this.channelId);
    if (!m) return null;
    return ch ? m.permissionsIn(ch) : m.permissions;
  }
  /** permissões do bot no canal */
  get appPermissions(): PermissionsBitField {
    return this.channel.permissions;
  }
  get createdTimestamp() {
    return this.createdAt.getTime();
  }
  get applicationId() {
    return this.botId;
  }
  get token() {
    return this.id;
  }

  isChatInputCommand(): this is ChatInputCommandInteraction {
    return false;
  }
  isCommand(): this is CommandInteraction {
    return false;
  }
  isContextMenuCommand(): this is ContextMenuCommandInteraction {
    return false;
  }
  isUserContextMenuCommand(): this is UserContextMenuCommandInteraction {
    return false;
  }
  isMessageContextMenuCommand(): this is MessageContextMenuCommandInteraction {
    return false;
  }
  isMessageComponent(): this is MessageComponentInteraction {
    return false;
  }
  isButton(): this is ButtonInteraction {
    return false;
  }
  isAnySelectMenu(): this is AnySelectMenuInteraction {
    return false;
  }
  isSelectMenu(): this is AnySelectMenuInteraction {
    return this.isAnySelectMenu();
  }
  isStringSelectMenu(): this is StringSelectMenuInteraction {
    return false;
  }
  isUserSelectMenu(): this is UserSelectMenuInteraction {
    return false;
  }
  isRoleSelectMenu(): this is RoleSelectMenuInteraction {
    return false;
  }
  isChannelSelectMenu(): this is ChannelSelectMenuInteraction {
    return false;
  }
  isMentionableSelectMenu(): boolean {
    return false;
  }
  isModalSubmit(): this is ModalSubmitInteraction {
    return false;
  }
  isAutocomplete(): this is AutocompleteInteraction {
    return false;
  }
  isRepliable(): this is RepliableInteraction {
    return true;
  }
  inGuild() {
    return true;
  }
  inCachedGuild() {
    return this.guild !== null;
  }

  /** monta e manda `POST /interactions/:id/reply`; `primary` = é a resposta principal (guarda messageId/ephemeral) */
  protected async send(
    payload: InteractionReplyPayload,
    ephemeralDefault: boolean,
    primary = true,
  ): Promise<InteractionResponse> {
    const o = toReplyOptions(payload);
    const ephemeral = isEphemeral(o) ?? ephemeralDefault;
    const content = o.content ?? '';
    if (content.length > Limits.messageBody) throw new Error(`resposta com mais de ${Limits.messageBody} caracteres`);
    const embeds = resolveEmbeds(o.embeds);
    const components = resolveComponents(o.components);
    const attachmentIds = await uploadFiles(this.client, o.files);
    if (!content.trim() && !embeds?.length && !attachmentIds?.length)
      throw new Error('resposta vazia: informe content, embeds ou files');
    const body: Record<string, unknown> = { content, ephemeral };
    if (embeds) body.embeds = embeds;
    if (components) body.components = components;
    if (attachmentIds) body.attachmentIds = attachmentIds;
    const res = await this.client.rest.post<InteractionReplyResponse>(`/interactions/${this.id}/reply`, body);
    this.replied = true;
    const messageId = res?.messageId ?? null;
    if (primary) {
      this.ephemeral = ephemeral;
      this.replyMessageId = messageId;
    }
    if (ephemeral && components) this.client.rememberEphemeralComponents(this.id, components);
    const response = new InteractionResponse(this, messageId);
    if ((o.withResponse || o.fetchReply) && messageId) {
      const dto = await this.client.rest.get<MessageDto>(`/messages/${messageId}`);
      response.resource.message = new Message(this.client, dto);
    }
    return response;
  }

  /** responde; `ephemeral: true` só para quem usou (texto, embeds, componentes e arquivos) */
  async reply(payload: InteractionReplyPayload): Promise<InteractionResponse> {
    if (this.replied) throw new Error('interação já respondida: use editReply ou followUp');
    return this.send(payload, false);
  }

  /** "pensando…" — ganha até 15 min para `editReply` (`POST /interactions/:id/defer { ephemeral }`) */
  async deferReply(opts: InteractionDeferReplyOptions = {}): Promise<InteractionResponse> {
    if (this.replied || this.deferred) throw new Error('interação já respondida ou adiada');
    const ephemeral = isEphemeral(opts) ?? false;
    await this.client.rest.post(`/interactions/${this.id}/defer`, { ephemeral, update: false });
    this.deferred = true;
    this.ephemeral = ephemeral;
    return new InteractionResponse(this, null);
  }

  /**
   * Edita a resposta: se virou mensagem no canal, edita a mensagem (`PATCH /messages/:id`); se só adiou ou a resposta
   * foi efêmera, responde agora com o conteúdo novo (ainda efêmera).
   */
  async editReply(payload: InteractionReplyPayload): Promise<Message | InteractionResponse> {
    if (!this.replied && !this.deferred) throw new Error('nada para editar: responda ou adie primeiro');
    const o = toReplyOptions(payload);
    if (this.replyMessageId) {
      const dto = await this.client.rest.patch<MessageDto>(
        `/messages/${this.replyMessageId}`,
        buildEditBody(o as MessageEditPayload),
      );
      return new Message(this.client, dto);
    }
    return this.send({ ...o, ephemeral: isEphemeral(o) ?? this.ephemeral }, this.ephemeral);
  }

  /** mais uma resposta: efêmera (`ephemeral: true`, outro cartão só para quem usou) ou mensagem comum no canal */
  async followUp(payload: InteractionReplyPayload): Promise<Message | InteractionResponse> {
    const o = toReplyOptions(payload);
    if (isEphemeral(o) ?? (this.ephemeral && this.replied)) return this.send({ ...o, ephemeral: true }, true, false);
    return sendMessage(
      this.client,
      { channelId: this.channelId },
      { content: o.content, embeds: o.embeds, components: o.components, files: o.files },
    );
  }

  /** a mensagem criada pela resposta (null se efêmera ou ainda sem resposta) */
  async fetchReply(): Promise<Message | null> {
    if (!this.replyMessageId) return null;
    const dto = await this.client.rest.get<MessageDto>(`/messages/${this.replyMessageId}`);
    return new Message(this.client, dto);
  }
  async deleteReply(): Promise<void> {
    if (!this.replyMessageId) return;
    await this.client.rest.delete(`/messages/${this.replyMessageId}`);
    this.replyMessageId = null;
  }

  /** abre um formulário para quem interagiu (`POST /interactions/:id/modal`); o envio chega como `ModalSubmitInteraction` */
  async showModal(modal: ModalLike): Promise<void> {
    if (this.replied || this.deferred)
      throw new Error('interação já respondida: o modal precisa ser a primeira resposta');
    const m = resolveModal(modal);
    await this.client.rest.post(`/interactions/${this.id}/modal`, { modal: m });
    this.replied = true;
    this.modalCustomId = m.customId;
  }

  /** espera o envio do modal aberto com `showModal` (mesma pessoa e mesmo `customId`); rejeita com `CollectorError` */
  awaitModalSubmit(options: {
    time: number;
    filter?: (i: ModalSubmitInteraction) => boolean | Promise<boolean>;
  }): Promise<ModalSubmitInteraction> {
    const customId = this.modalCustomId;
    const userId = this.user.id;
    const filter = options.filter;
    return new InteractionCollector<ModalSubmitInteraction>(this.client, {
      interactionType: InteractionType.ModalSubmit,
      time: options.time,
      max: 1,
      filter: async (i) => {
        if (i.user.id !== userId) return false;
        if (customId && i.customId !== customId) return false;
        return filter ? filter(i) : true;
      },
    }).awaitOne();
  }

  toJSON(): InteractionDto {
    return this.raw;
  }
}

// ---------- comandos ----------
export class CommandInteraction extends BaseInteraction {
  readonly commandName: string;
  /** `ApplicationCommandType.*` (`chat`, `user`, `message`) */
  readonly commandType: 'chat' | 'user' | 'message';
  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    this.commandName = raw.command ?? '';
    this.commandType = raw.type === 'user_command' ? 'user' : raw.type === 'message_command' ? 'message' : 'chat';
  }
  get commandId() {
    return `${this.commandType}:${this.commandName}`;
  }
  override isCommand(): this is CommandInteraction {
    return true;
  }
}

export class ChatInputCommandInteraction extends CommandInteraction {
  readonly options: CommandInteractionOptionResolver;
  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    this.options = new CommandInteractionOptionResolver(client, raw.options ?? {}, raw.serverId, {
      subcommand: raw.subcommand,
      subcommandGroup: raw.subcommandGroup,
    });
  }
  override isChatInputCommand(): this is ChatInputCommandInteraction {
    return true;
  }
  /** `/comando grupo sub` como texto */
  override toString() {
    const parts = ['/' + this.commandName];
    if (this.raw.subcommandGroup) parts.push(this.raw.subcommandGroup);
    if (this.raw.subcommand) parts.push(this.raw.subcommand);
    for (const [k, v] of Object.entries(this.raw.options ?? {})) parts.push(`${k}:${String(v)}`);
    return parts.join(' ');
  }
}

export class ContextMenuCommandInteraction extends CommandInteraction {
  readonly targetId: string;
  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    this.targetId = raw.targetUser?.id ?? raw.targetMessage?.id ?? '';
  }
  override isContextMenuCommand(): this is ContextMenuCommandInteraction {
    return true;
  }
}

export class UserContextMenuCommandInteraction extends ContextMenuCommandInteraction {
  readonly targetUser: User;
  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    this.targetUser = raw.targetUser ? client.resolveUser(raw.targetUser) : stubUser(client, this.targetId);
  }
  get targetMember(): GuildMember | null {
    return this.guild?.members.cache.get(this.targetUser.id) ?? null;
  }
  override isUserContextMenuCommand(): this is UserContextMenuCommandInteraction {
    return true;
  }
}

export class MessageContextMenuCommandInteraction extends ContextMenuCommandInteraction {
  readonly targetMessage: Message;
  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    if (!raw.targetMessage) throw new Error('comando de mensagem sem targetMessage');
    this.targetMessage = new Message(client, raw.targetMessage);
  }
  override isMessageContextMenuCommand(): this is MessageContextMenuCommandInteraction {
    return true;
  }
}

// ---------- componentes ----------
/** Base de botões e menus: `customId`, `message` (null em cartão efêmero), `update()`, `deferUpdate()`. */
export class MessageComponentInteraction extends BaseInteraction {
  readonly customId: string;
  readonly componentType: ComponentTypeValue;
  /** a mensagem com os componentes; null quando o clique veio de um cartão efêmero */
  readonly message: Message | null;
  /** cartão efêmero: id da interação que o criou */
  readonly ephemeralOf: string | null;
  /** valores escolhidos (menus); vazio em botões */
  readonly values: string[];
  protected deferredUpdate = false;

  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    this.customId = raw.customId ?? '';
    this.message = raw.targetMessage ? new Message(client, raw.targetMessage) : null;
    this.ephemeralOf = raw.ephemeralOf ?? null;
    this.values = raw.values ?? [];
    this.componentType = resolveComponentType(client, raw, this.message);
  }
  get messageId() {
    return this.message?.id ?? null;
  }
  get component() {
    for (const row of this.message?.components ?? [])
      for (const c of row.components) if ('customId' in c && c.customId === this.customId) return c;
    return null;
  }
  override isMessageComponent(): this is MessageComponentInteraction {
    return true;
  }
  override isButton(): this is ButtonInteraction {
    return this.componentType === ComponentType.Button;
  }
  override isAnySelectMenu(): this is AnySelectMenuInteraction {
    return this.componentType !== ComponentType.Button;
  }
  override isStringSelectMenu(): this is StringSelectMenuInteraction {
    return this.componentType === ComponentType.StringSelect;
  }
  override isUserSelectMenu(): this is UserSelectMenuInteraction {
    return this.componentType === ComponentType.UserSelect;
  }
  override isRoleSelectMenu(): this is RoleSelectMenuInteraction {
    return this.componentType === ComponentType.RoleSelect;
  }
  override isChannelSelectMenu(): this is ChannelSelectMenuInteraction {
    return this.componentType === ComponentType.ChannelSelect;
  }

  /** edita a mensagem (ou o cartão efêmero) de onde veio o clique — `POST /interactions/:id/update` */
  async update(payload: InteractionUpdatePayload): Promise<InteractionResponse> {
    if (this.replied) throw new Error('interação já respondida: use editReply');
    const o: InteractionUpdateOptions = typeof payload === 'string' ? { content: payload } : payload;
    const body: Record<string, unknown> = {};
    if (o.content !== undefined) body.content = o.content ?? '';
    const embeds = resolveEmbeds(o.embeds);
    if (embeds) body.embeds = embeds;
    const components = resolveComponents(o.components);
    if (components) body.components = components;
    if (!Object.keys(body).length) throw new Error('nada para atualizar: informe content, embeds ou components');
    await this.client.rest.post(`/interactions/${this.id}/update`, body);
    this.replied = true;
    this.deferredUpdate = false;
    this.ephemeral = this.message === null;
    this.replyMessageId = this.message?.id ?? null;
    if (components && this.message === null) {
      this.client.rememberEphemeralComponents(this.id, components);
      if (this.ephemeralOf) this.client.rememberEphemeralComponents(this.ephemeralOf, components);
    }
    const response = new InteractionResponse(this, this.replyMessageId);
    if ((o.withResponse || o.fetchReply) && this.replyMessageId) response.resource.message = await this.fetchReply();
    return response;
  }
  /** só acusa o clique (`POST /interactions/:id/defer { update: true }`); depois `editReply` edita a mensagem de origem */
  async deferUpdate(_opts: { withResponse?: boolean } = {}): Promise<InteractionResponse> {
    if (this.replied || this.deferred) throw new Error('interação já respondida ou adiada');
    await this.client.rest.post(`/interactions/${this.id}/defer`, { ephemeral: false, update: true });
    this.deferred = true;
    this.deferredUpdate = true;
    this.ephemeral = this.message === null;
    return new InteractionResponse(this, this.message?.id ?? null);
  }
  /** depois de `deferUpdate`, edita a mensagem de origem; senão, como em comandos */
  override async editReply(payload: InteractionReplyPayload): Promise<Message | InteractionResponse> {
    if (this.deferredUpdate && !this.replied) {
      const o = toReplyOptions(payload);
      return this.update({
        content: o.content,
        embeds: o.embeds,
        components: o.components,
        withResponse: o.withResponse ?? o.fetchReply,
      });
    }
    return super.editReply(payload);
  }
}

function resolveComponentType(client: Client, raw: InteractionDto, message: Message | null): ComponentTypeValue {
  if (raw.componentType === 'button') return ComponentType.Button;
  const fromMessage = componentTypeOf(message?.components, raw.customId ?? '');
  if (fromMessage) return fromMessage;
  const remembered = raw.ephemeralOf ? client.ephemeralComponentType(raw.ephemeralOf, raw.customId ?? '') : null;
  if (remembered) return remembered;
  return raw.componentType === 'select' || raw.values ? selectTypeOf('string') : ComponentType.Button;
}

export class ButtonInteraction extends MessageComponentInteraction {}
export class StringSelectMenuInteraction extends MessageComponentInteraction {}
export class UserSelectMenuInteraction extends MessageComponentInteraction {
  get users(): Collection<string, User> {
    return new Collection(this.values.map((id) => [id, this.client.users.cache.get(id) ?? stubUser(this.client, id)]));
  }
  get members(): Collection<string, GuildMember> {
    const g = this.guild;
    return new Collection(
      this.values.flatMap((id) =>
        g?.members.cache.get(id) ? [[id, g.members.cache.get(id) as GuildMember] as const] : [],
      ),
    );
  }
}
export class RoleSelectMenuInteraction extends MessageComponentInteraction {
  get roles(): Collection<string, Role> {
    return new Collection(
      this.values.map((id) => [id, this.guild?.roles.cache.get(id) ?? stubRole(this.client, this.guildId, id)]),
    );
  }
}
export class ChannelSelectMenuInteraction extends MessageComponentInteraction {
  get channels(): Collection<string, TextChannel> {
    return new Collection(
      this.values.map((id) => [id, this.client.channels.cache.get(id) ?? stubChannel(this.client, id, this.guildId)]),
    );
  }
}
export type AnySelectMenuInteraction =
  StringSelectMenuInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction | ChannelSelectMenuInteraction;

// ---------- modal ----------
export class ModalSubmitInteraction extends BaseInteraction {
  readonly customId: string;
  readonly fields: ModalSubmitFields;
  /** a mensagem com o componente que abriu o modal (null se veio de comando ou cartão efêmero) */
  readonly message: Message | null;
  readonly ephemeralOf: string | null;
  private deferredUpdate = false;
  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    this.customId = raw.customId ?? '';
    this.fields = new ModalSubmitFields(raw.fields ?? {});
    this.message = raw.targetMessage ? new Message(client, raw.targetMessage) : null;
    this.ephemeralOf = raw.ephemeralOf ?? null;
  }
  override isModalSubmit(): this is ModalSubmitInteraction {
    return true;
  }
  /** o modal foi aberto a partir de um componente (botão/menu)? então `update()` edita aquela mensagem */
  isFromMessage() {
    return this.message !== null || this.ephemeralOf !== null;
  }
  async update(payload: InteractionUpdatePayload): Promise<InteractionResponse> {
    if (!this.isFromMessage()) throw new Error('update() só quando o modal veio de um botão/menu; use reply()');
    if (this.replied) throw new Error('interação já respondida: use editReply');
    const o: InteractionUpdateOptions = typeof payload === 'string' ? { content: payload } : payload;
    const body: Record<string, unknown> = {};
    if (o.content !== undefined) body.content = o.content ?? '';
    const embeds = resolveEmbeds(o.embeds);
    if (embeds) body.embeds = embeds;
    const components = resolveComponents(o.components);
    if (components) body.components = components;
    if (!Object.keys(body).length) throw new Error('nada para atualizar: informe content, embeds ou components');
    await this.client.rest.post(`/interactions/${this.id}/update`, body);
    this.replied = true;
    this.deferredUpdate = false;
    this.replyMessageId = this.message?.id ?? null;
    this.ephemeral = this.message === null;
    return new InteractionResponse(this, this.replyMessageId);
  }
  async deferUpdate(): Promise<InteractionResponse> {
    if (!this.isFromMessage())
      throw new Error('deferUpdate() só quando o modal veio de um botão/menu; use deferReply()');
    if (this.replied || this.deferred) throw new Error('interação já respondida ou adiada');
    await this.client.rest.post(`/interactions/${this.id}/defer`, { ephemeral: false, update: true });
    this.deferred = true;
    this.deferredUpdate = true;
    return new InteractionResponse(this, this.message?.id ?? null);
  }
  override async editReply(payload: InteractionReplyPayload): Promise<Message | InteractionResponse> {
    if (this.deferredUpdate && !this.replied) {
      const o = toReplyOptions(payload);
      return this.update({ content: o.content, embeds: o.embeds, components: o.components });
    }
    return super.editReply(payload);
  }
}

// ---------- autocompletar ----------
export type AutocompleteChoice = BotCommandChoice;

export class AutocompleteInteraction extends BaseInteraction {
  readonly commandName: string;
  readonly commandType = 'chat' as const;
  readonly options: CommandInteractionOptionResolver;
  /** já mandou as sugestões */
  responded = false;
  constructor(client: Client, raw: InteractionDto) {
    super(client, raw);
    this.commandName = raw.command ?? '';
    this.options = new CommandInteractionOptionResolver(client, raw.options ?? {}, raw.serverId, {
      subcommand: raw.subcommand,
      subcommandGroup: raw.subcommandGroup,
      focused: raw.focused,
    });
  }
  override isAutocomplete(): this is AutocompleteInteraction {
    return true;
  }
  override isRepliable(): this is RepliableInteraction {
    return false;
  }
  /** sugestões para a opção em foco (até 25) — `POST /interactions/:id/autocomplete { choices }`; o app espera 3 s */
  async respond(choices: readonly (AutocompleteChoice | string)[]): Promise<void> {
    if (this.responded) throw new Error('autocompletar já respondido');
    if (choices.length > Limits.choices) throw new Error(`autocompletar: até ${Limits.choices} sugestões`);
    const list = choices.map((c) => (typeof c === 'string' ? { name: c, value: c } : { name: c.name, value: c.value }));
    await this.client.rest.post(`/interactions/${this.id}/autocomplete`, { choices: list });
    this.responded = true;
  }
  override reply(): never {
    throw new Error('interação de autocompletar não aceita reply(): use respond(choices)');
  }
  override deferReply(): never {
    throw new Error('interação de autocompletar não aceita deferReply(): use respond(choices)');
  }
  override showModal(): never {
    throw new Error('interação de autocompletar não aceita showModal(): use respond(choices)');
  }
}

export type Interaction =
  | ChatInputCommandInteraction
  | UserContextMenuCommandInteraction
  | MessageContextMenuCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | ModalSubmitInteraction
  | AutocompleteInteraction;
export type RepliableInteraction = Exclude<Interaction, AutocompleteInteraction>;

/** Instancia a classe certa para o evento `interaction:created`. */
export function createInteraction(client: Client, raw: InteractionDto): Interaction {
  switch (raw.type ?? 'command') {
    case 'user_command':
      return new UserContextMenuCommandInteraction(client, raw);
    case 'message_command':
      return new MessageContextMenuCommandInteraction(client, raw);
    case 'component': {
      const probe = new MessageComponentInteraction(client, raw);
      const Cls =
        probe.componentType === ComponentType.Button
          ? ButtonInteraction
          : probe.componentType === ComponentType.UserSelect
            ? UserSelectMenuInteraction
            : probe.componentType === ComponentType.RoleSelect
              ? RoleSelectMenuInteraction
              : probe.componentType === ComponentType.ChannelSelect
                ? ChannelSelectMenuInteraction
                : StringSelectMenuInteraction;
      return new Cls(client, raw);
    }
    case 'modal':
      return new ModalSubmitInteraction(client, raw);
    case 'autocomplete':
      return new AutocompleteInteraction(client, raw);
    default:
      return new ChatInputCommandInteraction(client, raw);
  }
}
