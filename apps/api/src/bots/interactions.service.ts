/**
 * Interações (ADR-0032; v2 na ADR-0034): uma pessoa usa `/comando`, um comando de contexto (pessoa/mensagem), clica
 * num botão/menu, envia um modal ou pede sugestões (autocompletar). A API valida permissão e valores, guarda a
 * interação no Redis (TTL curto) e entrega `interaction:created` só ao usuário do bot. O bot responde pelo REST:
 * `reply` (mensagem no canal ou cartão efêmero), `defer` ("pensando…"), `update` (edita a origem do clique),
 * `modal` (abre um formulário) ou `autocomplete` (sugestões, entregues por pub/sub à requisição que espera).
 */
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  BotCommandChoice,
  CreateInteractionRequest,
  INTERACTION_DEFERRED_TTL_S,
  INTERACTION_FOLLOWUP_TTL_S,
  INTERACTION_TTL_S,
  InteractionAutocompleteRequest,
  InteractionDeferRequest,
  InteractionModalRequest,
  InteractionReplyRequest,
  InteractionUpdateRequest,
  Permission,
  hasPermission,
  type BotCommand,
  type BotCommandType,
  type BotCommandOption,
  type BotSubcommand,
  type BotSubcommandGroup,
  type Button,
  type ChannelKind,
  type CreateInteractionResponse,
  type Interaction,
  type InteractionOptionValue,
  type InteractionReplyResponse,
  type InteractionType,
  type MessageComponents,
  type Modal,
  type SelectMenu,
  type UserPublic,
} from '@opencord/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../common/auth.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { pubsubChannel, RedisService } from '../common/redis.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { botIdOf } from '../auth/token.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { assertNotTimedOut, PermissionsService, type ChannelAccess } from '../servers/permissions.service.js';
import { BotsService, parseCommands } from './bots.service.js';

type Input = z.output<typeof CreateInteractionRequest>;
type ReplyDto = z.output<typeof InteractionReplyRequest>;
type DeferDto = z.output<typeof InteractionDeferRequest>;
type UpdateDto = z.output<typeof InteractionUpdateRequest>;
type ModalDto = z.output<typeof InteractionModalRequest>;
type AutocompleteDto = z.output<typeof InteractionAutocompleteRequest>;
type Options = Record<string, InteractionOptionValue>;

/** O que fica no Redis enquanto o bot não responde. */
interface Stored {
  type: InteractionType;
  botUserId: string;
  botId: string;
  userId: string;
  channelId: string;
  serverId: string;
  /** nome do comando; em componentes e modais, o `customId` (vai em `interaction:replied.command`) */
  command: string;
  options: Options;
  createdAt: string;
  deferred: boolean;
  /** component/modal: de onde veio o clique (mensagem do bot ou cartão efêmero) — é o que `update` edita */
  messageId?: string;
  ephemeralOf?: string;
}

/** Cartão efêmero com botões/menus (`ephemeral:<interactionId>`): o clique chega com `ephemeralOf`. */
interface EphemeralCard {
  botId: string;
  botUserId: string;
  userId: string;
  channelId: string;
  serverId: string;
  components: MessageComponents;
}

/** Modal aberto pelo bot (`modal:<modalId>`): o envio vira interação `modal`. */
interface PendingModal extends Omit<EphemeralCard, 'components'> {
  modal: Modal;
  messageId?: string;
  ephemeralOf?: string;
}

const key = (id: string) => `interaction:${id}`;
const ephemeralKey = (id: string) => `ephemeral:${id}`;
const modalKey = (id: string) => `modal:${id}`;
const autocompleteChannel = (id: string) => pubsubChannel(`interaction:autocomplete:${id}`);
/** autocompletar: o app espera poucos segundos; o bot não precisa de mais que isso para responder */
const AUTOCOMPLETE_TTL_S = 10;
const Choices = z.array(BotCommandChoice).max(25);
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

const isGroup = (o: BotCommand['options'][number]): o is BotSubcommandGroup => o.type === 'subcommand_group';
const isSub = (o: BotCommand['options'][number]): o is BotSubcommand => o.type === 'subcommand';
const isLeaf = (o: BotCommand['options'][number]): o is BotCommandOption => !isGroup(o) && !isSub(o);

