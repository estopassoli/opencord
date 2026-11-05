import { Injectable } from '@nestjs/common';
import { Permission, type AuditEntry } from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { PrismaService } from '../common/prisma.service.js';
import { PermissionsService } from '../servers/permissions.service.js';

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
  ) {}

  async log(
    actorId: string,
    serverId: string | null,
    action: string,
    targetId: string | null,
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: { actorId, serverId, action, targetId, metadata: metadata as Prisma.InputJsonValue },
    });
  }

  /** filtros (ADR-0050): autor, tipo de ação (ex.: `role` pega `role.create`, `role.update`…) e antes de uma data */
  async list(
    serverId: string,
    userId: string,
    limit = 100,
    filter: { actorId?: string; action?: string; before?: string } = {},
  ): Promise<AuditEntry[]> {
    await this.perms.requireServer(serverId, userId, Permission.VIEW_AUDIT_LOG);
    const uuid = /^[0-9a-f-]{36}$/i;
    const action = filter.action && /^[a-z_.-]{1,40}$/.test(filter.action) ? filter.action : undefined;
    const before = filter.before ? new Date(filter.before) : null;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        serverId,
        ...(filter.actorId && uuid.test(filter.actorId) ? { actorId: filter.actorId } : {}),
        ...(action ? { OR: [{ action }, { action: { startsWith: `${action}.` } }] } : {}),
        ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      serverId: r.serverId,
      action: r.action,
      targetId: r.targetId,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
