/**
 * Bots e aplicativos (ADR-0032): um bot é um usuário (isBot) com um token `ocb_…` cujo SHA-256 fica no banco. Entra em
 * servidores como membro comum (quem tem MANAGE_SERVER adiciona), registra comandos de barra e recebe os mesmos
 * eventos do gateway que qualquer pessoa. Aqui: ciclo de vida do bot, token, comandos e entrada/saída de servidores.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BOT_TOKEN_PREFIX,
  BotCommand,
  MAX_BOTS_PER_USER,
  Permission,
  rooms,
  type Bot,
  type BotWithToken,
  type CreateBotRequest,
  type ServerCommands,
  type UpdateBotRequest,
} from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../common/auth.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { botIdOf, randomToken, sha256, TokenService, botSessionId } from '../auth/token.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { ServersService } from '../servers/servers.service.js';
import { AvatarService } from '../users/avatar.service.js';

const INCLUDE = { user: { select: USER_PUBLIC_SELECT } } satisfies Prisma.BotInclude;
type Row = Prisma.BotGetPayload<{ include: typeof INCLUDE }>;

const Commands = z.array(BotCommand);
/** O JSON do banco foi validado ao gravar; se algum dia o contrato apertar, uma lista inválida vira vazia. */
export const parseCommands = (json: Prisma.JsonValue): BotCommand[] => {
  const r = Commands.safeParse(json);
  return r.success ? r.data : [];
};

export const serializeBot = (b: Row): Bot => ({
  id: b.id,
  user: userPublic(b.user),
  ownerId: b.ownerId,
  description: b.description,
  public: b.public,
  createdAt: b.createdAt.toISOString(),
  lastSeenAt: b.lastSeenAt?.toISOString() ?? null,
  commands: parseCommands(b.commands),
});

/** Token em claro (aparece uma vez) e o hash que vai ao banco. */
const newToken = () => {
  const token = `${BOT_TOKEN_PREFIX}${randomToken(32)}`;
  return { token, tokenHash: sha256(token) };
};

