/**
 * Moderação (ADR-0034): banimento (expulsa, grava `ServerBan` e fecha todas as portas de entrada) e castigo
 * (`ServerMember.timeoutUntil`: não escreve, reage, usa comando nem entra em voz até a data). Hierarquia igual à da
 * expulsão: dono e super admin da instância são intocáveis; ninguém se pune.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { MAX_TIMEOUT_MS, Permission, rooms, type Member, type ServerBan } from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { AuditService } from '../audit/audit.service.js';
import { DomainEvents } from '../common/domain-events.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { member, MEMBER_INCLUDE, USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { ServersService } from '../servers/servers.service.js';

const BAN_INCLUDE = { user: { select: USER_PUBLIC_SELECT } } satisfies Prisma.ServerBanInclude;

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly servers: ServersService,
    private readonly messages: MessagesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly events: DomainEvents,
  ) {}

  // ---------- Banimento ----------
  /**
   * BAN_MEMBERS + hierarquia (`memberTop`, como a expulsão). Quem não é membro também pode ser banido (só grava o
   * ban); dono e super admin nunca. Apaga as mensagens recentes da pessoa no servidor se pedido.
   */
  async ban(
    serverId: string,
    actorId: string,
    targetId: string,
    dto: { reason?: string | undefined; deleteMessageSeconds: number },
  ): Promise<ServerBan> {
    if (actorId === targetId) throw new BadRequestException('não é possível banir a si mesmo');
    const actor = await this.perms.requireServer(serverId, actorId, Permission.BAN_MEMBERS);
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, isInstanceAdmin: true },
    });
    if (!target) throw notFound('usuário');
    // intocáveis mesmo sem serem membros (o super admin entra em qualquer servidor quando quiser)
    if (target.id === actor.ownerId || target.isInstanceAdmin) throw forbidden('hierarquia de cargos insuficiente');
    const isMember = await this.prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: targetId } },
      select: { userId: true },
    });
    if (isMember) this.perms.assertAbove(actor, await this.perms.memberTop(serverId, targetId, actor.ownerId));
    const reason = dto.reason?.trim() || null;
    await this.prisma.serverBan.upsert({
      where: { serverId_userId: { serverId, userId: targetId } },
      create: { serverId, userId: targetId, reason, createdById: actorId },
      update: { reason, createdById: actorId, createdAt: new Date() },
    });
    if (isMember) await this.servers.expel(serverId, targetId);
    const deletedMessages = await this.messages.purgeByAuthor(serverId, targetId, dto.deleteMessageSeconds);
    await this.audit.log(actorId, serverId, 'member.ban', targetId, {
      reason,
      deleteMessageSeconds: dto.deleteMessageSeconds,
      deletedMessages,
    });
    const row = await this.prisma.serverBan.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: targetId } },
      include: BAN_INCLUDE,
    });
    const ban = (await this.serialize([row]))[0] as ServerBan;
    this.realtime.emit(rooms.server(serverId), 'server:ban:added', ban);
    return ban;
  }

  async unban(serverId: string, actorId: string, targetId: string): Promise<void> {
    await this.perms.requireServer(serverId, actorId, Permission.BAN_MEMBERS);
    const removed = await this.prisma.serverBan.deleteMany({ where: { serverId, userId: targetId } });
    if (!removed.count) throw notFound('banimento');
    await this.audit.log(actorId, serverId, 'member.unban', targetId, {});
    this.realtime.emit(rooms.server(serverId), 'server:ban:removed', { serverId, userId: targetId });
  }

  /** Banidos do servidor, mais recente primeiro (BAN_MEMBERS). */
  async bans(serverId: string, actorId: string): Promise<ServerBan[]> {
    await this.perms.requireServer(serverId, actorId, Permission.BAN_MEMBERS);
    const rows = await this.prisma.serverBan.findMany({
      where: { serverId },
      include: BAN_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
    });
    return this.serialize(rows);
  }

  private async serialize(rows: Prisma.ServerBanGetPayload<{ include: typeof BAN_INCLUDE }>[]): Promise<ServerBan[]> {
    // quem baniu não tem relação no esquema (a conta pode sumir): uma consulta só para todos
    const byIds = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => id !== null))];
    const actors = byIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: byIds } }, select: USER_PUBLIC_SELECT })
      : [];
    const actorById = new Map(actors.map((u) => [u.id, userPublic(u)]));
    return rows.map((r) => ({
      serverId: r.serverId,
      user: userPublic(r.user),
      reason: r.reason,
      by: r.createdById ? (actorById.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ---------- Castigo ----------
  /**
   * MODERATE_MEMBERS + hierarquia. `timeoutUntil` no futuro (até 28 dias) aplica; null ou no passado tira. Em voz no
   * servidor, a chamada é encerrada (evento de domínio → VoiceService).
   */
  async setTimeout(
    serverId: string,
    actorId: string,
    targetId: string,
    dto: { timeoutUntil?: string | null | undefined; reason?: string | undefined },
  ): Promise<Member> {
    if (actorId === targetId) throw new BadRequestException('não é possível castigar a si mesmo');
    const actor = await this.perms.requireServer(serverId, actorId, Permission.MODERATE_MEMBERS);
    this.perms.assertAbove(actor, await this.perms.memberTop(serverId, targetId, actor.ownerId));
    let until = dto.timeoutUntil ? new Date(dto.timeoutUntil) : null;
    if (until && Number.isNaN(until.getTime())) throw new BadRequestException('data inválida');
    if (until && until.getTime() - Date.now() > MAX_TIMEOUT_MS)
      throw new BadRequestException(`castigo de no máximo ${MAX_TIMEOUT_MS / 86_400_000} dias`);
    // prazo já passado = tirar o castigo
    if (until && until.getTime() <= Date.now()) until = null;
    const m = await this.prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId: targetId } },
      data: { timeoutUntil: until },
      include: MEMBER_INCLUDE,
    });
    await this.audit.log(actorId, serverId, 'member.timeout', targetId, {
      until: until?.toISOString() ?? null,
      reason: dto.reason?.trim() || null,
    });
    const dto2 = member(m);
    if (!m.hidden) this.realtime.emit(rooms.server(serverId), 'server:member:updated', { serverId, member: dto2 });
    if (until) this.events.emit({ type: 'member.timeout', serverId, userId: targetId });
    return dto2;
  }
}
