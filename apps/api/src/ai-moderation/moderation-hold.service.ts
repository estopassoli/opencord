/**
 * Retenção da moderação por IA (ADR-0036): grava o envio retido (texto, anexos presos ao caso, veredito), avisa os
 * moderadores e serializa casos. Separado do serviço de casos para o MessagesService poder reter sem ciclo de
 * injeção (o serviço de casos publica via MessagesService ao aprovar).
 */
import { Injectable } from '@nestjs/common';
import { computeBasePermissions, hasPermission, Permission, type ModerationCase } from '@opencord/contracts';
import type { Prisma } from '@opencord/db';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TokenService } from '../auth/token.service.js';
import { DeviceBansService } from './device-bans.service.js';
import type { Verdict } from './ai-moderation.service.js';

export const CASE_INCLUDE = {
  author: { select: USER_PUBLIC_SELECT },
  server: { select: { id: true, name: true } },
  attachments: true,
} satisfies Prisma.ModerationCaseInclude;
export type CaseRow = Prisma.ModerationCaseGetPayload<{ include: typeof CASE_INCLUDE }>;

export interface HeldSubmission {
  serverId: string | null;
  channelId: string | null;
  conversationId: string | null;
  authorId: string;
  requestId: string;
  body: string;
  replyToId: string | null;
  attachmentIds: string[];
  verdict: Verdict;
  /** 'review' entra na fila; 'block' fica registrado como bloqueado pela IA */
  kind: 'review' | 'block';
  model: string;
}

