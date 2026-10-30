import { Injectable } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  computeBasePermissions,
  computeChannelPermissions,
  hasPermission,
  type PermissionContext,
  type PermissionOverride,
} from '@opencord/contracts';
import { PrismaService } from '../common/prisma.service.js';
import { forbidden, notFound } from '../common/errors.js';

export interface ServerAccess {
  serverId: string;
  ownerId: string;
  ctx: PermissionContext;
  base: number;
  /** Posição do cargo mais alto do membro (owner = Infinity). */
  topPosition: number;
}

export interface ChannelAccess extends ServerAccess {
  channelId: string;
  kind: 'text' | 'voice' | 'board';
  perms: number;
}

type OverrideRow = { subjectType: 'role' | 'member'; subjectId: string; allow: number; deny: number };
export const toOverride = (o: OverrideRow): PermissionOverride => ({
  subjectType: o.subjectType,
  subjectId: o.subjectId,
  allow: o.allow,
  deny: o.deny,
});

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lança 404 se o usuário não for membro (não revela existência do servidor). */
  async server(serverId: string, userId: string): Promise<ServerAccess> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: {
        id: true,
        ownerId: true,
        roles: { select: { id: true, permissions: true, position: true, isEveryone: true } },
        members: {
          where: { userId },
          select: { roles: { select: { roleId: true } }, user: { select: { isInstanceAdmin: true } } },
        },
      },
    });
    const member = server?.members[0];
    if (!server || !member) throw notFound('servidor');
    const everyone = server.roles.find((r) => r.isEveryone);
    if (!everyone) throw new Error(`servidor ${serverId} sem cargo @everyone`);
    const memberRoleIds = member.roles.map((r) => r.roleId);
    // super admin da instância (ADR-0013): depois de entrar (auditado), permissões e hierarquia de dono.
    // Ações exclusivas do dono real (excluir/transferir) continuam checando `ownerId`.
    const admin = member.user.isInstanceAdmin;
    const ctx: PermissionContext = {
      userId,
      ownerId: admin ? userId : server.ownerId,
      everyoneRoleId: everyone.id,
      rolePermissions: new Map(server.roles.map((r) => [r.id, r.permissions])),
      memberRoleIds,
    };
    const positions = server.roles.filter((r) => memberRoleIds.includes(r.id)).map((r) => r.position);
    return {
      serverId,
      ownerId: server.ownerId,
      ctx,
      base: computeBasePermissions(ctx),
      topPosition: userId === server.ownerId || admin ? Number.POSITIVE_INFINITY : Math.max(0, ...positions),
    };
  }

  async requireServer(serverId: string, userId: string, bit: number): Promise<ServerAccess> {
    const access = await this.server(serverId, userId);
    if (!hasPermission(access.base, bit)) throw forbidden();
    return access;
  }

  async channel(channelId: string, userId: string): Promise<ChannelAccess> {
    const ch = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, serverId: true, kind: true, overrides: true },
    });
    if (!ch) throw notFound('canal');
    const access = await this.server(ch.serverId, userId).catch(() => {
      throw notFound('canal');
    });
    const perms = computeChannelPermissions(access.ctx, ch.overrides.map(toOverride));
    if (perms === 0) throw notFound('canal');
    return { ...access, channelId: ch.id, kind: ch.kind, perms };
  }

  async requireChannel(channelId: string, userId: string, bit: number): Promise<ChannelAccess> {
    const access = await this.channel(channelId, userId);
    if (!hasPermission(access.perms, bit)) throw forbidden();
    return access;
  }

  /** Permissões de todos os canais de um servidor (para listagem e rooms realtime). */
  async channelsFor(
    access: ServerAccess,
    channels: { id: string; overrides: OverrideRow[] }[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const c of channels) {
      out.set(
        c.id,
        access.base === ALL_PERMISSIONS
          ? ALL_PERMISSIONS
          : computeChannelPermissions(access.ctx, c.overrides.map(toOverride)),
      );
    }
    return out;
  }

  /** O ator só gerencia cargos/membros estritamente abaixo do seu cargo mais alto. */
  assertAbove(actor: ServerAccess, targetPosition: number) {
    if (!(actor.topPosition > targetPosition)) throw forbidden('hierarquia de cargos insuficiente');
  }

  /** Bits que o ator pode conceder: não pode dar permissões que não possui. */
  assertGrantable(actor: ServerAccess, bits: number) {
    if (actor.base === ALL_PERMISSIONS) return;
    if ((bits & ~actor.base) !== 0) throw forbidden('não é possível conceder permissões que você não possui');
  }

  /** IDs de servidores e canais visíveis para o usuário (para rooms Socket.IO). */
  async visibleRooms(
    userId: string,
  ): Promise<{ serverIds: string[]; channelIds: string[]; conversationIds: string[] }> {
    const memberships = await this.prisma.serverMember.findMany({ where: { userId }, select: { serverId: true } });
    const channelIds: string[] = [];
    for (const m of memberships) {
      const access = await this.server(m.serverId, userId);
      const channels = await this.prisma.channel.findMany({
        where: { serverId: m.serverId },
        select: { id: true, overrides: true },
      });
      for (const [id, p] of await this.channelsFor(access, channels)) if (p !== 0) channelIds.push(id);
    }
    const convs = await this.prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    return {
      serverIds: memberships.map((m) => m.serverId),
      channelIds,
      conversationIds: convs.map((c) => c.conversationId),
    };
  }
}
