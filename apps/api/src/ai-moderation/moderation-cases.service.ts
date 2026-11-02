/**
 * Fila e decisão dos casos da moderação por IA (ADR-0036). Aprovar publica a mensagem original (mesmo requestId,
 * anexos e resposta); reprovar descarta (apaga os anexos) e pode punir (castigo, banimento, expulsão) com as regras
 * de hierarquia já existentes.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { Permission, type ModerationCase, type ReviewModerationCaseRequest } from '@opencord/contracts';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { AuditService } from '../audit/audit.service.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { ServersService } from '../servers/servers.service.js';
import { CASE_INCLUDE, ModerationHoldService } from './moderation-hold.service.js';

@Injectable()
export class ModerationCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly attachments: AttachmentsService,
    private readonly messages: MessagesService,
    private readonly moderation: ModerationService,
    private readonly servers: ServersService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly hold: ModerationHoldService,
  ) {}

  /** Fila de um servidor (MODERATE_MEMBERS). */
  async list(serverId: string, userId: string, q: { status?: string | undefined; limit: number }) {
    await this.perms.requireServer(serverId, userId, Permission.MODERATE_MEMBERS);
    const rows = await this.prisma.moderationCase.findMany({
      where: { serverId, ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: CASE_INCLUDE,
    });
    return Promise.all(rows.map((r) => this.hold.serialize(r)));
  }

  /** Fila de toda a instância (super admin). */
  async listAll(userId: string, q: { status?: string | undefined; limit: number }) {
    await this.requireAdmin(userId);
    const rows = await this.prisma.moderationCase.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: CASE_INCLUDE,
    });
    return Promise.all(rows.map((r) => this.hold.serialize(r)));
  }

  /** Aprova (publica o envio original) ou reprova (descarta; punição opcional). */
  async review(caseId: string, actorId: string, dto: ReviewModerationCaseRequest): Promise<ModerationCase> {
    const c = await this.prisma.moderationCase.findUnique({ where: { id: caseId }, include: CASE_INCLUDE });
    if (!c) throw notFound('caso');
    if (c.serverId) await this.perms.requireServer(c.serverId, actorId, Permission.MODERATE_MEMBERS);
    else await this.requireAdmin(actorId);
    if (c.status === 'approved' || c.status === 'rejected') throw new BadRequestException('caso já decidido');

    let publishedMessageId: string | null = null;
    if (dto.decision === 'approve') {
      const target = c.channelId ? { channelId: c.channelId } : { conversationId: c.conversationId as string };
      const { message } = await this.messages.create(
        c.authorId,
        target,
        {
          requestId: c.requestId,
          body: c.body,
          replyToId: c.replyToId ?? undefined,
          attachmentIds: c.attachments.map((a) => a.id),
        },
        { skipModeration: true, caseId: c.id },
      );
      publishedMessageId = message.id;
    } else {
      // reprovado: os anexos retidos vão embora
      for (const a of c.attachments) await this.attachments.discard(a.id).catch(() => undefined);
    }
    const row = await this.prisma.moderationCase.update({
      where: { id: caseId },
      data: {
        status: dto.decision === 'approve' ? 'approved' : 'rejected',
        reviewedById: actorId,
        reviewedAt: new Date(),
        reviewNote: dto.note?.trim() || null,
        publishedMessageId,
      },
      include: CASE_INCLUDE,
    });
    if (c.serverId) {
      await this.audit.log(actorId, c.serverId, dto.decision === 'approve' ? 'ai.approved' : 'ai.rejected', caseId, {
        authorId: c.authorId,
        punishment: dto.punishment?.kind ?? null,
        note: dto.note ?? null,
      });
      if (dto.decision === 'reject' && dto.punishment) await this.punish(c.serverId, actorId, c.authorId, dto);
    }
    const out = await this.hold.serialize(row);
    if (c.serverId)
      for (const uid of await this.hold.moderatorIds(c.serverId))
        this.realtime.toUser(uid, 'moderation:case:resolved', out);
    // o autor fica sabendo o que aconteceu com o envio
    this.realtime.toUser(c.authorId, 'notification:created', {
      kind: 'moderation',
      title: dto.decision === 'approve' ? 'Seu envio foi aprovado' : 'Seu envio foi reprovado',
      body:
        dto.decision === 'approve'
          ? 'A moderação liberou a mensagem que estava em revisão.'
          : `A moderação não liberou sua mensagem.${dto.note ? ` Motivo: ${dto.note}` : ''}`,
      ...(c.serverId ? { serverId: c.serverId } : {}),
      ...(c.channelId ? { channelId: c.channelId } : {}),
      ...(c.conversationId ? { conversationId: c.conversationId } : {}),
    });
    return out;
  }

  private async requireAdmin(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isInstanceAdmin: true } });
    if (!u?.isInstanceAdmin) throw forbidden('apenas super admins');
  }

  private async punish(serverId: string, actorId: string, targetId: string, dto: ReviewModerationCaseRequest) {
    const p = dto.punishment;
    if (!p) return;
    const reason = dto.note?.trim() || 'conteúdo reprovado pela moderação';
    if (p.kind === 'timeout')
      await this.moderation.setTimeout(serverId, actorId, targetId, {
        timeoutUntil: new Date(Date.now() + p.durationMs).toISOString(),
        reason,
      });
    else if (p.kind === 'ban')
      await this.moderation.ban(serverId, actorId, targetId, {
        reason,
        deleteMessageSeconds: p.deleteMessageSeconds ?? 0,
      });
    else await this.servers.kick(serverId, actorId, targetId, reason);
  }
}