@Injectable()
export class ModerationHoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly deviceBans: DeviceBansService,
  ) {}

  /**
   * Bloqueio automático (conteúdo grave com confiança alta, ligado no painel): suspende a conta na instância,
   * bane do servidor onde aconteceu, derruba as sessões e, se pedido, bloqueia o aparelho/IP. Super admins nunca.
   */
  async autoBlock(c: { id: string; authorId: string; serverId: string; reason: string }, withDevice: boolean) {
    const u = await this.prisma.user.findUnique({
      where: { id: c.authorId },
      select: { isInstanceAdmin: true, disabledAt: true },
    });
    if (!u || u.isInstanceAdmin) return null;
    const reason = `moderação automática: ${c.reason}`.slice(0, 200);
    await this.prisma.user.update({ where: { id: c.authorId }, data: { disabledAt: u.disabledAt ?? new Date() } });
    await this.prisma.serverBan.upsert({
      where: { serverId_userId: { serverId: c.serverId, userId: c.authorId } },
      create: { serverId: c.serverId, userId: c.authorId, reason, createdById: null },
      update: {},
    });
    await this.prisma.serverMember.deleteMany({ where: { serverId: c.serverId, userId: c.authorId } });
    const sessions = await this.prisma.session.findMany({
      where: { userId: c.authorId, revokedAt: null },
      select: { id: true },
    });
    await this.prisma.session.updateMany({
      where: { userId: c.authorId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.tokens.invalidateCache(sessions.map((x) => x.id));
    let devices = 0;
    if (withDevice) devices = await this.deviceBans.banDevicesOf(c.authorId, reason, null);
    const action = withDevice ? 'suspended+device' : 'suspended';
    await this.prisma.moderationCase.update({ where: { id: c.id }, data: { autoAction: action } });
    await this.audit.log(c.authorId, c.serverId, 'ai.autoblock', c.authorId, { action, devices, reason: c.reason });
    this.realtime.emit(this.roomOf(c.serverId), 'server:member:left', {
      serverId: c.serverId,
      userId: c.authorId,
      reason: 'kicked',
    });
    await this.realtime.disconnectUser(c.authorId, 'conta suspensa pela moderação');
    await this.realtime.syncUserRooms(c.authorId).catch(() => undefined);
    return action;
  }

  private roomOf(serverId: string) {
    return `server:${serverId}`;
  }

  /** Grava o envio retido, prende os anexos ao caso e avisa os moderadores (só na fila de revisão). */
  async hold(s: HeldSubmission): Promise<ModerationCase> {
    const row = await this.prisma.$transaction(async (tx) => {
      const c = await tx.moderationCase.create({
        data: {
          serverId: s.serverId,
          channelId: s.channelId,
          conversationId: s.conversationId,
          authorId: s.authorId,
          requestId: s.requestId,
          body: s.body,
          replyToId: s.replyToId,
          verdict: s.kind,
          category: s.verdict.category === 'nenhuma' ? null : s.verdict.category,
          reason: s.verdict.reason,
          status: s.kind === 'block' ? 'blocked' : 'pending',
          model: s.model,
        },
      });
      if (s.attachmentIds.length)
        await tx.attachment.updateMany({
          where: { id: { in: s.attachmentIds }, uploaderId: s.authorId, messageId: null },
          data: { caseId: c.id },
        });
      return tx.moderationCase.findUniqueOrThrow({ where: { id: c.id }, include: CASE_INCLUDE });
    });
    const out = await this.serialize(row);
    if (s.serverId) {
      await this.audit.log(s.authorId, s.serverId, s.kind === 'block' ? 'ai.blocked' : 'ai.held', row.id, {
        category: s.verdict.category,
        confidence: s.verdict.confidence,
        channelId: s.channelId,
      });
      // moderadores do servidor (e super admins membros) recebem o caso na hora; a fila só interessa em 'review'
      for (const uid of await this.moderatorIds(s.serverId)) {
        this.realtime.toUser(uid, 'moderation:case:created', out);
        if (s.kind === 'review')
          this.realtime.toUser(uid, 'notification:created', {
            kind: 'moderation',
            title: 'Envio retido para revisão',
            body: `${out.author.displayName} em #${out.channelName ?? 'canal'}: ${s.verdict.reason.slice(0, 120)}`,
            serverId: s.serverId,
            ...(s.channelId ? { channelId: s.channelId } : {}),
          });
      }
    }
    return out;
  }

  /** Dono, super admins membros e quem tem MODERATE_MEMBERS pelos cargos. */
  async moderatorIds(serverId: string): Promise<string[]> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: {
        ownerId: true,
        roles: { select: { id: true, permissions: true, isEveryone: true } },
        members: {
          select: { userId: true, roles: { select: { roleId: true } }, user: { select: { isInstanceAdmin: true } } },
        },
      },
    });
    if (!server) return [];
    const everyone = server.roles.find((r) => r.isEveryone);
    const rolePermissions = new Map(server.roles.map((r) => [r.id, r.permissions]));
    const out = new Set<string>([server.ownerId]);
    for (const m of server.members) {
      if (m.user.isInstanceAdmin) {
        out.add(m.userId);
        continue;
      }
      if (!everyone) continue;
      const base = computeBasePermissions({
        userId: m.userId,
        ownerId: server.ownerId,
        everyoneRoleId: everyone.id,
        rolePermissions,
        memberRoleIds: m.roles.map((r) => r.roleId),
      });
      if (hasPermission(base, Permission.MODERATE_MEMBERS)) out.add(m.userId);
    }
    return [...out];
  }

  async serialize(r: CaseRow): Promise<ModerationCase> {
    const [channel, reviewer] = await Promise.all([
      r.channelId ? this.prisma.channel.findUnique({ where: { id: r.channelId }, select: { name: true } }) : null,
      r.reviewedById
        ? this.prisma.user.findUnique({ where: { id: r.reviewedById }, select: USER_PUBLIC_SELECT })
        : null,
    ]);
    return {
      id: r.id,
      serverId: r.serverId,
      server: r.server,
      channelId: r.channelId,
      channelName: channel?.name ?? null,
      conversationId: r.conversationId,
      author: userPublic(r.author),
      body: r.body,
      attachments: r.attachments.map((a) => this.attachments.serialize(a)),
      verdict: r.verdict === 'block' ? 'block' : 'review',
      category: r.category,
      reason: r.reason,
      status: (['pending', 'approved', 'rejected', 'blocked'] as const).find((s) => s === r.status) ?? 'pending',
      reviewedBy: reviewer ? userPublic(reviewer) : null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewNote: r.reviewNote,
      publishedMessageId: r.publishedMessageId,
      autoAction: r.autoAction === 'suspended' || r.autoAction === 'suspended+device' ? r.autoAction : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
