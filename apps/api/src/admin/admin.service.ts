import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type {
  AdminAuditEntry,
  AdminAuditPage,
  AdminInstanceConfig,
  AdminStats,
  AdminUser,
  AdminUserPage,
  UpdateInstanceConfigRequest,
} from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { AuditService } from '../audit/audit.service.js';
import { TokenService } from '../auth/token.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { VoiceService } from '../voice/voice.service.js';
import { InstanceService } from './instance.service.js';

const PAGE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/** O que entra no filtro "Ações de admin" da auditoria global. */
const ADMIN_ACTIONS: Prisma.AuditLogWhereInput = {
  OR: [
    { action: { startsWith: 'admin.' } },
    { action: 'server.verified' },
    { action: 'member.join', metadata: { path: ['via'], equals: 'instance-admin' } },
  ],
};

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarKey: true,
  email: true,
  passwordHash: true,
  isInstanceAdmin: true,
  createdAt: true,
  disabledAt: true,
  _count: { select: { memberships: true } },
  sessions: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true, rotatedAt: true },
  },
} satisfies Prisma.UserSelect;
type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/**
 * Painel do super admin (ADR-0020): números da instância, usuários (suspender, encerrar sessões, promover),
 * configuração da instância e auditoria global. Quem não é super admin recebe 404 em tudo.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly voice: VoiceService,
    private readonly instance: InstanceService,
    private readonly tokens: TokenService,
  ) {}

  private async requireAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isInstanceAdmin: true } });
    if (!u?.isInstanceAdmin) throw notFound('recurso');
  }

  /** Dono do servidor oficial: o criador do OpenCord. */
  private async creatorId(): Promise<string | null> {
    const s = await this.prisma.server.findFirst({ where: { official: true }, select: { ownerId: true } });
    return s?.ownerId ?? null;
  }

  // ---------- Visão geral ----------
  async stats(actorId: string): Promise<AdminStats> {
    await this.requireAdmin(actorId);
    const now = Date.now();
    const [users, newUsers7d, suspended, admins, servers, messages24h, online, inVoice] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: new Date(now - 7 * DAY_MS) } } }),
      this.prisma.user.count({ where: { disabledAt: { not: null } } }),
      this.prisma.user.count({ where: { isInstanceAdmin: true } }),
      this.prisma.server.count(),
      this.prisma.message.count({ where: { createdAt: { gte: new Date(now - DAY_MS) } } }),
      this.realtime.onlineUserIds(),
      this.voice.countInVoice(),
    ]);
    return { users, newUsers7d, suspended, admins, onlineNow: online.size, inVoice, servers, messages24h };
  }

  // ---------- Usuários ----------
  private async toAdminUser(r: UserRow, ctx: { creatorId: string | null; online: Set<string> }): Promise<AdminUser> {
    const activeSessions = await this.prisma.session.count({
      where: { userId: r.id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    const last = r.sessions[0];
    const lastSeen = last
      ? last.rotatedAt && last.rotatedAt > last.createdAt
        ? last.rotatedAt
        : last.createdAt
      : null;
    return {
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      avatarKey: r.avatarKey,
      email: r.email,
      hasAccount: r.passwordHash !== null,
      isInstanceAdmin: r.isInstanceAdmin,
      isCreator: r.id === ctx.creatorId,
      createdAt: r.createdAt.toISOString(),
      disabledAt: r.disabledAt?.toISOString() ?? null,
      serverCount: r._count.memberships,
      activeSessions,
      lastSeenAt: lastSeen?.toISOString() ?? null,
      online: ctx.online.has(r.id),
    };
  }

  async users(
    actorId: string,
    query: { q?: string | undefined; filter: 'all' | 'admins' | 'suspended'; cursor?: string | undefined },
  ): Promise<AdminUserPage> {
    await this.requireAdmin(actorId);
    const and: Prisma.UserWhereInput[] = [];
    if (query.q)
      and.push({
        OR: [
          { username: { contains: query.q, mode: 'insensitive' } },
          { displayName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    if (query.filter === 'admins') and.push({ isInstanceAdmin: true });
    if (query.filter === 'suspended') and.push({ disabledAt: { not: null } });
    // ids uuid v7: ordem decrescente = mais novos primeiro
    if (query.cursor) and.push({ id: { lt: query.cursor } });
    const rows = await this.prisma.user.findMany({
      where: { AND: and },
      orderBy: { id: 'desc' },
      take: PAGE + 1,
      select: USER_SELECT,
    });
    const page = rows.slice(0, PAGE);
    const ctx = { creatorId: await this.creatorId(), online: await this.realtime.onlineUserIds() };
    return {
      users: await Promise.all(page.map((r) => this.toAdminUser(r, ctx))),
      nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async one(userId: string): Promise<AdminUser> {
    const r = await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!r) throw notFound('usuário');
    return this.toAdminUser(r, { creatorId: await this.creatorId(), online: await this.realtime.onlineUserIds() });
  }

  /** Alvo de uma ação sobre outra pessoa: não pode ser você nem o criador do OpenCord. */
  private async target(actorId: string, targetId: string) {
    await this.requireAdmin(actorId);
    const t = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isInstanceAdmin: true, disabledAt: true },
    });
    if (!t) throw notFound('usuário');
    if (t.id === actorId) throw new BadRequestException('você não pode fazer isso com a sua própria conta');
    if (t.id === (await this.creatorId())) throw new BadRequestException('o criador do OpenCord não pode ser alterado');
    return t;
  }

  /** Encerra todas as sessões e derruba as conexões (o app da pessoa volta para o login). */
  private async revokeAll(userId: string, reason: string) {
    const sessions = await this.prisma.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    const r = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // sem isso o token de acesso ainda passa pelo cache de sessão (alguns segundos) em cada processo da API
    this.tokens.invalidateCache(sessions.map((s) => s.id));
    await this.voice.forceLeave(userId).catch(() => undefined);
    await this.realtime.disconnectUser(userId, reason);
    return r.count;
  }

  /** Suspende a conta na instância inteira: não entra mais, sai da chamada e de todas as sessões. */
  async suspend(actorId: string, targetId: string, reason: string | undefined): Promise<AdminUser> {
    const t = await this.target(actorId, targetId);
    if (t.isInstanceAdmin) throw new BadRequestException('tire o super admin desta pessoa antes de suspender');
    if (!t.disabledAt) {
      await this.prisma.user.update({ where: { id: targetId }, data: { disabledAt: new Date() } });
      const sessions = await this.revokeAll(targetId, 'conta suspensa');
      await this.audit.log(actorId, null, 'admin.user.suspend', targetId, { reason: reason ?? null, sessions });
    }
    return this.one(targetId);
  }

  async unsuspend(actorId: string, targetId: string): Promise<AdminUser> {
    const t = await this.target(actorId, targetId);
    if (t.disabledAt) {
      await this.prisma.user.update({ where: { id: targetId }, data: { disabledAt: null } });
      await this.audit.log(actorId, null, 'admin.user.unsuspend', targetId, {});
    }
    return this.one(targetId);
  }

  async logoutEverywhere(actorId: string, targetId: string): Promise<AdminUser> {
    await this.target(actorId, targetId);
    const sessions = await this.revokeAll(targetId, 'sessões encerradas pelo administrador');
    await this.audit.log(actorId, null, 'admin.user.logout', targetId, { sessions });
    return this.one(targetId);
  }

  /** Promove ou rebaixa outro super admin. Os servidores em que a pessoa está recalculam as permissões. */
  async setAdmin(actorId: string, targetId: string, admin: boolean): Promise<AdminUser> {
    const t = await this.target(actorId, targetId);
    if (admin && t.disabledAt) throw new BadRequestException('reative a conta antes de promover');
    if (t.isInstanceAdmin !== admin) {
      await this.prisma.user.update({ where: { id: targetId }, data: { isInstanceAdmin: admin } });
      await this.audit.log(actorId, null, admin ? 'admin.user.promote' : 'admin.user.demote', targetId, {});
      const servers = await this.prisma.serverMember.findMany({
        where: { userId: targetId },
        select: { serverId: true },
      });
      for (const s of servers) await this.realtime.syncServer(s.serverId).catch(() => undefined);
      this.realtime.toUser(targetId, 'instance:updated', await this.instance.info());
    }
    return this.one(targetId);
  }

  // ---------- Instância ----------
  async instanceConfig(actorId: string): Promise<AdminInstanceConfig> {
    await this.requireAdmin(actorId);
    const row = await this.instance.row();
    const info = await this.instance.info();
    return {
      ...info,
      uploadMaxBytes: info.uploadMaxBytes ?? this.cfg.UPLOAD_MAX_BYTES,
      uploadEnvMaxBytes: this.cfg.UPLOAD_MAX_BYTES,
      uploadOverrideBytes: row?.uploadMaxBytes ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async updateInstance(actorId: string, dto: UpdateInstanceConfigRequest): Promise<AdminInstanceConfig> {
    await this.requireAdmin(actorId);
    if (dto.uploadMaxBytes != null && dto.uploadMaxBytes > this.cfg.UPLOAD_MAX_BYTES)
      throw new BadRequestException(
        `o limite não pode passar do configurado no servidor (${Math.floor(this.cfg.UPLOAD_MAX_BYTES / 1024 / 1024)} MB)`,
      );
    const data: Prisma.InstanceConfigUncheckedUpdateInput = { updatedById: actorId };
    if (dto.registrationOpen !== undefined) data.registrationOpen = dto.registrationOpen;
    if (dto.announcement !== undefined) {
      data.announcementText = dto.announcement?.text ?? null;
      if (dto.announcement) data.announcementTone = dto.announcement.tone;
    }
    if (dto.uploadMaxBytes !== undefined) data.uploadMaxBytes = dto.uploadMaxBytes;
    await this.prisma.instanceConfig.upsert({
      where: { id: 1 },
      create: { id: 1, ...(data as Prisma.InstanceConfigUncheckedCreateInput) },
      update: data,
    });
    this.instance.invalidate();
    await this.audit.log(actorId, null, 'admin.instance.update', null, { ...dto });
    this.realtime.emitAll('instance:updated', await this.instance.info());
    return this.instanceConfig(actorId);
  }

  // ---------- Auditoria global ----------
  async auditLog(
    actorId: string,
    query: { scope: 'admin' | 'all'; before?: string | undefined },
  ): Promise<AdminAuditPage> {
    await this.requireAdmin(actorId);
    const and: Prisma.AuditLogWhereInput[] = [];
    if (query.scope === 'admin') and.push(ADMIN_ACTIONS);
    if (query.before) and.push({ id: { lt: query.before } });
    const rows = await this.prisma.auditLog.findMany({
      where: { AND: and },
      orderBy: { id: 'desc' },
      take: PAGE + 1,
      include: {
        actor: { select: { id: true, displayName: true } },
        server: { select: { id: true, name: true } },
      },
    });
    const page = rows.slice(0, PAGE);
    const uuid = /^[0-9a-f-]{36}$/i;
    const targetIds = [...new Set(page.map((r) => r.targetId).filter((t): t is string => !!t && uuid.test(t)))];
    const targets = await this.prisma.user.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, displayName: true },
    });
    const names = new Map(targets.map((t) => [t.id, t.displayName]));
    const entries: AdminAuditEntry[] = page.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      serverId: r.serverId,
      action: r.action,
      targetId: r.targetId,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
      actor: r.actor,
      server: r.server,
      targetName: (r.targetId && names.get(r.targetId)) ?? null,
    }));
    return { entries, nextBefore: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null };
  }
}