interface ResolvedPath {
  subcommandGroup?: string;
  subcommand?: string;
  leaves: BotCommandOption[];
}

/** Caminho comando → grupo → subcomando: falta ou sobra nível → 400. Devolve as opções-folha do nível. */
function resolvePath(command: BotCommand, dto: { subcommandGroup?: string; subcommand?: string }): ResolvedPath {
  const nodes = command.options;
  if (!nodes.some((o) => isGroup(o) || isSub(o))) {
    if (dto.subcommandGroup || dto.subcommand) throw new BadRequestException('este comando não tem subcomandos');
    return { leaves: nodes.filter(isLeaf) };
  }
  if (!dto.subcommand) throw new BadRequestException('informe o subcomando');
  if (dto.subcommandGroup) {
    const group = nodes.find((o): o is BotSubcommandGroup => isGroup(o) && o.name === dto.subcommandGroup);
    if (!group) throw new BadRequestException('grupo de subcomandos desconhecido');
    const sub = group.options.find((s) => s.name === dto.subcommand);
    if (!sub) throw new BadRequestException('subcomando desconhecido');
    return { subcommandGroup: group.name, subcommand: sub.name, leaves: sub.options };
  }
  const sub = nodes.find((o): o is BotSubcommand => isSub(o) && o.name === dto.subcommand);
  if (!sub) throw new BadRequestException('subcomando desconhecido');
  return { subcommand: sub.name, leaves: sub.options };
}

function matchesType(def: BotCommandOption, v: InteractionOptionValue): boolean {
  switch (def.type) {
    case 'string':
      return typeof v === 'string';
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'user':
    case 'channel':
    case 'role':
    case 'mentionable':
      return isUuid(v);
    default:
      return false;
  }
}

/** Botão ou menu com este `customId` (botões de link não têm); desabilitado não aceita clique. */
function findComponent(rows: MessageComponents, customId: string): Button | SelectMenu {
  for (const row of rows)
    for (const c of row.components)
      if (c.customId === customId) {
        if (c.disabled) throw new BadRequestException('componente desabilitado');
        return c;
      }
  throw new BadRequestException('componente desconhecido');
}

/** Campos do modal contra a definição: desconhecidos, obrigatórios e tamanhos. Campo opcional pode vir vazio. */
function validateFields(modal: Modal, given: Record<string, string>): Record<string, string> {
  const defs = new Map(modal.components.map((c) => [c.customId, c]));
  for (const id of Object.keys(given)) if (!defs.has(id)) throw new BadRequestException(`campo desconhecido: ${id}`);
  const out: Record<string, string> = {};
  for (const def of modal.components) {
    const v = given[def.customId];
    if (v === undefined || v === '') {
      if (def.required) throw new BadRequestException(`campo obrigatório: ${def.label}`);
      if (v !== undefined) out[def.customId] = v;
      continue;
    }
    if (def.minLength !== undefined && v.length < def.minLength)
      throw new BadRequestException(`campo ${def.label}: mínimo de ${def.minLength} caracteres`);
    if (def.maxLength !== undefined && v.length > def.maxLength)
      throw new BadRequestException(`campo ${def.label}: máximo de ${def.maxLength} caracteres`);
    out[def.customId] = v;
  }
  return out;
}

/** Ids que precisam existir no servidor (opções e menus de usuário/cargo/canal). */
interface ServerIds {
  users: string[];
  roles: string[];
  mentionables: string[];
  channels: { id: string; label: string; kinds?: ChannelKind[] }[];
}
const noIds = (): ServerIds => ({ users: [], roles: [], mentionables: [], channels: [] });

