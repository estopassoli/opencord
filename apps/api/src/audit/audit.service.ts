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

  async list(serverId: string, userId: string, limit = 100): Promise<AuditEntry[]> {
    await this.perms.requireServer(serverId, userId, Permission.VIEW_AUDIT_LOG);
    const rows = await this.prisma.auditLog.findMany({
      where: { serverId },
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