@Injectable()
export class BotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly servers: ServersService,
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly avatars: AvatarService,
  ) {}

  /** Bot da requisição autenticada com token `ocb_…`; pessoa → 403. */
  async requireBot(auth: AuthUser): Promise<Row> {
    const botId = botIdOf(auth.sessionId);
    if (!botId) throw forbidden('esta rota é só para tokens de bot');
    const bot = await this.prisma.bot.findUnique({ where: { id: botId }, include: INCLUDE });
    if (!bot) throw notFound('bot');
    return bot;
  }

  /** Bot do dono (404 para os outros: não revela que existe). */
  private async requireOwned(ownerId: string, botId: string): Promise<Row> {
    const bot = await this.prisma.bot.findUnique({ where: { id: botId }, include: INCLUDE });
    if (!bot || bot.ownerId !== ownerId) throw notFound('bot');
    return bot;
  }

  // ---------- Meus bots ----------
  async listMine(ownerId: string): Promise<Bot[]> {
    const rows = await this.prisma.bot.findMany({
      where: { ownerId },
      include: INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serializeBot);
  }

  async create(auth: AuthUser, dto: CreateBotRequest): Promise<BotWithToken> {
    if (botIdOf(auth.sessionId)) throw forbidden('um bot não cria bots');
    if ((await this.prisma.bot.count({ where: { ownerId: auth.userId } })) >= MAX_BOTS_PER_USER)
      throw new BadRequestException(`limite de ${MAX_BOTS_PER_USER} bots por pessoa`);
    const { token, tokenHash } = newToken();
    const row = await this.prisma.bot.create({
      data: {
        owner: { connect: { id: auth.userId } },
        description: dto.description,
        public: dto.public,
        tokenHash,
        // usuário próprio do bot: sem senha, sem e-mail, sem apelido reservado; só o token autentica
        user: { create: { username: `bot-${randomBytes(3).toString('hex')}`, displayName: dto.name, isBot: true } },
      },
      include: INCLUDE,
    });
    return { ...serializeBot(row), token };
  }

  async get(userId: string, botId: string): Promise<Bot> {
    const bot = await this.prisma.bot.findUnique({ where: { id: botId }, include: INCLUDE });
    if (!bot || (!bot.public && bot.ownerId !== userId)) throw notFound('bot');
    return serializeBot(bot);
  }

  async update(ownerId: string, botId: string, dto: UpdateBotRequest): Promise<Bot> {
    const bot = await this.requireOwned(ownerId, botId);
    const row = await this.prisma.bot.update({
      where: { id: botId },
      data: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.public !== undefined ? { public: dto.public } : {}),
        ...(dto.name !== undefined && dto.name !== bot.user.displayName
          ? { user: { update: { displayName: dto.name } } }
          : {}),
      },
      include: INCLUDE,
    });
    // o nome é o displayName do usuário do bot: quem compartilha servidor vê a troca na hora
    if (dto.name !== undefined && dto.name !== bot.user.displayName) await this.avatars.announce(bot.userId);
    return serializeBot(row);
  }

  /** O token antigo para de valer na hora: hash novo no banco, cache limpo e sockets do bot derrubados. */
  async regenerateToken(ownerId: string, botId: string): Promise<BotWithToken> {
    const bot = await this.requireOwned(ownerId, botId);
    const { token, tokenHash } = newToken();
    const row = await this.prisma.bot.update({ where: { id: botId }, data: { tokenHash }, include: INCLUDE });
    this.tokens.invalidateCache([botSessionId(botId)]);
    await this.realtime.disconnectUser(bot.userId, 'token_regenerated');
    return { ...serializeBot(row), token };
  }

  /** Sai de todos os servidores, desativa o usuário (as mensagens antigas ficam: autor é obrigatório) e apaga o Bot. */
  async remove(ownerId: string, botId: string) {
    const bot = await this.requireOwned(ownerId, botId);
    const memberships = await this.prisma.serverMember.findMany({
      where: { userId: bot.userId },
      select: { serverId: true },
    });
    for (const m of memberships) {
      await this.servers.removeBotMember(m.serverId, ownerId, bot.userId);
      this.realtime.emit(rooms.server(m.serverId), 'bot:commands:changed', { serverId: m.serverId });
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: bot.userId }, data: { disabledAt: new Date() } }),
      this.prisma.bot.delete({ where: { id: botId } }),
    ]);
    this.tokens.invalidateCache([botSessionId(botId)]);
    await this.realtime.disconnectUser(bot.userId, 'bot_deleted');
  }

  // ---------- Pelo token do bot ----------
  async me(auth: AuthUser): Promise<Bot> {
    return serializeBot(await this.requireBot(auth));
  }

  async setCommands(auth: AuthUser, commands: BotCommand[]): Promise<Bot> {
    const bot = await this.requireBot(auth);
    const row = await this.prisma.bot.update({
      where: { id: bot.id },
      data: { commands: commands as Prisma.InputJsonValue },
      include: INCLUDE,
    });
    for (const s of await this.serversOf(bot.userId))
      this.realtime.emit(rooms.server(s), 'bot:commands:changed', { serverId: s });
    return serializeBot(row);
  }

  private async serversOf(botUserId: string): Promise<string[]> {
    const rows = await this.prisma.serverMember.findMany({ where: { userId: botUserId }, select: { serverId: true } });
    return rows.map((r) => r.serverId);
  }

  // ---------- Diretório e servidores ----------
  async directory(): Promise<Bot[]> {
    const rows = await this.prisma.bot.findMany({
      where: { public: true, user: { disabledAt: null } },
      include: INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serializeBot);
  }

  /** Bots membros do servidor (qualquer membro vê). */
  async listServerBots(userId: string, serverId: string): Promise<Bot[]> {
    await this.perms.server(serverId, userId);
    return (await this.memberBots(serverId)).map(serializeBot);
  }

  private memberBots(serverId: string) {
    return this.prisma.bot.findMany({
      where: { user: { memberships: { some: { serverId } }, disabledAt: null } },
      include: INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Público ou do próprio solicitante; senão 404 (não revela bots privados dos outros). */
  async addToServer(userId: string, serverId: string, botId: string): Promise<Bot> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_SERVER);
    const bot = await this.prisma.bot.findFirst({ where: { id: botId, user: { disabledAt: null } }, include: INCLUDE });
    if (!bot || (!bot.public && bot.ownerId !== userId)) throw notFound('bot');
    await this.servers.addBotMember(serverId, userId, bot.userId);
    this.realtime.emit(rooms.server(serverId), 'bot:commands:changed', { serverId });
    return serializeBot(bot);
  }

  async removeFromServer(userId: string, serverId: string, botId: string) {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_SERVER);
    const bot = await this.prisma.bot.findUnique({ where: { id: botId }, select: { userId: true } });
    if (!bot) throw notFound('bot');
    await this.servers.removeBotMember(serverId, userId, bot.userId);
    this.realtime.emit(rooms.server(serverId), 'bot:commands:changed', { serverId });
  }

  /** Comandos disponíveis no servidor: os dos bots membros (para o autocompletar de `/`). */
  async serverCommands(userId: string, serverId: string): Promise<ServerCommands[]> {
    await this.perms.server(serverId, userId);
    return (await this.memberBots(serverId)).map((b) => ({
      botId: b.id,
      bot: userPublic(b.user),
      commands: parseCommands(b.commands),
    }));
  }
}
