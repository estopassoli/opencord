import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SystemUserService } from '../system/system-user.service.js';
import { SocialService } from '../social/social.service.js';
import { BoardsService } from './boards.service.js';

/** texto da DM de recusa (Markdown do chat) */
export function rejectionText(o: { server: string; board: string; title: string; reason: string }) {
  const quote = o.title
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return [
    `**Sua ideia não foi aprovada desta vez**`,
    `A equipe do servidor **${o.server}** analisou o que você mandou para #${o.board} e decidiu não seguir com ela por enquanto.`,
    quote,
    ...(o.reason ? [`**Motivo:** ${o.reason}`] : []),
    `Obrigado por contribuir! Pode mandar outras ideias quando quiser.`,
    `_Mensagem automática: esta conversa não recebe respostas._`,
  ].join('\n\n');
}

/**
 * Recusar uma ideia do quadro (ADR-0045): apaga o card e, por padrão, avisa quem relatou por DM da conta de avisos
 * do OpenCord (sem resposta). Separado do BoardsService porque o MessagesService já depende dele.
 */
@Injectable()
export class CardRejectionService {
  constructor(
    private readonly boards: BoardsService,
    private readonly messages: MessagesService,
    private readonly system: SystemUserService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly social: SocialService,
  ) {}

  async reject(
    cardId: string,
    userId: string,
    dto: { reason: string; notify: boolean },
  ): Promise<{ notified: boolean }> {
    const { boardId } = await this.boards.requireManageCard(cardId, userId);
    const card = await this.prisma.boardCard.findUniqueOrThrow({
      where: { id: cardId },
      select: {
        title: true,
        reporterId: true,
        reporter: { select: { disabledAt: true } },
        board: { select: { name: true, serverId: true, server: { select: { name: true } } } },
      },
    });
    let notified = false;
    if (dto.notify && card.reporterId && card.reporterId !== userId && !card.reporter?.disabledAt) {
      const systemId = await this.system.ensure();
      const conversationId = await this.dmWith(systemId, card.reporterId);
      await this.messages.create(
        systemId,
        { conversationId },
        {
          requestId: randomUUID(),
          body: rejectionText({
            server: card.board.server.name,
            board: card.board.name,
            title: card.title,
            reason: dto.reason,
          }),
        },
        { skipModeration: true },
      );
      notified = true;
    }
    await this.boards.removeById(cardId, boardId);
    await this.audit.log(userId, card.board.serverId, 'board.card.reject', cardId, {
      title: card.title.slice(0, 200),
      notified,
    });
    return { notified };
  }

  /** DM 1:1 entre a conta de avisos e a pessoa (a mesma de sempre, criada na primeira vez) */
  private async dmWith(systemId: string, userId: string): Promise<string> {
    const [low, high] = systemId < userId ? [systemId, userId] : [userId, systemId];
    const dmKey = `${low}:${high}`;
    const existing = await this.prisma.conversation.findUnique({ where: { dmKey }, select: { id: true } });
    if (existing) return existing.id;
    const c = await this.prisma.conversation.create({
      data: { kind: 'dm', dmKey, members: { create: [{ userId: systemId }, { userId }] } },
      select: { id: true },
    });
    await this.realtime.conversationJoined(c.id, [systemId, userId]);
    await this.social.announceConversation(c.id);
    return c.id;
  }
}
