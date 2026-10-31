import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  hasPermission,
  Permission,
  rooms,
  type BoardCard,
  type BoardColumn,
  type CreateBoardCardRequest,
  type UpdateBoardCardRequest,
} from '@opencord/contracts';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../common/prisma.service.js';
import { USER_PUBLIC_SELECT, userPublic } from '../common/serialize.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { PermissionsService } from '../servers/permissions.service.js';
import { forbidden } from '../common/errors.js';

const CARD_INCLUDE = {
  reporter: { select: USER_PUBLIC_SELECT },
  message: { select: { _count: { select: { attachments: true } } } },
} as const;

type CardRow = {
  id: string;
  boardId: string;
  column: BoardColumn;
  position: number;
  title: string;
  body: string;
  messageId: string | null;
  sourceChannelId: string | null;
  createdAt: Date;
  updatedAt: Date;
  reporter: Parameters<typeof userPublic>[0] | null;
  message: { _count: { attachments: number } } | null;
};

const MAX_CARDS_PER_BOARD = 2000;
const TITLE_MAX = 200;
/** título do card cuja mensagem de origem foi apagada */
export const DELETED_CARD_TITLE = '(mensagem apagada)';

/**
 * Quadros kanban (ADR-0017): canal do tipo "board" com cards em colunas fixas. Ver o quadro = VIEW_CHANNEL nele
 * (a visibilidade é a do canal: overrides); mexer nos cards = MANAGE_MESSAGES no quadro. Um canal de texto com
 * `boardId` alimenta o quadro: cada mensagem nova nele vira um card na coluna "Novo".
 */
@Injectable()
export class BoardsService {
  private readonly log = new Logger(BoardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly perms: PermissionsService,
    private readonly realtime: RealtimeService,
  ) {}

  private serialize(c: CardRow): BoardCard {
    return {
      id: c.id,
      boardId: c.boardId,
      column: c.column,
      position: c.position,
      title: c.title,
      body: c.body,
      reporter: c.reporter ? userPublic(c.reporter) : null,
      messageId: c.messageId,
      sourceChannelId: c.sourceChannelId,
      attachments: c.message?._count.attachments ?? 0,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private async board(boardId: string, userId: string, manage: boolean) {
    const a = await this.perms.requireChannel(boardId, userId, Permission.VIEW_CHANNEL);
    if (a.kind !== 'board') throw new BadRequestException('não é um quadro');
    if (manage && !hasPermission(a.perms, Permission.MANAGE_MESSAGES)) throw forbidden();
    return a;
  }

  private emit(card: BoardCard) {
    this.realtime.emit(rooms.channel(card.boardId), 'board:card:upserted', card);
  }

  /** topo da coluna: menor posição - 1 */
  private async topOf(boardId: string, column: BoardColumn) {
    const first = await this.prisma.boardCard.findFirst({
      where: { boardId, column },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    return (first?.position ?? 0) - 1;
  }

  async list(boardId: string, userId: string): Promise<BoardCard[]> {
    await this.board(boardId, userId, false);
    const rows = await this.prisma.boardCard.findMany({
      where: { boardId },
      include: CARD_INCLUDE,
      orderBy: [{ column: 'asc' }, { position: 'asc' }],
    });
    return rows.map((r) => this.serialize(r));
  }

  async create(boardId: string, userId: string, dto: CreateBoardCardRequest): Promise<BoardCard> {
    await this.board(boardId, userId, true);
    if ((await this.prisma.boardCard.count({ where: { boardId } })) >= MAX_CARDS_PER_BOARD)
      throw new BadRequestException('limite de cards no quadro');
    const row = await this.prisma.boardCard.create({
      data: {
        boardId,
        column: 'new',
        position: await this.topOf(boardId, 'new'),
        title: dto.title,
        body: dto.body ?? '',
        reporterId: userId,
      },
      include: CARD_INCLUDE,
    });
    const card = this.serialize(row);
    this.emit(card);
    return card;
  }

  private async card(cardId: string, userId: string) {
    const row = await this.prisma.boardCard.findUnique({ where: { id: cardId }, select: { boardId: true } });
    if (!row) throw notFound('card');
    // quem não vê o quadro recebe 404, sem saber que o card existe
    await this.board(row.boardId, userId, false).catch(() => {
      throw notFound('card');
    });
    await this.board(row.boardId, userId, true);
    return row;
  }

  async update(cardId: string, userId: string, dto: UpdateBoardCardRequest): Promise<BoardCard> {
    const { boardId } = await this.card(cardId, userId);
    const position = dto.position ?? (dto.column !== undefined ? await this.topOf(boardId, dto.column) : undefined);
    const row = await this.prisma.boardCard.update({
      where: { id: cardId },
      data: {
        ...(dto.column !== undefined ? { column: dto.column } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
      },
      include: CARD_INCLUDE,
    });
    const card = this.serialize(row);
    this.emit(card);
    return card;
  }

  async remove(cardId: string, userId: string) {
    const { boardId } = await this.card(cardId, userId);
    await this.prisma.boardCard.delete({ where: { id: cardId } });
    this.realtime.emit(rooms.channel(boardId), 'board:card:deleted', { boardId, cardId });
  }

  /** Reenvia aos quadros os cards que vieram desta mensagem (ex.: depois de apagada). */
  async refreshFromMessage(messageId: string) {
    const rows = await this.prisma.boardCard.findMany({ where: { messageId }, include: CARD_INCLUDE });
    for (const row of rows) this.emit(this.serialize(row));
  }

  /**
   * Mensagem nova num canal que alimenta um quadro: vira card em "Novo". Falha aqui não pode derrubar o envio da
   * mensagem (só registra). Título = primeira linha; descrição = o texto inteiro.
   */
  async fromMessage(m: { id: string; channelId: string | null; authorId: string; body: string }) {
    if (!m.channelId) return;
    try {
      const ch = await this.prisma.channel.findUnique({ where: { id: m.channelId }, select: { boardId: true } });
      if (!ch?.boardId) return;
      const boardId = ch.boardId;
      if ((await this.prisma.boardCard.count({ where: { boardId } })) >= MAX_CARDS_PER_BOARD) return;
      const firstLine =
        m.body
          .split('\n')
          .find((l) => l.trim())
          ?.trim() ?? '';
      const title =
        (firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine) || 'Relato com anexo';
      const row = await this.prisma.boardCard.create({
        data: {
          boardId,
          column: 'new',
          position: await this.topOf(boardId, 'new'),
          title,
          body: m.body,
          reporterId: m.authorId,
          messageId: m.id,
          sourceChannelId: m.channelId,
        },
        include: CARD_INCLUDE,
      });
      this.emit(this.serialize(row));
    } catch (e) {
      this.log.warn(`card a partir da mensagem ${m.id}: ${String(e)}`);
    }
  }
}
