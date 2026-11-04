import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  type Member,
  ALL_PERMISSIONS,
  Permission,
  hasPermission,
  INVITE_CODE,
  REACTION_ROLE_FORBIDDEN,
  rooms,
  type Category,
  type Channel,
  type PermissionOverrideDto,
  type Role,
  type ServerDetail,
  type ServerDirectoryEntry,
  type AdminServerEntry,
  type Invite,
  type InvitePreview,
  type ServerSummary,
} from '@opencord/contracts';
import { randomInt } from 'node:crypto';
import { createServerShell, createServerWithDefaults } from '@opencord/db';
import type { ImportPlan } from './discord-template.js';
import { PrismaService } from '../common/prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DomainEvents } from '../common/domain-events.js';
import { forbidden, notFound } from '../common/errors.js';
import { category, channel, member, MEMBER_INCLUDE, role, serverSummary } from '../common/serialize.js';
import { PresenceService } from '../realtime/presence.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService, type ServerAccess } from './permissions.service.js';

const MAX_SERVERS_PER_OWNER = 20;
const MAX_CHANNELS = 200;
const MAX_ROLES = 100;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** 10 caracteres de um alfabeto sem ambíguos (~57 bits): inviável de adivinhar com o rate limit. */
const inviteCode = () => Array.from({ length: 10 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');

/** janela da série de mensagens do painel do super admin */
const ADMIN_DAYS = 14;

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
    private readonly presence: PresenceService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  // ---------- Servidores ----------
  async listMine(userId: string): Promise<ServerSummary[]> {
    const rows = await this.prisma.serverMember.findMany({
      where: { userId },
      include: { server: true },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => serverSummary(r.server));
  }

  async create(userId: string, name: string): Promise<ServerDetail> {
    const owned = await this.prisma.server.count({ where: { ownerId: userId } });
    if (owned >= MAX_SERVERS_PER_OWNER) throw new BadRequestException('limite de servidores atingido');
    const server = await this.prisma.$transaction((tx) => createServerWithDefaults(tx, userId, name));
    await this.audit.log(userId, server.id, 'server.create', server.id, { name });
    return this.announceNew(server, userId);
  }

  /** Servidor novo: avisa cada membro conectado (no oficial, todos; no privado, só o dono) para carregá-lo. */
  private async announceNew(
    server: { id: string; name: string; ownerId: string; iconKey: string | null; official: boolean },
    userId: string,
  ) {
    const members = await this.prisma.serverMember.findMany({
      where: { serverId: server.id },
      select: { userId: true },
    });
    for (const m of members) {
      await this.realtime.syncUserRooms(m.userId);
      if (m.userId !== userId) this.realtime.toUser(m.userId, 'server:added', serverSummary(server));
    }
    return this.detail(server.id, userId);
  }

  /** Cria um servidor a partir de um plano de importação (estrutura de um modelo do Discord). */
  async createFromPlan(userId: string, plan: ImportPlan, source: string): Promise<ServerDetail> {
    const owned = await this.prisma.server.count({ where: { ownerId: userId } });
    if (owned >= MAX_SERVERS_PER_OWNER) throw new BadRequestException('limite de servidores atingido');
    const server = await this.prisma.$transaction(
      async (tx) => {
        const { server, everyone } = await createServerShell(tx, userId, plan.name, plan.everyonePermissions);
        const roleIds = new Map<string, string>([['everyone', everyone.id]]);
        // na ordem do modelo (da base para o topo): posição 1 = logo acima de @everyone
        for (const [i, r] of plan.roles.entries()) {
          const row = await tx.role.create({
            data: { serverId: server.id, name: r.name, color: r.color, permissions: r.permissions, position: i + 1 },
          });
          roleIds.set(r.key, row.id);
        }
        const catIds = new Map<string, string>();
        for (const [i, c] of plan.categories.entries()) {
          const row = await tx.category.create({ data: { serverId: server.id, name: c.name, position: i } });
          catIds.set(c.key, row.id);
        }
        for (const [i, c] of plan.channels.entries()) {
          await tx.channel.create({
            data: {
              serverId: server.id,
              categoryId: c.categoryKey ? (catIds.get(c.categoryKey) ?? null) : null,
              kind: c.kind,
              name: c.name,
              topic: c.topic,
              position: i,
              overrides: {
                create: c.overrides
                  .filter((o) => roleIds.has(o.roleKey))
                  .map((o) => ({
                    subjectType: 'role' as const,
                    subjectId: roleIds.get(o.roleKey)!,
                    allow: o.allow,
                    deny: o.deny,
                  })),
              },
            },
          });
        }
        return server;
      },
      { timeout: 30_000 },
    );
    await this.audit.log(userId, server.id, 'server.import', server.id, {
      source,
      roles: plan.roles.length,
      categories: plan.categories.length,
      channels: plan.channels.length,
      skipped: plan.skipped,
    });
    return this.announceNew(server, userId);
  }

  async detail(serverId: string, userId: string): Promise<ServerDetail> {
    const access = await this.perms.server(serverId, userId);
    const s = await this.prisma.server.findUniqueOrThrow({
      where: { id: serverId },
      include: {
        roles: { orderBy: { position: 'asc' } },
        categories: { orderBy: { position: 'asc' } },
        channels: { include: { overrides: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        // super admin invisível (ADR-0013): só ele mesmo se vê na lista
        members: {
          where: { OR: [{ hidden: false }, { userId }] },
          include: MEMBER_INCLUDE,
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    const chPerms = await this.perms.channelsFor(access, s.channels);
    const canManage =
      hasPermission(access.base, Permission.MANAGE_CHANNELS) || hasPermission(access.base, Permission.MANAGE_ROLES);
    return {
      ...serverSummary(s),
      roles: s.roles.map(role),
      categories: s.categories.map(category),
      channels: s.channels
        .filter((c) => (chPerms.get(c.id) ?? 0) !== 0)
        // overrides só são expostos a quem pode gerenciá-los
        .map((c) => channel(c, chPerms.get(c.id) ?? 0, s.roles.find((r) => r.isEveryone)?.id ?? null, !canManage)),
      members: s.members.map(member),
      myPermissions: access.base,
    };
  }

  async update(
    serverId: string,
    userId: string,
    dto: {
      name?: string | undefined;
      accent?: string | null | undefined;
      aiRules?: string | null | undefined;
      afkChannelId?: string | null | undefined;
      afkTimeoutSec?: number | undefined;
    },
  ): Promise<ServerSummary> {
    await this.perms.requireServer(serverId, userId, Permission.MANAGE_SERVER);
    // canal de ausentes (ADR-0049): canal de voz comum deste servidor (não o criador de salas nem sala temporária)
    if (dto.afkChannelId) {
      const ch = await this.prisma.channel.findUnique({
        where: { id: dto.afkChannelId },
        select: { serverId: true, kind: true, roomHub: true, temporary: true },
      });
      if (!ch || ch.serverId !== serverId || ch.kind !== 'voice' || ch.roomHub || ch.temporary)
        throw new BadRequestException('escolha um canal de voz deste servidor');
    }
    const s = await this.prisma.server.update({
      where: { id: serverId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.accent !== undefined ? { accent: dto.accent?.toLowerCase() ?? null } : {}),
        // regras para a moderação por IA (ADR-0036)
        ...(dto.aiRules !== undefined ? { aiRules: dto.aiRules?.trim() || null } : {}),
        ...(dto.afkChannelId !== undefined ? { afkChannelId: dto.afkChannelId } : {}),
        ...(dto.afkTimeoutSec !== undefined ? { afkTimeoutSec: dto.afkTimeoutSec } : {}),
      },
    });
    await this.audit.log(userId, serverId, 'server.update', serverId, dto);
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(s));
    return serverSummary(s);
  }

  async remove(serverId: string, userId: string) {
    const access = await this.perms.server(serverId, userId);
    if (access.ownerId !== userId) throw forbidden('somente o proprietário pode excluir o servidor');
    const members = await this.prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } });
    this.events.emit({ type: 'member.removed', serverId, userId: '*', reason: 'deleted' });
    this.realtime.emit(rooms.server(serverId), 'server:deleted', { serverId });
    await this.prisma.server.delete({ where: { id: serverId } });
    for (const m of members) await this.realtime.syncUserRooms(m.userId);
  }

  /** Passa o servidor a outro membro (hoje só ao excluir a conta do dono, ADR-0039). */
  async transferOwnership(serverId: string, fromUserId: string, toUserId: string, reason: string) {
    const s = await this.prisma.server.update({
      where: { id: serverId, ownerId: fromUserId },
      data: { ownerId: toUserId },
    });
    await this.audit.log(fromUserId, serverId, 'server.transfer', toUserId, { reason });
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(s));
  }

  async leave(serverId: string, userId: string) {
    const access = await this.perms.server(serverId, userId);
    if (access.ownerId === userId)
      throw new BadRequestException('o proprietário não pode sair; transfira ou exclua o servidor');
    // o oficial é a casa de todo mundo na instância: entra-se automaticamente e não se sai (ADR-0011)
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { official: true } });
    if (server?.official) throw new BadRequestException('não é possível sair do servidor oficial');
    await this.removeMembership(serverId, userId);
    if (access.hidden) {
      // invisível (ADR-0013): sai sem avisar o servidor; registro só na auditoria global
      await this.audit.log(userId, null, 'admin.server.leave_hidden', serverId, {});
      this.events.emit({ type: 'member.removed', serverId, userId, reason: 'left' });
      this.realtime.toUser(userId, 'server:removed', { serverId, reason: 'left' });
      await this.realtime.syncUserRooms(userId);
      return;
    }
    await this.audit.log(userId, serverId, 'member.leave', userId, {});
    this.events.emit({ type: 'member.removed', serverId, userId, reason: 'left' });
    await this.realtime.memberRemoved(serverId, userId, 'left');
  }

  /** Diretório: só os servidores oficiais (abertos a todos), com contagem de membros e se o usuário já participa. */
  async directory(userId: string): Promise<ServerDirectoryEntry[]> {
    const rows = await this.prisma.server.findMany({
      where: { official: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        iconKey: true,
        _count: { select: { members: { where: { hidden: false } } } },
        members: { where: { userId }, select: { userId: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      iconKey: r.iconKey,
      memberCount: r._count.members,
      joined: r.members.length > 0,
    }));
  }

  /** Entrar no servidor oficial pelo diretório, sem convite. Privados exigem convite (404, sem revelar que existem). */
  async join(serverId: string, userId: string): Promise<ServerDetail> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { official: true } });
    if (!server?.official) throw notFound('servidor');
    return this.addMember(serverId, userId, { via: 'directory' });
  }

  /** Banido (ADR-0034) não entra por nenhuma porta: convite, diretório, admin-join nem como bot. */
  async assertNotBanned(serverId: string, userId: string) {
    const ban = await this.prisma.serverBan.findUnique({ where: { serverId_userId: { serverId, userId } } });
    if (ban) throw forbidden('banido deste servidor');
  }

  /** Idempotente: só audita e avisa quando a pessoa ainda não era membro. */
  private async addMember(serverId: string, userId: string, meta: Record<string, string>): Promise<ServerDetail> {
    await this.assertNotBanned(serverId, userId);
    const created = await this.prisma.serverMember.createMany({ data: [{ serverId, userId }], skipDuplicates: true });
    if (created.count) {
      await this.audit.log(userId, serverId, 'member.join', userId, meta);
      await this.realtime.memberJoined(serverId, userId);
    }
    return this.detail(serverId, userId);
  }

  // ---------- Bots (ADR-0032) ----------
  /** Quem autoriza (MANAGE_SERVER, bot público ou do solicitante) é o BotsService; aqui só a entrada como membro. */
  async addBotMember(serverId: string, actorId: string, botUserId: string) {
    await this.assertNotBanned(serverId, botUserId);
    const created = await this.prisma.serverMember.createMany({
      data: [{ serverId, userId: botUserId }],
      skipDuplicates: true,
    });
    if (!created.count) return;
    await this.audit.log(actorId, serverId, 'bot.add', botUserId, {});
    await this.realtime.memberJoined(serverId, botUserId);
    // o bot conectado fica sabendo do servidor novo (como uma pessoa que entra por convite)
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    this.realtime.toUser(botUserId, 'server:added', serverSummary(server));
    // quem já está com o servidor aberto vê o bot online na hora (a presença dele veio antes de ele ser membro)
    this.realtime.emit(rooms.server(serverId), 'presence:changed', {
      userId: botUserId,
      status: await this.presence.visible(botUserId),
    });
  }

  /** Mesmo caminho da expulsão (overrides, voz, rooms), sem hierarquia de cargos: bot não tem dono no servidor. */
  async removeBotMember(serverId: string, actorId: string, botUserId: string) {
    const m = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: botUserId } },
    });
    if (!m) throw notFound('bot');
    await this.removeMembership(serverId, botUserId);
    await this.audit.log(actorId, serverId, 'bot.remove', botUserId, {});
    this.events.emit({ type: 'member.removed', serverId, userId: botUserId, reason: 'kicked' });
    await this.realtime.memberRemoved(serverId, botUserId, 'kicked');
  }

  // ---------- Super admin da instância (ADR-0013) ----------
  private async requireInstanceAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isInstanceAdmin: true } });
    if (!u?.isInstanceAdmin) throw notFound('recurso');
  }

  /**
   * Todos os servidores da instância, com dono, membros, se o admin já participa e métricas do painel:
   * canais, conectados, em voz (`voiceByChannel` vem do VoiceService), membros novos, mensagens por dia (14 dias)
   * e a última mensagem. Membros invisíveis não entram nas contagens.
   */
  async adminServers(userId: string, voiceByChannel: Map<string, number> = new Map()): Promise<AdminServerEntry[]> {
    await this.requireInstanceAdmin(userId);
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const today = Math.floor(now / DAY);
    const since = new Date((today - (ADMIN_DAYS - 1)) * DAY);
    const online = [...(await this.realtime.onlineUserIds())];
    const [rows, channels, onlineRows, newRows, daily, last, voiceChannels] = await Promise.all([
      this.prisma.server.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          iconKey: true,
          official: true,
          verified: true,
          createdAt: true,
          owner: { select: { id: true, displayName: true } },
          _count: { select: { members: { where: { hidden: false } } } },
          members: { where: { userId }, select: { userId: true, hidden: true } },
        },
      }),
      this.prisma.channel.groupBy({ by: ['serverId', 'kind'], where: { temporary: false }, _count: { _all: true } }),
      online.length
        ? this.prisma.serverMember.groupBy({
            by: ['serverId'],
            where: { hidden: false, userId: { in: online } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      this.prisma.serverMember.groupBy({
        by: ['serverId'],
        where: { hidden: false, joinedAt: { gte: new Date(now - 7 * DAY) } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ serverId: string; day: number; n: number }[]>`
        SELECT c."serverId" AS "serverId",
               floor(extract(epoch FROM m."createdAt") / 86400)::int AS day,
               count(*)::int AS n
          FROM "Message" m JOIN "Channel" c ON c.id = m."channelId"
         WHERE m."createdAt" >= ${since} AND m."deletedAt" IS NULL
         GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ serverId: string; at: Date }[]>`
        SELECT c."serverId" AS "serverId", max(l."createdAt") AS at
          FROM "Channel" c
          JOIN LATERAL (
            SELECT m."createdAt" FROM "Message" m
             WHERE m."channelId" = c.id AND m."deletedAt" IS NULL
             ORDER BY m."createdAt" DESC LIMIT 1
          ) l ON true
         GROUP BY 1`,
      voiceByChannel.size
        ? this.prisma.channel.findMany({
            where: { id: { in: [...voiceByChannel.keys()] } },
            select: { id: true, serverId: true },
          })
        : Promise.resolve([]),
    ]);
    const count = (list: { serverId: string; _count: { _all: number } }[]) =>
      new Map(list.map((r) => [r.serverId, r._count._all]));
    const onlineBy = count(onlineRows);
    const newBy = count(newRows);
    const lastBy = new Map(last.map((r) => [r.serverId, r.at]));
    const chanBy = new Map<string, { text: number; voice: number }>();
    for (const c of channels) {
      const e = chanBy.get(c.serverId) ?? { text: 0, voice: 0 };
      if (c.kind === 'voice') e.voice += c._count._all;
      else e.text += c._count._all;
      chanBy.set(c.serverId, e);
    }
    const voiceBy = new Map<string, number>();
    for (const c of voiceChannels)
      voiceBy.set(c.serverId, (voiceBy.get(c.serverId) ?? 0) + (voiceByChannel.get(c.id) ?? 0));
    const dailyBy = new Map<string, number[]>();
    for (const d of daily) {
      const i = d.day - (today - (ADMIN_DAYS - 1));
      if (i < 0 || i >= ADMIN_DAYS) continue;
      const arr = dailyBy.get(d.serverId) ?? new Array<number>(ADMIN_DAYS).fill(0);
      arr[i] = d.n;
      dailyBy.set(d.serverId, arr);
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      iconKey: r.iconKey,
      official: r.official,
      verified: r.verified,
      owner: r.owner,
      memberCount: r._count.members,
      joined: r.members.length > 0,
      ...(r.members[0]?.hidden ? { hidden: true } : {}),
      createdAt: r.createdAt.toISOString(),
      textChannels: chanBy.get(r.id)?.text ?? 0,
      voiceChannels: chanBy.get(r.id)?.voice ?? 0,
      onlineCount: onlineBy.get(r.id) ?? 0,
      voiceCount: voiceBy.get(r.id) ?? 0,
      newMembers7d: newBy.get(r.id) ?? 0,
      messagesDaily: dailyBy.get(r.id) ?? new Array<number>(ADMIN_DAYS).fill(0),
      lastMessageAt: lastBy.get(r.id)?.toISOString() ?? null,
    }));
  }

  /**
   * O admin entra em qualquer servidor. Visível: fica na auditoria do servidor e todos veem a entrada. Invisível
   * (adendo da ADR-0013): não aparece em listas, contagens, presença nem "digitando"; o registro fica só na
   * auditoria global do painel do super admin.
   */
  async adminJoin(serverId: string, userId: string, hidden = false): Promise<ServerDetail> {
    await this.requireInstanceAdmin(userId);
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { id: true } });
    if (!server) throw notFound('servidor');
    if (!hidden) return this.addMember(serverId, userId, { via: 'instance-admin' });
    const existing = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      select: { hidden: true },
    });
    if (existing) {
      if (!existing.hidden) await this.adminSetHidden(serverId, userId, true);
      return this.detail(serverId, userId);
    }
    await this.assertNotBanned(serverId, userId);
    await this.prisma.serverMember.create({ data: { serverId, userId, hidden: true } });
    await this.audit.log(userId, null, 'admin.server.join_hidden', serverId, {});
    await this.realtime.syncUserRooms(userId);
    return this.detail(serverId, userId);
  }

  /** Alterna a própria participação do admin entre visível e invisível (adendo da ADR-0013). */
  async adminSetHidden(serverId: string, userId: string, hidden: boolean): Promise<Member> {
    await this.requireInstanceAdmin(userId);
    const m = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: MEMBER_INCLUDE,
    });
    if (!m) throw notFound('servidor');
    if (m.hidden === hidden) return member(m);
    const updated = await this.prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId } },
      data: { hidden },
      include: MEMBER_INCLUDE,
    });
    if (hidden) {
      await this.audit.log(userId, null, 'admin.server.hide', serverId, {});
      // para os membros é como se tivesse saído
      this.realtime.emit(rooms.server(serverId), 'server:member:left', { serverId, userId, reason: 'left' });
      this.realtime.emit(rooms.server(serverId), 'presence:changed', { userId, status: 'offline' });
    } else {
      await this.audit.log(userId, serverId, 'member.join', userId, { via: 'instance-admin' });
      this.realtime.emit(rooms.server(serverId), 'server:member:joined', { serverId, member: member(updated) });
      this.realtime.emit(rooms.server(serverId), 'presence:changed', {
        userId,
        status: await this.presence.visible(userId),
      });
    }
    return member(updated);
  }

  /** Selo de verificado (só o selo; privacidade e entrada não mudam). Avisa os membros na hora. */
  async adminSetVerified(serverId: string, userId: string, verified: boolean): Promise<ServerSummary> {
    await this.requireInstanceAdmin(userId);
    const exists = await this.prisma.server.findUnique({ where: { id: serverId }, select: { id: true } });
    if (!exists) throw notFound('servidor');
    const server = await this.prisma.server.update({ where: { id: serverId }, data: { verified } });
    await this.audit.log(userId, serverId, 'server.verified', serverId, { verified });
    this.realtime.emit(rooms.server(serverId), 'server:updated', serverSummary(server));
    return serverSummary(server);
  }

  // ---------- Convites ----------
  /** Convite do membro para o servidor: reaproveita o que ele já criou (um link por pessoa e servidor). */
  async createInvite(serverId: string, userId: string): Promise<Invite> {
    await this.perms.server(serverId, userId); // 404 para quem não é membro
    const existing = await this.prisma.invite.findFirst({ where: { serverId, creatorId: userId } });
    if (existing) return this.inviteDto(existing.code, serverId);
    const invite = await this.prisma.invite.create({ data: { code: inviteCode(), serverId, creatorId: userId } });
    await this.audit.log(userId, serverId, 'invite.create', invite.code, {});
    return this.inviteDto(invite.code, serverId);
  }

  private inviteDto(code: string, serverId: string): Invite {
    const base = this.cfg.PUBLIC_APP_URL?.replace(/\/+$/, '');
    return { code, serverId, url: base ? `${base}/invite/${code}` : null };
  }

  async previewInvite(code: string, userId: string): Promise<InvitePreview> {
    const inv = await this.findInvite(code);
    const [memberCount, me] = await Promise.all([
      this.prisma.serverMember.count({ where: { serverId: inv.serverId, hidden: false } }),
      this.prisma.serverMember.findUnique({ where: { serverId_userId: { serverId: inv.serverId, userId } } }),
    ]);
    const s = inv.server;
    return {
      code: inv.code,
      server: { id: s.id, name: s.name, iconKey: s.iconKey, official: s.official, verified: s.verified },
      memberCount,
      joined: Boolean(me),
    };
  }

  /**
   * Página pública do link de convite: meta tags Open Graph (nome, imagem e membros do servidor) para o cartão que
   * Discord, WhatsApp etc. mostram ao colar o link; quem abre no navegador segue para o app com o convite.
   */
  async inviteEmbed(code: string): Promise<string> {
    const app = this.cfg.PUBLIC_APP_URL?.replace(/\/+$/, '') ?? '';
    const target = `${app}/?invite=${encodeURIComponent(code)}`;
    const esc = (t: string) =>
      t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    let title = 'Convite para o OpenCord';
    let description = 'Este convite não existe mais.';
    let image = app ? `${app}/opencord-logo.png` : '';
    try {
      const inv = await this.findInvite(code);
      const members = await this.prisma.serverMember.count({ where: { serverId: inv.serverId } });
      title = `Convite para ${inv.server.name}`;
      description = `${members} ${members === 1 ? 'membro' : 'membros'} · Entre pelo navegador ou pelo app, só com um apelido.`;
      if (inv.server.iconKey)
        image = `${this.cfg.PUBLIC_API_URL.replace(/\/+$/, '')}/server-icons/${encodeURIComponent(inv.server.iconKey)}`;
    } catch {
      /* convite inválido: cartão genérico */
    }
    const meta = (p: string, v: string) => (v ? `<meta property="${p}" content="${esc(v)}">` : '');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(title)}</title>
${meta('og:site_name', 'OpenCord')}${meta('og:type', 'website')}${meta('og:title', title)}
${meta('og:description', description)}${meta('og:image', image)}${meta('og:url', target)}
<meta name="twitter:card" content="summary"><meta name="theme-color" content="#4d56fd">
<meta name="description" content="${esc(description)}">
</head><body style="background:#1e1f22;color:#dbdee1;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p><a style="color:#8b93ff" href="${esc(target)}">Abrir o convite no OpenCord</a></p>
<script>location.replace(${JSON.stringify(target)})</script>
</body></html>`;
  }

  async acceptInvite(code: string, userId: string): Promise<ServerDetail> {
    const inv = await this.findInvite(code);
    const already = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: inv.serverId, userId } },
    });
    if (!already) {
      // o uso só conta se a entrada for acontecer (banido não gasta o convite)
      await this.assertNotBanned(inv.serverId, userId);
      await this.prisma.invite.update({ where: { code: inv.code }, data: { uses: { increment: 1 } } });
    }
    return this.addMember(inv.serverId, userId, { via: 'invite', code: inv.code });
  }

  private async findInvite(code: string) {
    if (!INVITE_CODE.test(code)) throw notFound('convite');
    const inv = await this.prisma.invite.findUnique({ where: { code }, include: { server: true } });
    if (!inv) throw notFound('convite');
    return inv;
  }

  async listMemberIds(serverId: string): Promise<string[]> {
    return (
      await this.prisma.serverMember.findMany({ where: { serverId, hidden: false }, select: { userId: true } })
    ).map((m) => m.userId);
  }

  /** Chamado após um usuário existente entrar via convite. */
  async afterJoin(serverId: string, userId: string) {
    await this.realtime.memberJoined(serverId, userId);
  }

  // ---------- Membros ----------
  /** Tira do servidor junto com os overrides de canal da pessoa (senão voltariam a valer se ela entrasse de novo). */
  private async removeMembership(serverId: string, userId: string) {
    await this.prisma.$transaction([
      this.prisma.serverMember.delete({ where: { serverId_userId: { serverId, userId } } }),
      this.prisma.channelPermissionOverride.deleteMany({
        where: { subjectType: 'member', subjectId: userId, channel: { serverId } },
      }),
    ]);
  }

  async kick(serverId: string, actorId: string, targetId: string, reason?: string) {
    if (actorId === targetId) throw new BadRequestException('use "sair do servidor"');
    const actor = await this.perms.requireServer(serverId, actorId, Permission.KICK_MEMBERS);
    this.perms.assertAbove(actor, await this.perms.memberTop(serverId, targetId, actor.ownerId));
    await this.audit.log(actorId, serverId, 'member.kick', targetId, { reason: reason ?? null });
    await this.expel(serverId, targetId);
  }

  /**
   * Tira alguém do servidor contra a vontade (expulsão ou banimento, ADR-0034): membro, overrides, voz e rooms.
   * Quem chama já conferiu permissão e hierarquia e registrou a auditoria.
   */
  async expel(serverId: string, targetId: string) {
    await this.removeMembership(serverId, targetId);
    // Revogação ativa: voz (SFU) é encerrada pelo VoiceService ao receber o evento.
    this.events.emit({ type: 'member.removed', serverId, userId: targetId, reason: 'kicked' });
    await this.realtime.memberRemoved(serverId, targetId, 'kicked');
  }

  async setMemberRoles(serverId: string, actorId: string, targetId: string, roleIds: string[]) {
    const actor = await this.perms.requireServer(serverId, actorId, Permission.MANAGE_ROLES);
    const roles = await this.prisma.role.findMany({ where: { serverId } });
    const byId = new Map(roles.map((r) => [r.id, r]));
    const unique = [...new Set(roleIds)];
    for (const id of unique) {
      const r = byId.get(id);
      if (!r || r.isEveryone) throw new BadRequestException('cargo inválido');
    }
    const current = await this.prisma.memberRole.findMany({ where: { serverId, userId: targetId } });
    if (!(await this.prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId: targetId } } })))
      throw notFound('membro');
    const currentIds = new Set(current.map((c) => c.roleId));
    const changed = [
      ...unique.filter((id) => !currentIds.has(id)),
      ...[...currentIds].filter((id) => !unique.includes(id)),
    ];
    // Só pode adicionar/remover cargos abaixo do seu; e não pode alterar alguém acima ou igual (exceto a si mesmo, para cargos abaixo).
    for (const id of changed) this.perms.assertAbove(actor, byId.get(id)?.position ?? Number.POSITIVE_INFINITY);
    // dar um cargo é dar os bits dele: não pode entregar permissão que o próprio ator não tem
    for (const id of unique) if (!currentIds.has(id)) this.perms.assertGrantable(actor, byId.get(id)?.permissions ?? 0);
    if (targetId !== actorId)
      this.perms.assertAbove(actor, await this.perms.memberTop(serverId, targetId, actor.ownerId));
    await this.prisma.$transaction([
      this.prisma.memberRole.deleteMany({ where: { serverId, userId: targetId } }),
      this.prisma.memberRole.createMany({ data: unique.map((roleId) => ({ serverId, userId: targetId, roleId })) }),
    ]);
    await this.audit.log(actorId, serverId, 'member.roles', targetId, { roleIds: unique });
    const m = await this.prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: targetId } },
      include: MEMBER_INCLUDE,
    });
    if (!m.hidden) this.realtime.emit(rooms.server(serverId), 'server:member:updated', { serverId, member: member(m) });
    await this.permissionsChanged(serverId);
    return member(m);
  }

  /** Tudo que um cargo concede: bits base mais o que os overrides de canal liberam para ele. */
  async reactionRoleGrants(roleId: string, permissions: number): Promise<number> {
    const overrides = await this.prisma.channelPermissionOverride.findMany({
      where: { subjectType: 'role', subjectId: roleId },
      select: { allow: true },
    });
    return overrides.reduce((acc, o) => acc | o.allow, permissions);
  }

  /**
   * Cargo por reação (ADR-0019): a própria pessoa ganha/perde o cargo ao reagir. A hierarquia foi conferida quando a
   * mensagem foi configurada; os bits proibidos são conferidos de novo aqui, porque o cargo (ou um override de canal
   * dele) pode ter ganhado poder de moderação depois. Idempotente.
   */
  async applyReactionRole(serverId: string, userId: string, roleId: string, on: boolean) {
    const isMember = await this.prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } } });
    const role = await this.prisma.role.findFirst({ where: { id: roleId, serverId, isEveryone: false } });
    if (!isMember || !role) return;
    if (on && (await this.reactionRoleGrants(role.id, role.permissions)) & REACTION_ROLE_FORBIDDEN) return;
    const changed = on
      ? (await this.prisma.memberRole.createMany({ data: [{ serverId, userId, roleId }], skipDuplicates: true })).count
      : (await this.prisma.memberRole.deleteMany({ where: { serverId, userId, roleId } })).count;
    if (!changed) return;
    await this.audit.log(userId, serverId, 'member.roles', userId, { roleId, on, via: 'reaction' });
    const m = await this.prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId } },
      include: MEMBER_INCLUDE,
    });
    if (!m.hidden) this.realtime.emit(rooms.server(serverId), 'server:member:updated', { serverId, member: member(m) });
    await this.permissionsChanged(serverId);
  }

  async setNickname(serverId: string, userId: string, nickname: string | null) {
    await this.perms.server(serverId, userId);
    const m = await this.prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId } },
      data: { nickname: nickname?.trim() || null },
      include: MEMBER_INCLUDE,
    });
    if (!m.hidden) this.realtime.emit(rooms.server(serverId), 'server:member:updated', { serverId, member: member(m) });
    return member(m);
  }

  async everyoneId(serverId: string): Promise<string | null> {
    return (
      (await this.prisma.role.findFirst({ where: { serverId, isEveryone: true }, select: { id: true } }))?.id ?? null
    );
  }

  /** Para o serviço de salas (ADR-0040): mesmos avisos de quando um canal muda. */
  async emitChannelUpdated(serverId: string, channelId: string) {
    await this.emitChannel(serverId, channelId, 'channel:updated');
  }

  async permissionsChangedPublic(serverId: string) {
    await this.permissionsChanged(serverId);
  }

  private async permissionsChanged(serverId: string) {
    this.events.emit({ type: 'permissions.changed', serverId });
    await this.realtime.syncServer(serverId);
  }

  // ---------- Cargos ----------
  async createRole(
    serverId: string,
    actorId: string,
    dto: { name: string; permissions: number; color?: string | null | undefined },
  ): Promise<Role> {
    const actor = await this.perms.requireServer(serverId, actorId, Permission.MANAGE_ROLES);
    this.perms.assertGrantable(actor, dto.permissions);
    if ((dto.permissions & ~ALL_PERMISSIONS) !== 0) throw new BadRequestException('bits de permissão desconhecidos');
    const count = await this.prisma.role.count({ where: { serverId } });
    if (count >= MAX_ROLES) throw new BadRequestException('limite de cargos');
    const top = await this.prisma.role.aggregate({ where: { serverId }, _max: { position: true } });
    // Novo cargo entra logo abaixo do cargo mais alto do ator (owner: no topo).
    const position = Number.isFinite(actor.topPosition) ? Math.max(1, actor.topPosition) : (top._max.position ?? 0) + 1;
    if (Number.isFinite(actor.topPosition)) {
      await this.prisma.role.updateMany({
        where: { serverId, position: { gte: position }, isEveryone: false },
        data: { position: { increment: 1 } },
      });
    }
    const r = await this.prisma.role.create({
      data: { serverId, name: dto.name, permissions: dto.permissions, color: dto.color ?? null, position },
    });
    await this.audit.log(actorId, serverId, 'role.create', r.id, { name: r.name, permissions: r.permissions });
    this.realtime.emit(rooms.server(serverId), 'role:upserted', role(r));
    return role(r);
  }

  async updateRole(
    roleId: string,
    actorId: string,
    dto: {
      name?: string | undefined;
      permissions?: number | undefined;
      color?: string | null | undefined;
      position?: number | undefined;
    },
  ): Promise<Role> {
    const r = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!r) throw notFound('cargo');
    const actor = await this.perms.requireServer(r.serverId, actorId, Permission.MANAGE_ROLES).catch((e: unknown) => {
      throw e;
    });
    if (!r.isEveryone) this.perms.assertAbove(actor, r.position);
    if (dto.permissions !== undefined) {
      if ((dto.permissions & ~ALL_PERMISSIONS) !== 0) throw new BadRequestException('bits de permissão desconhecidos');
      // Mudar bits exige possuí-los (adicionar ou remover).
      this.perms.assertGrantable(actor, dto.permissions ^ r.permissions);
    }
    if (r.isEveryone && (dto.name || dto.position !== undefined))
      throw new BadRequestException('@everyone não pode ser renomeado ou movido');
    if (dto.position !== undefined) this.perms.assertAbove(actor, dto.position);
    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.permissions !== undefined ? { permissions: dto.permissions } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
      },
    });
    await this.audit.log(actorId, r.serverId, 'role.update', roleId, {
      before: { permissions: r.permissions, name: r.name },
      after: dto,
    });
    this.realtime.emit(rooms.server(r.serverId), 'role:upserted', role(updated));
    await this.permissionsChanged(r.serverId);
    return role(updated);
  }

  async deleteRole(roleId: string, actorId: string) {
    const r = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!r) throw notFound('cargo');
    if (r.isEveryone) throw new BadRequestException('@everyone não pode ser excluído');
    const actor = await this.perms.requireServer(r.serverId, actorId, Permission.MANAGE_ROLES);
    this.perms.assertAbove(actor, r.position);
    await this.prisma.$transaction([
      this.prisma.channelPermissionOverride.deleteMany({ where: { subjectType: 'role', subjectId: roleId } }),
      this.prisma.role.delete({ where: { id: roleId } }),
    ]);
    await this.audit.log(actorId, r.serverId, 'role.delete', roleId, { name: r.name });
    this.realtime.emit(rooms.server(r.serverId), 'role:deleted', { serverId: r.serverId, roleId });
    await this.permissionsChanged(r.serverId);
  }

  // ---------- Categorias ----------
  async createCategory(serverId: string, actorId: string, name: string): Promise<Category> {
    await this.perms.requireServer(serverId, actorId, Permission.MANAGE_CHANNELS);
    const max = await this.prisma.category.aggregate({ where: { serverId }, _max: { position: true } });
    const c = await this.prisma.category.create({ data: { serverId, name, position: (max._max.position ?? -1) + 1 } });
    await this.audit.log(actorId, serverId, 'category.create', c.id, { name });
    this.realtime.emit(rooms.server(serverId), 'category:upserted', category(c));
    return category(c);
  }

  async updateCategory(
    categoryId: string,
    actorId: string,
    dto: { name?: string | undefined; position?: number | undefined },
  ): Promise<Category> {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c) throw notFound('categoria');
    await this.perms.requireServer(c.serverId, actorId, Permission.MANAGE_CHANNELS);
    const u = await this.prisma.category.update({
      where: { id: categoryId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.position !== undefined ? { position: dto.position } : {}),
      },
    });
    this.realtime.emit(rooms.server(c.serverId), 'category:upserted', category(u));
    return category(u);
  }

  async deleteCategory(categoryId: string, actorId: string) {
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c) throw notFound('categoria');
    await this.perms.requireServer(c.serverId, actorId, Permission.MANAGE_CHANNELS);
    await this.prisma.category.delete({ where: { id: categoryId } });
    await this.audit.log(actorId, c.serverId, 'category.delete', categoryId, { name: c.name });
    this.realtime.emit(rooms.server(c.serverId), 'category:deleted', { serverId: c.serverId, categoryId });
  }

  // ---------- Canais ----------
  async emitChannel(serverId: string, channelId: string, ev: 'channel:created' | 'channel:updated') {
    // Payload inclui myPermissions, que varia por usuário: enviar individualmente a cada membro conectado que vê o canal.
    const members = await this.prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } });
    const c = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { overrides: true } });
    const everyoneId = await this.everyoneId(serverId);
    for (const m of members) {
      const access = await this.perms.server(serverId, m.userId).catch(() => null);
      if (!access) continue;
      const p = (await this.perms.channelsFor(access, [c])).get(c.id) ?? 0;
      if (p === 0) {
        if (ev === 'channel:updated') this.realtime.toUser(m.userId, 'channel:deleted', { serverId, channelId });
        continue;
      }
      const canManage =
        hasPermission(access.base, Permission.MANAGE_CHANNELS) || hasPermission(access.base, Permission.MANAGE_ROLES);
      this.realtime.toUser(m.userId, ev, channel(c, p, everyoneId, !canManage));
    }
  }

  private async validateOverrides(
    access: ServerAccess,
    overrides: PermissionOverrideDto[],
    existing: PermissionOverrideDto[] = [],
  ) {
    // trocar a lista apaga os overrides atuais: remover ou mudar um override também exige ter os bits dele
    const key = (o: PermissionOverrideDto) => `${o.subjectType}:${o.subjectId}`;
    const next = new Map(overrides.map((o) => [key(o), o]));
    for (const old of existing) {
      const n = next.get(key(old));
      if (!n || n.allow !== old.allow || n.deny !== old.deny) this.perms.assertGrantable(access, old.allow | old.deny);
    }
    const roles = await this.prisma.role.findMany({ where: { serverId: access.serverId }, select: { id: true } });
    const roleIds = new Set(roles.map((r) => r.id));
    const memberIds = new Set(
      (
        await this.prisma.serverMember.findMany({
          where: {
            serverId: access.serverId,
            userId: { in: overrides.filter((o) => o.subjectType === 'member').map((o) => o.subjectId) },
          },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    const seen = new Set<string>();
    for (const o of overrides) {
      const key = `${o.subjectType}:${o.subjectId}`;
      if (seen.has(key)) throw new BadRequestException('override duplicado');
      seen.add(key);
      if (o.subjectType === 'role' ? !roleIds.has(o.subjectId) : !memberIds.has(o.subjectId))
        throw new BadRequestException('alvo de override inválido');
      if ((o.allow & o.deny) !== 0) throw new BadRequestException('allow e deny sobrepostos');
      this.perms.assertGrantable(access, o.allow | o.deny);
    }
  }

  async createChannel(
    serverId: string,
    actorId: string,
    dto: {
      name: string;
      kind: 'text' | 'voice' | 'board';
      categoryId?: string | null | undefined;
      topic?: string | null | undefined;
      roomHub?: boolean | undefined;
      private?: boolean | undefined;
      allowedRoleIds?: string[] | undefined;
      allowedUserIds?: string[] | undefined;
    },
  ): Promise<Channel> {
    const actor = await this.perms.requireServer(serverId, actorId, Permission.MANAGE_CHANNELS);
    if (dto.roomHub && dto.kind !== 'voice') throw new BadRequestException('só canal de voz cria salas');
    // canal privado (ADR-0040): @everyone não vê; quem criou e os cargos/membros escolhidos veem
    const privateOverrides: { subjectType: 'role' | 'member'; subjectId: string; allow: number; deny: number }[] = [];
    if (dto.private) {
      const everyone = await this.prisma.role.findFirstOrThrow({ where: { serverId, isEveryone: true } });
      const roles = dto.allowedRoleIds?.length
        ? await this.prisma.role.findMany({ where: { serverId, id: { in: dto.allowedRoleIds }, isEveryone: false } })
        : [];
      const members = dto.allowedUserIds?.length
        ? await this.prisma.serverMember.findMany({ where: { serverId, userId: { in: dto.allowedUserIds } } })
        : [];
      this.perms.assertGrantable(actor, Permission.VIEW_CHANNEL);
      privateOverrides.push({ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.VIEW_CHANNEL });
      for (const r of roles)
        privateOverrides.push({ subjectType: 'role', subjectId: r.id, allow: Permission.VIEW_CHANNEL, deny: 0 });
      for (const uid of new Set([actorId, ...members.map((m) => m.userId)]))
        privateOverrides.push({ subjectType: 'member', subjectId: uid, allow: Permission.VIEW_CHANNEL, deny: 0 });
    }
    if ((await this.prisma.channel.count({ where: { serverId } })) >= MAX_CHANNELS)
      throw new BadRequestException('limite de canais');
    if (dto.categoryId) {
      const cat = await this.prisma.category.findFirst({ where: { id: dto.categoryId, serverId } });
      if (!cat) throw new BadRequestException('categoria inválida');
    }
    const max = await this.prisma.channel.aggregate({
      where: { serverId, categoryId: dto.categoryId ?? null },
      _max: { position: true },
    });
    const c = await this.prisma.channel.create({
      data: {
        serverId,
        name: dto.name,
        kind: dto.kind,
        categoryId: dto.categoryId ?? null,
        topic: dto.topic ?? null,
        position: (max._max.position ?? -1) + 1,
        roomHub: Boolean(dto.roomHub),
        ...(privateOverrides.length ? { overrides: { create: privateOverrides } } : {}),
      },
      include: { overrides: true },
    });
    await this.audit.log(actorId, serverId, 'channel.create', c.id, {
      name: c.name,
      kind: c.kind,
      private: Boolean(dto.private),
    });
    await this.realtime.syncServer(serverId);
    await this.emitChannel(serverId, c.id, 'channel:created');
    const access = await this.perms.server(serverId, actorId);
    return channel(c, (await this.perms.channelsFor(access, [c])).get(c.id) ?? 0, await this.everyoneId(c.serverId));
  }

  async updateChannel(
    channelId: string,
    actorId: string,
    dto: {
      name?: string | undefined;
      topic?: string | null | undefined;
      categoryId?: string | null | undefined;
      position?: number | undefined;
      overrides?: PermissionOverrideDto[] | undefined;
      boardId?: string | null | undefined;
      roomHub?: boolean | undefined;
      private?: boolean | undefined;
    },
  ): Promise<Channel> {
    const existing = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!existing) throw notFound('canal');
    if (dto.roomHub && existing.kind !== 'voice') throw new BadRequestException('só canal de voz cria salas');
    // permissão no próprio canal: quem não vê o canal (VIEW_CHANNEL negado) recebe 404, como em todo o resto
    const access = await this.perms.requireChannel(channelId, actorId, Permission.MANAGE_CHANNELS);
    if (dto.overrides) {
      if (!hasPermission(access.base, Permission.MANAGE_ROLES))
        throw forbidden('MANAGE_ROLES necessário para alterar overrides');
      const current = await this.prisma.channelPermissionOverride.findMany({ where: { channelId } });
      await this.validateOverrides(access, dto.overrides, current);
    }
    if (dto.categoryId) {
      const cat = await this.prisma.category.findFirst({ where: { id: dto.categoryId, serverId: existing.serverId } });
      if (!cat) throw new BadRequestException('categoria inválida');
    }
    if (dto.boardId) {
      // só canal de texto alimenta quadro, e o quadro precisa ser deste servidor (ADR-0017)
      const board = await this.prisma.channel.findFirst({
        where: { id: dto.boardId, serverId: existing.serverId, kind: 'board' },
      });
      if (!board || existing.kind !== 'text') throw new BadRequestException('quadro inválido');
      // ligar a um quadro copia as mensagens novas para quem vê o quadro: é dar leitores ao canal, como um override
      if (!hasPermission(access.base, Permission.MANAGE_ROLES))
        throw forbidden('MANAGE_ROLES necessário para ligar o canal a um quadro');
      await this.perms.requireChannel(dto.boardId, actorId, Permission.VIEW_CHANNEL);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(dto.boardId !== undefined ? { boardId: dto.boardId } : {}),
          ...(dto.roomHub !== undefined ? { roomHub: dto.roomHub } : {}),
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.position !== undefined ? { position: dto.position } : {}),
        },
      });
      if (dto.overrides) {
        await tx.channelPermissionOverride.deleteMany({ where: { channelId } });
        if (dto.overrides.length)
          await tx.channelPermissionOverride.createMany({ data: dto.overrides.map((o) => ({ ...o, channelId })) });
      }
      // privado (ADR-0040): liga/desliga o "ninguém vê" do @everyone; quem edita continua vendo (override próprio)
      if (dto.private !== undefined) {
        const everyone = await tx.role.findFirstOrThrow({ where: { serverId: existing.serverId, isEveryone: true } });
        const key = { channelId, subjectType: 'role' as const, subjectId: everyone.id };
        const cur = await tx.channelPermissionOverride.findUnique({ where: { channelId_subjectType_subjectId: key } });
        const deny = dto.private
          ? (cur?.deny ?? 0) | Permission.VIEW_CHANNEL
          : (cur?.deny ?? 0) & ~Permission.VIEW_CHANNEL;
        await tx.channelPermissionOverride.upsert({
          where: { channelId_subjectType_subjectId: key },
          create: { ...key, allow: cur?.allow ?? 0, deny },
          update: { deny },
        });
        if (dto.private && actorId !== access.ownerId) {
          const mine = { channelId, subjectType: 'member' as const, subjectId: actorId };
          const m = await tx.channelPermissionOverride.findUnique({ where: { channelId_subjectType_subjectId: mine } });
          await tx.channelPermissionOverride.upsert({
            where: { channelId_subjectType_subjectId: mine },
            create: { ...mine, allow: Permission.VIEW_CHANNEL, deny: 0 },
            update: { allow: (m?.allow ?? 0) | Permission.VIEW_CHANNEL },
          });
        }
      }
    });
    await this.audit.log(
      actorId,
      existing.serverId,
      dto.overrides ? 'channel.overrides' : 'channel.update',
      channelId,
      { ...dto },
    );
    if (dto.overrides || dto.private !== undefined) await this.permissionsChanged(existing.serverId);
    await this.emitChannel(existing.serverId, channelId, 'channel:updated');
    const c = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { overrides: true } });
    return channel(c, (await this.perms.channelsFor(access, [c])).get(c.id) ?? 0, await this.everyoneId(c.serverId));
  }

  /**
   * Sala temporária a partir de um criador de salas (ADR-0029): mesma categoria e mesmas permissões do criador, logo
   * abaixo dele, com o nome de quem entrou. Sem checagem de MANAGE_CHANNELS: quem pode entrar no criador pode abrir
   * uma sala.
   */
  async createTemporaryRoom(
    hubId: string,
    userId: string,
    opts: { name?: string | undefined; locked?: boolean | undefined; userLimit?: number | null | undefined } = {},
  ): Promise<{ id: string }> {
    const hub = await this.prisma.channel.findUniqueOrThrow({ where: { id: hubId }, include: { overrides: true } });
    if ((await this.prisma.channel.count({ where: { serverId: hub.serverId } })) >= MAX_CHANNELS)
      throw new BadRequestException('limite de canais');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
    // trancada desde o início (ADR-0040): @everyone e os cargos liberados no criador perdem CONNECT; a dona ganha
    const overrides = hub.overrides.map((o) => ({
      subjectType: o.subjectType,
      subjectId: o.subjectId,
      allow: opts.locked && o.subjectType === 'role' ? o.allow & ~Permission.CONNECT : o.allow,
      deny: opts.locked && o.subjectType === 'role' ? o.deny | Permission.CONNECT : o.deny,
    }));
    if (opts.locked) {
      const everyone = await this.prisma.role.findFirstOrThrow({ where: { serverId: hub.serverId, isEveryone: true } });
      if (!overrides.some((o) => o.subjectType === 'role' && o.subjectId === everyone.id))
        overrides.push({ subjectType: 'role', subjectId: everyone.id, allow: 0, deny: Permission.CONNECT });
      const mine = overrides.find((o) => o.subjectType === 'member' && o.subjectId === userId);
      if (mine) {
        mine.allow |= Permission.CONNECT | Permission.VIEW_CHANNEL;
        mine.deny &= ~(Permission.CONNECT | Permission.VIEW_CHANNEL);
      } else
        overrides.push({
          subjectType: 'member',
          subjectId: userId,
          allow: Permission.CONNECT | Permission.VIEW_CHANNEL,
          deny: 0,
        });
    }
    const c = await this.prisma.channel.create({
      data: {
        serverId: hub.serverId,
        name: (opts.name ?? `Sala de ${user.displayName}`).slice(0, 64),
        kind: 'voice',
        categoryId: hub.categoryId,
        position: hub.position + 1,
        temporary: true,
        ownerId: userId,
        userLimit: opts.userLimit ?? null,
        overrides: { create: overrides },
      },
    });
    // as salas seguintes ficam abaixo (empurra o que vinha depois do criador)
    await this.prisma.channel.updateMany({
      where: { serverId: hub.serverId, categoryId: hub.categoryId, position: { gt: hub.position }, id: { not: c.id } },
      data: { position: { increment: 1 } },
    });
    await this.realtime.syncServer(hub.serverId);
    await this.emitChannel(hub.serverId, c.id, 'channel:created');
    return { id: c.id };
  }

  /** A dona saiu e ficou gente (ADR-0040): a sala passa a quem ficou. */
  async handOffRoom(channelId: string, leaverId: string, remaining: string[]) {
    const c = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { temporary: true, ownerId: true, serverId: true },
    });
    if (!c?.temporary || c.ownerId !== leaverId) return;
    const next = remaining.find((u) => u !== leaverId);
    if (!next) return;
    await this.prisma.channel.update({ where: { id: channelId }, data: { ownerId: next } });
    await this.emitChannel(c.serverId, channelId, 'channel:updated');
  }

  /** Sala temporária vazia some (ADR-0029). */
  async deleteTemporaryRoom(channelId: string) {
    const c = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!c?.temporary) return;
    this.events.emit({ type: 'channel.deleted', serverId: c.serverId, channelId });
    this.realtime.emit(rooms.server(c.serverId), 'channel:deleted', { serverId: c.serverId, channelId });
    await this.prisma.channel.delete({ where: { id: channelId } }).catch(() => undefined);
  }

  async deleteChannel(channelId: string, actorId: string) {
    const c = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!c) throw notFound('canal');
    await this.perms.requireChannel(channelId, actorId, Permission.MANAGE_CHANNELS);
    this.events.emit({ type: 'channel.deleted', serverId: c.serverId, channelId });
    this.realtime.emit(rooms.server(c.serverId), 'channel:deleted', { serverId: c.serverId, channelId });
    await this.prisma.channel.delete({ where: { id: channelId } });
    await this.audit.log(actorId, c.serverId, 'channel.delete', channelId, { name: c.name });
  }
}