@Injectable()
export class InteractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    private readonly messages: MessagesService,
    private readonly bots: BotsService,
    private readonly perms: PermissionsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async create(auth: AuthUser, dto: Input): Promise<CreateInteractionResponse> {
    if (botIdOf(auth.sessionId)) throw forbidden('bots não usam comandos');
    switch (dto.type) {
      case 'command':
        return this.createCommand(auth.userId, dto);
      case 'user_command':
        return this.createUserCommand(auth.userId, dto);
      case 'message_command':
        return this.createMessageCommand(auth.userId, dto);
      case 'component':
        return this.createComponent(auth.userId, dto);
      case 'modal':
        return this.createModal(auth.userId, dto);
      case 'autocomplete':
        return this.createAutocomplete(auth.userId, dto);
    }
  }

  // ---------- Comandos ----------

  private async createCommand(userId: string, dto: Extract<Input, { type: 'command' }>) {
    const { access, bot, command } = await this.commandContext(userId, dto.channelId, dto.botId, 'chat', dto.command);
    const path = resolvePath(command, dto);
    const options = await this.validateOptions(access.serverId, path.leaves, dto.options, null);
    await this.requireOnline(bot.userId);
    return this.open(
      { type: 'command', ...this.base(bot, userId, access), command: command.name, options },
      {
        command: command.name,
        ...(path.subcommandGroup ? { subcommandGroup: path.subcommandGroup } : {}),
        ...(path.subcommand ? { subcommand: path.subcommand } : {}),
      },
    );
  }

  private async createUserCommand(userId: string, dto: Extract<Input, { type: 'user_command' }>) {
    const { access, bot, command } = await this.commandContext(userId, dto.channelId, dto.botId, 'user', dto.command);
    const target = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: access.serverId, userId: dto.targetUserId } },
      select: { user: { select: USER_PUBLIC_SELECT } },
    });
    if (!target) throw new BadRequestException('a pessoa não é membro do servidor');
    await this.requireOnline(bot.userId);
    return this.open(
      { type: 'user_command', ...this.base(bot, userId, access), command: command.name, options: {} },
      { command: command.name, targetUser: userPublic(target.user) },
    );
  }

  private async createMessageCommand(userId: string, dto: Extract<Input, { type: 'message_command' }>) {
    const msg = await this.visibleServerMessage(userId, dto.messageId, 'comandos de mensagem');
    const { access, bot, command } = await this.commandContext(
      userId,
      msg.channelId,
      dto.botId,
      'message',
      dto.command,
    );
    await this.requireOnline(bot.userId);
    return this.open(
      { type: 'message_command', ...this.base(bot, userId, access), command: command.name, options: {} },
      { command: command.name, targetMessage: msg },
    );
  }

  private async createAutocomplete(userId: string, dto: Extract<Input, { type: 'autocomplete' }>) {
    const { access, bot, command } = await this.commandContext(userId, dto.channelId, dto.botId, 'chat', dto.command);
    const path = resolvePath(command, dto);
    const focused = path.leaves.find((o) => o.name === dto.focused);
    if (!focused?.autocomplete) throw new BadRequestException('opção em foco não tem autocompletar');
    // o texto parcial da opção em foco pode ainda estar vazio
    const given: Options = { ...dto.options, [dto.focused]: dto.options[dto.focused] ?? '' };
    const options = await this.validateOptions(access.serverId, path.leaves, given, dto.focused);
    await this.requireOnline(bot.userId);
    const stored = this.fresh({
      type: 'autocomplete',
      ...this.base(bot, userId, access),
      command: command.name,
      options,
    });
    const id = randomUUID();
    const user = await this.person(userId);
    await this.store(id, stored, AUTOCOMPLETE_TTL_S);
    // assina antes de avisar o bot: a resposta dele não pode chegar antes da espera começar
    const choices = await this.awaitChoices(id, () =>
      this.emitCreated(id, stored, user, {
        command: command.name,
        ...(path.subcommandGroup ? { subcommandGroup: path.subcommandGroup } : {}),
        ...(path.subcommand ? { subcommand: path.subcommand } : {}),
        focused: dto.focused,
      }),
    );
    return { id, choices };
  }

  /**
   * Acesso de quem posta no canal (texto, VIEW_CHANNEL implícito, SEND_MESSAGES, sem castigo), bot membro e online
   * depois; o comando precisa existir com este tipo, valer neste servidor (`guildIds`) e a pessoa ter os bits de
   * `defaultMemberPermissions` (dono e ADMINISTRATOR passam).
   */
  private async commandContext(userId: string, channelId: string, botId: string, type: BotCommandType, name: string) {
    const access = await this.perms.channel(channelId, userId);
    if (access.kind !== 'text') throw new BadRequestException('comandos só em canais de texto');
    if (!hasPermission(access.perms, Permission.SEND_MESSAGES)) throw forbidden('sem permissão para enviar mensagens');
    assertNotTimedOut(access);
    const bot = await this.memberBot(access.serverId, { id: botId });
    const command = parseCommands(bot.commands).find((c) => c.type === type && c.name === name);
    if (!command) throw new BadRequestException('comando desconhecido');
    if (command.guildIds.length && !command.guildIds.includes(access.serverId))
      throw new BadRequestException('comando não disponível neste servidor');
    if (
      command.defaultMemberPermissions !== null &&
      access.base !== ALL_PERMISSIONS &&
      !hasPermission(access.base, command.defaultMemberPermissions)
    )
      throw forbidden('sem permissão para este comando');
    return { access, bot, command };
  }

  /**
   * Opções contra as folhas do nível: desconhecidas, obrigatórias, tipo, escolhas, limites; user/channel/role/
   * mentionable precisam ser do servidor. Autocompletar (`focused`): a opção em foco é texto parcial e as outras só
   * precisam ter o tipo certo (sem obrigatórias, escolhas nem limites: ainda estão sendo digitadas).
   */
  private async validateOptions(
    serverId: string,
    defs: BotCommandOption[],
    given: Options,
    focused: string | null,
  ): Promise<Options> {
    const byName = new Map(defs.map((o) => [o.name, o]));
    for (const name of Object.keys(given))
      if (!byName.has(name)) throw new BadRequestException(`opção desconhecida: ${name}`);
    const out: Options = {};
    const ids = noIds();
    for (const def of defs) {
      const v = given[def.name];
      if (v === undefined) {
        if (def.required && !focused) throw new BadRequestException(`opção obrigatória: ${def.name}`);
        continue;
      }
      if (focused) {
        if (def.name === focused) {
          if (typeof v !== 'string')
            throw new BadRequestException(`opção ${def.name}: o texto parcial deve ser string`);
        } else if (!matchesType(def, v)) throw new BadRequestException(`opção ${def.name}: esperava ${def.type}`);
        out[def.name] = v;
        continue;
      }
      if (!matchesType(def, v)) throw new BadRequestException(`opção ${def.name}: esperava ${def.type}`);
      if (def.choices.length && !def.choices.some((c) => c.value === v))
        throw new BadRequestException(`opção ${def.name}: valor fora das escolhas`);
      if (typeof v === 'number') {
        if (def.minValue !== undefined && v < def.minValue)
          throw new BadRequestException(`opção ${def.name}: mínimo ${def.minValue}`);
        if (def.maxValue !== undefined && v > def.maxValue)
          throw new BadRequestException(`opção ${def.name}: máximo ${def.maxValue}`);
      }
      if (def.type === 'string' && typeof v === 'string') {
        if (def.minLength !== undefined && v.length < def.minLength)
          throw new BadRequestException(`opção ${def.name}: mínimo de ${def.minLength} caracteres`);
        if (def.maxLength !== undefined && v.length > def.maxLength)
          throw new BadRequestException(`opção ${def.name}: máximo de ${def.maxLength} caracteres`);
      }
      if (typeof v === 'string') {
        if (def.type === 'user') ids.users.push(v);
        if (def.type === 'role') ids.roles.push(v);
        if (def.type === 'mentionable') ids.mentionables.push(v);
        if (def.type === 'channel') ids.channels.push({ id: v, label: `opção ${def.name}`, kinds: def.channelTypes });
      }
      out[def.name] = v;
    }
    await this.assertServerIds(serverId, ids);
    return out;
  }

  /** Usuários membros, cargos e canais deste servidor (e do tipo pedido); senão 400. */
  private async assertServerIds(serverId: string, ids: ServerIds) {
    const memberIds = async (list: string[]) => {
      const rows = await this.prisma.serverMember.findMany({
        where: { serverId, userId: { in: list } },
        select: { userId: true },
      });
      return new Set(rows.map((r) => r.userId));
    };
    const roleIds = async (list: string[]) => {
      const rows = await this.prisma.role.findMany({ where: { serverId, id: { in: list } }, select: { id: true } });
      return new Set(rows.map((r) => r.id));
    };
    if (ids.users.length) {
      const found = await memberIds(ids.users);
      if (ids.users.some((id) => !found.has(id)))
        throw new BadRequestException('opção de usuário: não é membro do servidor');
    }
    if (ids.roles.length) {
      const found = await roleIds(ids.roles);
      if (ids.roles.some((id) => !found.has(id))) throw new BadRequestException('opção de cargo: não é deste servidor');
    }
    if (ids.mentionables.length) {
      const [members, roles] = await Promise.all([memberIds(ids.mentionables), roleIds(ids.mentionables)]);
      if (ids.mentionables.some((id) => !members.has(id) && !roles.has(id)))
        throw new BadRequestException('opção mencionável: não é membro nem cargo do servidor');
    }
    if (ids.channels.length) {
      const rows = await this.prisma.channel.findMany({
        where: { serverId, id: { in: ids.channels.map((c) => c.id) } },
        select: { id: true, kind: true },
      });
      const kinds = new Map(rows.map((r) => [r.id, r.kind]));
      for (const c of ids.channels) {
        const kind = kinds.get(c.id);
        if (!kind) throw new BadRequestException(`${c.label}: canal não é deste servidor`);
        if (c.kinds?.length && !c.kinds.includes(kind))
          throw new BadRequestException(`${c.label}: canal precisa ser do tipo ${c.kinds.join(' ou ')}`);
      }
    }
  }

  // ---------- Componentes e modais ----------

  private async createComponent(userId: string, dto: Extract<Input, { type: 'component' }>) {
    if (dto.messageId) {
      const msg = await this.visibleServerMessage(userId, dto.messageId, 'botões e menus');
      const access = await this.perms.channel(msg.channelId, userId);
      assertNotTimedOut(access);
      // o autor precisa ser um bot (webhooks e pessoas não têm componentes) ainda membro do servidor
      const bot = await this.memberBot(access.serverId, { userId: msg.author.id }).catch(() => {
        throw new BadRequestException('a mensagem não é de um bot');
      });
      const component = findComponent(msg.components, dto.customId);
      const values = await this.validateComponent(access.serverId, component, dto.values);
      await this.requireOnline(bot.userId);
      return this.open(
        {
          type: 'component',
          ...this.base(bot, userId, access),
          command: dto.customId,
          options: {},
          messageId: msg.id,
        },
        { customId: dto.customId, componentType: component.type, values, targetMessage: msg },
      );
    }
    const ephemeralOf = dto.ephemeralOf;
    if (!ephemeralOf) throw new BadRequestException('informe messageId ou ephemeralOf');
    const card = await this.readJson<EphemeralCard>(ephemeralKey(ephemeralOf));
    if (!card || card.userId !== userId) throw notFound('cartão efêmero');
    const access = await this.perms.server(card.serverId, userId);
    assertNotTimedOut(access);
    const bot = await this.memberBot(card.serverId, { id: card.botId });
    const component = findComponent(card.components, dto.customId);
    const values = await this.validateComponent(card.serverId, component, dto.values);
    await this.requireOnline(bot.userId);
    return this.open(
      {
        type: 'component',
        botId: bot.id,
        botUserId: bot.userId,
        userId,
        channelId: card.channelId,
        serverId: card.serverId,
        command: dto.customId,
        options: {},
        ephemeralOf,
      },
      { customId: dto.customId, componentType: component.type, values, ephemeralOf },
    );
  }

  /** Botão: sem valores. Menu: quantidade entre min/max; texto ⊆ opções; user/role/channel do servidor. */
  private async validateComponent(serverId: string, c: Button | SelectMenu, values: string[]): Promise<string[]> {
    if (c.type === 'button') {
      if (values.length) throw new BadRequestException('botão não recebe valores');
      return [];
    }
    if (new Set(values).size !== values.length) throw new BadRequestException('valor repetido');
    if (values.length < c.minValues || values.length > c.maxValues)
      throw new BadRequestException(`escolha entre ${c.minValues} e ${c.maxValues}`);
    const ids = noIds();
    switch (c.kind) {
      case 'string':
        if (values.some((v) => !c.options.some((o) => o.value === v)))
          throw new BadRequestException('valor fora das opções do menu');
        break;
      case 'user':
      case 'role':
      case 'channel':
        if (!values.every(isUuid)) throw new BadRequestException('valores do menu devem ser ids');
        if (c.kind === 'user') ids.users = values;
        if (c.kind === 'role') ids.roles = values;
        if (c.kind === 'channel') ids.channels = values.map((id) => ({ id, label: 'menu de canal' }));
        break;
    }
    await this.assertServerIds(serverId, ids);
    return values;
  }

  private async createModal(userId: string, dto: Extract<Input, { type: 'modal' }>) {
    const pending = await this.readJson<PendingModal>(modalKey(dto.modalId));
    if (!pending || pending.userId !== userId) throw notFound('modal');
    const access = await this.perms.server(pending.serverId, userId);
    assertNotTimedOut(access);
    const fields = validateFields(pending.modal, dto.fields);
    const bot = await this.memberBot(pending.serverId, { id: pending.botId });
    await this.requireOnline(bot.userId);
    // consome o modal: segundo envio (ou corrida) → 404
    if (!(await this.redis.client.del(modalKey(dto.modalId)))) throw notFound('modal');
    return this.open(
      {
        type: 'modal',
        botId: bot.id,
        botUserId: bot.userId,
        userId,
        channelId: pending.channelId,
        serverId: pending.serverId,
        command: pending.modal.customId,
        options: {},
        // herda a origem de quem abriu o modal: `update` continua editando a mensagem/cartão certo
        ...(pending.messageId ? { messageId: pending.messageId } : {}),
        ...(pending.ephemeralOf ? { ephemeralOf: pending.ephemeralOf } : {}),
      },
      { customId: pending.modal.customId, fields },
    );
  }

  // ---------- Apoio ----------

  /** Mensagem que a pessoa vê (404 senão), em canal de servidor e não apagada. */
  private async visibleServerMessage(userId: string, messageId: string, what: string) {
    const msg = await this.messages.get(userId, messageId);
    if (!msg.channelId) throw new BadRequestException(`${what} só em canais de servidor`);
    if (msg.deleted) throw notFound('mensagem');
    return { ...msg, channelId: msg.channelId };
  }

  /** Bot ativo e membro do servidor, pelo id do Bot ou pelo id do usuário dele; senão 404. */
  private async memberBot(serverId: string, by: { id: string } | { userId: string }) {
    const bot = await this.prisma.bot.findFirst({
      where: { ...by, user: { memberships: { some: { serverId } }, disabledAt: null } },
      select: { id: true, userId: true, commands: true },
    });
    if (!bot) throw notFound('bot');
    return bot;
  }

  private async requireOnline(botUserId: string) {
    if (!(await this.realtime.isUserConnected(botUserId))) throw new ConflictException('bot offline');
  }

  private person(userId: string): Promise<UserPublic> {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: USER_PUBLIC_SELECT }).then(userPublic);
  }

  private base(
    bot: { id: string; userId: string },
    userId: string,
    access: Pick<ChannelAccess, 'channelId' | 'serverId'>,
  ) {
    return { botId: bot.id, botUserId: bot.userId, userId, channelId: access.channelId, serverId: access.serverId };
  }

  private fresh(s: Omit<Stored, 'createdAt' | 'deferred'>): Stored {
    return { ...s, createdAt: new Date().toISOString(), deferred: false };
  }

  private store(id: string, stored: Stored, ttlS: number) {
    return this.redis.client.set(key(id), JSON.stringify(stored), 'EX', ttlS);
  }

  private async readJson<T>(k: string): Promise<T | null> {
    const raw = await this.redis.client.get(k);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /** Guarda a interação e avisa o bot. */
  private async open(s: Omit<Stored, 'createdAt' | 'deferred'>, extra: Partial<Interaction>): Promise<{ id: string }> {
    const stored = this.fresh(s);
    const id = randomUUID();
    const user = await this.person(stored.userId);
    await this.store(id, stored, INTERACTION_TTL_S);
    this.emitCreated(id, stored, user, extra);
    return { id };
  }

  private emitCreated(id: string, stored: Stored, user: UserPublic, extra: Partial<Interaction>) {
    const payload: Interaction = {
      id,
      type: stored.type,
      serverId: stored.serverId,
      channelId: stored.channelId,
      botId: stored.botId,
      user,
      createdAt: stored.createdAt,
      options: stored.options,
      ...extra,
    };
    this.realtime.toUser(stored.botUserId, 'interaction:created', payload);
  }

  /**
   * Espera as sugestões do bot (`POST /interactions/:id/autocomplete` publica em `interaction:autocomplete:<id>`)
   * por até AUTOCOMPLETE_TIMEOUT_MS; sem resposta, lista vazia. `emit` roda depois de a assinatura estar de pé.
   */
  private awaitChoices(id: string, emit: () => void): Promise<BotCommandChoice[]> {
    const channel = autocompleteChannel(id);
    const sub = this.redis.subscriber;
    return new Promise((resolve) => {
      let done = false;
      let timer: NodeJS.Timeout | null = null;
      const finish = (choices: BotCommandChoice[]) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        sub.off('message', onMessage);
        sub.unsubscribe(channel).catch(() => undefined);
        resolve(choices);
      };
      const onMessage = (ch: string, raw: string) => {
        if (ch !== channel) return;
        const r = Choices.safeParse(JSON.parse(raw));
        finish(r.success ? r.data : []);
      };
      sub.on('message', onMessage);
      sub.subscribe(channel).then(
        () => {
          timer = setTimeout(() => finish([]), this.cfg.AUTOCOMPLETE_TIMEOUT_MS);
          emit();
        },
        () => finish([]),
      );
    });
  }

  // ---------- Respostas do bot ----------

  /** Interação pendente do bot autenticado; de outro bot ou já respondida → 404. */
  private async pendingOf(auth: AuthUser, id: string): Promise<Stored> {
    const bot = await this.bots.requireBot(auth);
    const stored = await this.readJson<Stored>(key(id));
    if (!stored || stored.botId !== bot.id) throw notFound('interação');
    return stored;
  }

  /** Consome a interação: segunda resposta (ou corrida entre duas) → 404. */
  private async consume(id: string) {
    if (!(await this.redis.client.del(key(id)))) throw notFound('interação');
  }

  private async replied(
    stored: Stored,
    interactionId: string,
    r: { content: string | null; embeds?: ReplyDto['embeds']; components?: MessageComponents; update?: boolean },
  ) {
    const bot = await this.person(stored.botUserId);
    this.realtime.toUser(stored.userId, 'interaction:replied', {
      interactionId,
      channelId: stored.channelId,
      serverId: stored.serverId,
      bot,
      command: stored.command,
      content: r.content,
      ...(r.embeds !== undefined ? { embeds: r.embeds } : {}),
      ...(r.components !== undefined ? { components: r.components } : {}),
      ...(r.update ? { update: true } : {}),
    });
  }

  /** Cartão efêmero com botões/menus: guarda para validar o clique (`ephemeralOf`) e para `update`. */
  private saveCard(interactionId: string, stored: Stored, components: MessageComponents) {
    const card: EphemeralCard = {
      botId: stored.botId,
      botUserId: stored.botUserId,
      userId: stored.userId,
      channelId: stored.channelId,
      serverId: stored.serverId,
      components,
    };
    return this.redis.client.set(ephemeralKey(interactionId), JSON.stringify(card), 'EX', INTERACTION_FOLLOWUP_TTL_S);
  }

  /** "Pensando…": estende o prazo e avisa quem interagiu; `update: true` só acusa (nada aparece). */
  async defer(auth: AuthUser, id: string, dto: DeferDto) {
    const stored = await this.pendingOf(auth, id);
    if (stored.type === 'autocomplete') throw new BadRequestException('autocompletar responde em /autocomplete');
    stored.deferred = true;
    await this.store(id, stored, INTERACTION_DEFERRED_TTL_S);
    if (!dto.update) await this.replied(stored, id, { content: null });
  }

  async reply(auth: AuthUser, id: string, dto: ReplyDto): Promise<InteractionReplyResponse> {
    const stored = await this.pendingOf(auth, id);
    if (stored.type === 'autocomplete') throw new BadRequestException('autocompletar responde em /autocomplete');
    if (dto.ephemeral && dto.attachmentIds?.length) throw new BadRequestException('resposta efêmera não leva anexos');
    await this.consume(id);
    if (dto.ephemeral) {
      await this.replied(stored, id, { content: dto.content, embeds: dto.embeds, components: dto.components });
      if (dto.components?.length) await this.saveCard(id, stored, dto.components);
      return { messageId: null };
    }
    const { message } = await this.messages.create(
      stored.botUserId,
      { channelId: stored.channelId },
      {
        requestId: randomUUID(),
        body: dto.content,
        embeds: dto.embeds,
        components: dto.components,
        attachmentIds: dto.attachmentIds,
      },
    );
    return { messageId: message.id };
  }

  /** Edita a origem do clique: a mensagem do bot (como autor) ou o cartão efêmero (evento `update: true`). */
  async update(auth: AuthUser, id: string, dto: UpdateDto): Promise<InteractionReplyResponse> {
    const stored = await this.pendingOf(auth, id);
    if (stored.type !== 'component' && stored.type !== 'modal')
      throw new BadRequestException('só componentes e modais atualizam a origem');
    if (!stored.messageId && !stored.ephemeralOf)
      throw new BadRequestException('esta interação não tem mensagem nem cartão de origem');
    await this.consume(id);
    if (stored.messageId) {
      const m = await this.messages.edit(stored.botUserId, stored.messageId, {
        ...(dto.content !== undefined ? { body: dto.content } : {}),
        embeds: dto.embeds,
        components: dto.components,
      });
      return { messageId: m.id };
    }
    const ephemeralOf = stored.ephemeralOf as string;
    const card = await this.readJson<EphemeralCard>(ephemeralKey(ephemeralOf));
    await this.replied(stored, ephemeralOf, {
      content: dto.content ?? null,
      embeds: dto.embeds,
      components: dto.components,
      update: true,
    });
    // o cartão novo é o que vale para o próximo clique
    const components = dto.components ?? card?.components ?? [];
    if (components.length) await this.saveCard(ephemeralOf, stored, components);
    else await this.redis.client.del(ephemeralKey(ephemeralOf));
    return { messageId: null };
  }

  /** Abre um formulário para quem interagiu; consome a interação (o envio vira interação `modal`). */
  async modal(auth: AuthUser, id: string, dto: ModalDto) {
    const stored = await this.pendingOf(auth, id);
    if (stored.type === 'modal' || stored.type === 'autocomplete')
      throw new BadRequestException('esta interação não abre modal');
    if (stored.deferred) throw new BadRequestException('interação já adiada não abre modal');
    await this.consume(id);
    const modalId = randomUUID();
    const pending: PendingModal = {
      botId: stored.botId,
      botUserId: stored.botUserId,
      userId: stored.userId,
      channelId: stored.channelId,
      serverId: stored.serverId,
      modal: dto.modal,
      ...(stored.messageId ? { messageId: stored.messageId } : {}),
      ...(stored.ephemeralOf ? { ephemeralOf: stored.ephemeralOf } : {}),
    };
    await this.redis.client.set(modalKey(modalId), JSON.stringify(pending), 'EX', INTERACTION_FOLLOWUP_TTL_S);
    this.realtime.toUser(stored.userId, 'interaction:modal', {
      interactionId: id,
      modalId,
      channelId: stored.channelId,
      serverId: stored.serverId,
      bot: await this.person(stored.botUserId),
      modal: dto.modal,
    });
  }

  /** Sugestões para a opção em foco: entrega à requisição `POST /interactions` que está esperando. */
  async autocomplete(auth: AuthUser, id: string, dto: AutocompleteDto) {
    const stored = await this.pendingOf(auth, id);
    if (stored.type !== 'autocomplete') throw notFound('interação');
    await this.consume(id);
    await this.redis.client.publish(autocompleteChannel(id), JSON.stringify(dto.choices));
  }
}
