/**
 * Interações (ADR-0032): uma pessoa usa `/comando` num canal de texto; a API valida permissão e opções, guarda a
 * interação no Redis (TTL curto) e entrega `interaction:created` só ao usuário do bot. O bot responde pelo REST:
 * efêmera vira evento `interaction:replied` só para quem usou; normal vira mensagem comum do bot no canal.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  INTERACTION_DEFERRED_TTL_S,
  INTERACTION_TTL_S,
  Permission,
  hasPermission,
  type BotCommand,
  type BotCommandOption,
  type CreateInteractionRequest,
  type Interaction,
  type InteractionOptionValue,
  type InteractionReplyRequest,
  type InteractionReplyResponse,
} from '@opencord/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../common/auth.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { RedisService } from '../common/redis.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { botIdOf } from '../auth/token.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { assertNotTimedOut } from '../servers/permissions.service.js';
import { BotsService, parseCommands } from './bots.service.js';

/** O que fica no Redis enquanto o bot não responde. */
interface Stored {
  botUserId: string;
  botId: string;
  userId: string;
  channelId: string;
  serverId: string;
  command: string;
  options: Record<string, InteractionOptionValue>;
  createdAt: string;
  deferred: boolean;
}

const key = (id: string) => `interaction:${id}`;
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

@Injectable()
export class InteractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    private readonly messages: MessagesService,
    private readonly bots: BotsService,
  ) {}

  async create(auth: AuthUser, dto: CreateInteractionRequest): Promise<{ id: string }> {
    if (botIdOf(auth.sessionId)) throw forbidden('bots não usam comandos de barra');
    // mesmo acesso de quem posta no canal: texto, VIEW_CHANNEL (implícito) e SEND_MESSAGES
    const a = await this.messages.access(auth.userId, { channelId: dto.channelId });
    if (!a.serverId || !a.channelId) throw new BadRequestException('comandos só em canais de servidor');
    if (!hasPermission(a.perms, Permission.SEND_MESSAGES)) throw forbidden('sem permissão para enviar mensagens');
    // em castigo (ADR-0034) não usa comandos
    assertNotTimedOut(a);
    const serverId = a.serverId;
    const bot = await this.prisma.bot.findFirst({
      where: { id: dto.botId, user: { memberships: { some: { serverId } }, disabledAt: null } },
      select: { id: true, userId: true, commands: true },
    });
    if (!bot) throw notFound('bot');
    const command = parseCommands(bot.commands).find((c) => c.name === dto.command);
    if (!command) throw new BadRequestException('comando desconhecido');
    const options = await this.validateOptions(serverId, command, dto.options);
    if (!(await this.realtime.isUserConnected(bot.userId))) throw new ConflictException('bot offline');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: USER_PUBLIC_SELECT });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const stored: Stored = {
      botUserId: bot.userId,
      botId: bot.id,
      userId: auth.userId,
      channelId: dto.channelId,
      serverId,
      command: command.name,
      options,
      createdAt,
      deferred: false,
    };
    await this.redis.client.set(key(id), JSON.stringify(stored), 'EX', INTERACTION_TTL_S);
    const payload: Interaction = {
      id,
      serverId,
      channelId: dto.channelId,
      botId: bot.id,
      user: userPublic(user),
      command: command.name,
      options,
      createdAt,
    };
    this.realtime.toUser(bot.userId, 'interaction:created', payload);
    return { id };
  }

  /** Opções contra a definição do comando: tipo, obrigatórias, escolhas, desconhecidas; user/channel do servidor. */
  private async validateOptions(
    serverId: string,
    command: BotCommand,
    given: Record<string, InteractionOptionValue>,
  ): Promise<Record<string, InteractionOptionValue>> {
    const defs = new Map(command.options.map((o) => [o.name, o]));
    for (const name of Object.keys(given))
      if (!defs.has(name)) throw new BadRequestException(`opção desconhecida: ${name}`);
    const out: Record<string, InteractionOptionValue> = {};
    const userIds: string[] = [];
    const channelIds: string[] = [];
    for (const def of command.options) {
      const v = given[def.name];
      if (v === undefined) {
        if (def.required) throw new BadRequestException(`opção obrigatória: ${def.name}`);
        continue;
      }
      if (!this.matchesType(def, v)) throw new BadRequestException(`opção ${def.name}: esperava ${def.type}`);
      if (def.choices.length && !def.choices.some((c) => c.value === v))
        throw new BadRequestException(`opção ${def.name}: valor fora das escolhas`);
      if (def.type === 'user') userIds.push(v as string);
      if (def.type === 'channel') channelIds.push(v as string);
      out[def.name] = v;
    }
    if (userIds.length) {
      const n = await this.prisma.serverMember.count({ where: { serverId, userId: { in: userIds } } });
      if (n !== new Set(userIds).size) throw new BadRequestException('opção de usuário: não é membro do servidor');
    }
    if (channelIds.length) {
      const n = await this.prisma.channel.count({ where: { serverId, id: { in: channelIds } } });
      if (n !== new Set(channelIds).size) throw new BadRequestException('opção de canal: não é deste servidor');
    }
    return out;
  }

  private matchesType(def: BotCommandOption, v: InteractionOptionValue): boolean {
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
        return isUuid(v);
    }
  }

  /** Interação pendente do bot autenticado; de outro bot ou já respondida → 404. */
  private async pendingOf(auth: AuthUser, id: string): Promise<Stored> {
    const bot = await this.bots.requireBot(auth);
    const raw = await this.redis.client.get(key(id));
    const stored = raw ? (JSON.parse(raw) as Stored) : null;
    if (!stored || stored.botId !== bot.id) throw notFound('interação');
    return stored;
  }

  private async replied(stored: Stored, interactionId: string, content: string | null) {
    const bot = await this.prisma.user.findUniqueOrThrow({
      where: { id: stored.botUserId },
      select: USER_PUBLIC_SELECT,
    });
    this.realtime.toUser(stored.userId, 'interaction:replied', {
      interactionId,
      channelId: stored.channelId,
      serverId: stored.serverId,
      bot: userPublic(bot),
      command: stored.command,
      content,
    });
  }

  /** "Pensando…": estende o prazo e avisa quem usou o comando. */
  async defer(auth: AuthUser, id: string) {
    const stored = await this.pendingOf(auth, id);
    stored.deferred = true;
    await this.redis.client.set(key(id), JSON.stringify(stored), 'EX', INTERACTION_DEFERRED_TTL_S);
    await this.replied(stored, id, null);
  }

  async reply(auth: AuthUser, id: string, dto: InteractionReplyRequest): Promise<InteractionReplyResponse> {
    const stored = await this.pendingOf(auth, id);
    // apaga antes de responder: segunda resposta (ou corrida entre duas) → 404
    if (!(await this.redis.client.del(key(id)))) throw notFound('interação');
    if (dto.ephemeral) {
      await this.replied(stored, id, dto.content);
      return { messageId: null };
    }
    const { message } = await this.messages.create(
      stored.botUserId,
      { channelId: stored.channelId },
      { requestId: randomUUID(), body: dto.content },
    );
    return { messageId: message.id };
  }
}
