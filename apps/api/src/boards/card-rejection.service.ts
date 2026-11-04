import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../common/prisma.service.js';
import { SystemNoticesService } from '../system/system-notices.service.js';
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
    private readonly notices: SystemNoticesService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
      await this.notices.notify(
        card.reporterId,
        rejectionText({
          server: card.board.server.name,
          board: card.board.name,
          title: card.title,
          reason: dto.reason,
        }),
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
}
